// "The model reads; code counts" (AGENTS.md). The model copies the rows it sees on each page; this ledger keeps them
// by table and id, so a row read twice counts once, and counts the rows whose columns match exactly.
// Example: rows {INV-1: cliente "Comercial Alba"} and {INV-2: cliente "Comercial Alba Norte"};
// count where cliente = "Comercial Alba" is 1, not 2.

export type Row = { id: string; values: Record<string, string> };
export type CountResult = { count: number; rowsRead: number; missingColumns: string[] };

export class RowLedger {
  #tables = new Map<string, Map<string, Record<string, string>>>();

  /** Stores rows; a later read of the same id replaces the earlier one. Returns how many ids were new. */
  record(table: string, rows: Row[]): { added: number; total: number } {
    const stored = this.#table(table);
    let added = 0;
    for (const row of rows) {
      const id = normalize(row.id);
      if (!stored.has(id)) added++;
      stored.set(id, normalizeValues(row.values));
    }
    return { added, total: stored.size };
  }

  /** Counts rows where every column in `where` equals the given value exactly (spaces trimmed, accents kept). */
  count(table: string, where: Record<string, string>): CountResult {
    const rows = [...this.#table(table).values()];
    const conditions = Object.entries(normalizeValues(where));
    const missingColumns = conditions
      .map(([column]) => column)
      .filter((column) => rows.length > 0 && rows.every((row) => !(column in row)));
    const count = rows.filter((row) => conditions.every(([column, value]) => row[column] === value)).length;
    return { count, rowsRead: rows.length, missingColumns };
  }

  rowsIn(table: string): number {
    return this.#table(table).size;
  }

  #table(name: string): Map<string, Record<string, string>> {
    const key = normalize(name).toLowerCase();
    let table = this.#tables.get(key);
    if (!table) {
      table = new Map();
      this.#tables.set(key, table);
    }
    return table;
  }
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
