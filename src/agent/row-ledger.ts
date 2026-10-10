// "The model reads; code counts" (AGENTS.md). The model copies the rows it sees on each page; this ledger keeps them
// by table and id, so a row read twice counts once, and counts the rows whose columns match exactly.
// Example: rows {INV-1: cliente "Comercial Alba"} and {INV-2: cliente "Comercial Alba Norte"};
// count where cliente = "Comercial Alba" is 1, not 2.
//
// It also keeps every page read, so code can tell whether the reading reached the end of the list. Run 5 counted
// three full pages and stopped: nothing proved there was no fourth.

export type Row = { id: string; values: Record<string, string> };
export type CountResult = { count: number; rowsRead: number; missingColumns: string[] };

export type PageRead = {
  /** The model says it pressed "next" just before this read; the loop confirms a click happened in between. */
  afterNext: boolean;
  /** A total of records the app itself shows for this list, if it shows one. */
  totalShown?: number | undefined;
};

type Read = { ids: string[] } & PageRead;

export class RowLedger {
  #tables = new Map<string, { rows: Map<string, Record<string, string>>; reads: Read[] }>();

  /** Stores rows; a later read of the same id replaces the earlier one. Returns how many ids were new. */
  record(table: string, rows: Row[], page: PageRead = { afterNext: false }): { added: number; total: number } {
    const stored = this.#table(table);
    let added = 0;
    for (const row of rows) {
      const id = normalize(row.id);
      if (!stored.rows.has(id)) added++;
      stored.rows.set(id, normalizeValues(row.values));
    }
    stored.reads.push({ ids: rows.map((row) => normalize(row.id)), ...page });
    return { added, total: stored.rows.size };
  }

  /** Counts rows where every column in `where` equals the given value exactly (spaces trimmed, accents kept). */
  count(table: string, where: Record<string, string>): CountResult {
    const rows = [...this.#table(table).rows.values()];
    const conditions = Object.entries(normalizeValues(where));
    const missingColumns = conditions
      .map(([column]) => column)
      .filter((column) => rows.length > 0 && rows.every((row) => !(column in row)));
    const count = rows.filter((row) => conditions.every(([column, value]) => row[column] === value)).length;
    return { count, rowsRead: rows.length, missingColumns };
  }

  /**
   * Evidence code can check that every page was read, or undefined when there is none:
   * a page shorter than the others, a total shown by the app equal to the distinct rows read, or "next" giving the
   * same rows as the page before it.
   */
  endOfListEvidence(table: string): string | undefined {
    const { rows, reads } = this.#table(table);
    const largestPage = Math.max(0, ...reads.map((read) => read.ids.length));
    const shortPage = reads.find((read) => read.ids.length < largestPage);
    if (reads.length >= 2 && shortPage) {
      return `a page of ${shortPage.ids.length} rows, shorter than the others (${largestPage})`;
    }
    const matchingTotal = reads.find((read) => read.totalShown === rows.size);
    if (matchingTotal) return `the app shows a total of ${rows.size}, equal to the distinct rows read`;
    const repeatAfterNext = reads.some(
      (read, index) => index > 0 && read.afterNext && sameIds(read.ids, reads[index - 1]!.ids),
    );
    if (repeatAfterNext) return 'pressing "next" showed the same rows again';
    return undefined;
  }

  get hasRows(): boolean {
    return [...this.#tables.values()].some((table) => table.rows.size > 0);
  }

  #table(name: string): { rows: Map<string, Record<string, string>>; reads: Read[] } {
    const key = normalize(name).toLowerCase();
    let table = this.#tables.get(key);
    if (!table) {
      table = { rows: new Map(), reads: [] };
      this.#tables.set(key, table);
    }
    return table;
  }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((id) => b.includes(id));
}

// Column names compare without case; values keep case and accents, since "Albán" and "Alban" can be different people.
function normalizeValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([column, value]) => [normalize(column).toLowerCase(), normalize(value)]),
  );
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
