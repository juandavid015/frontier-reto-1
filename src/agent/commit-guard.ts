// Plain code enforces the commit rules (AGENTS.md, incident FR-0153): a save, create, export or delete is never
// repeated on the same record, and a new commit waits until the previous one was verified by reading the stored
// record. A form's reaction is not evidence: on v4.2 a good save leaves the form open and almost unchanged.

export type CommitDecision = { allowed: true } | { allowed: false; reason: string };

// A click this close to an unverified commit is treated as the same button, even if the model did not flag it.
const SAME_BUTTON_PIXELS = 12;

export class CommitGuard {
  #committed = new Set<string>();
  #unverified: { record: string; x: number; y: number } | undefined;

  /** For a click the model flagged as a commit. */
  checkCommit(record: string): CommitDecision {
    const key = normalize(record);
    if (this.#committed.has(key)) {
      return { allowed: false, reason: `"${record}" was already saved once. Never save it again; read it to verify.` };
    }
    if (this.#unverified) {
      return {
        allowed: false,
        reason: `The commit on "${this.#unverified.record}" is not verified yet. Read the stored record first.`,
      };
    }
    return { allowed: true };
  }

  /** For any click: catches a repeat of an unverified commit that the model did not flag. */
  checkClick(x: number, y: number): CommitDecision {
    const last = this.#unverified;
    if (!last) return { allowed: true };
    const isSameButton = Math.abs(x - last.x) <= SAME_BUTTON_PIXELS && Math.abs(y - last.y) <= SAME_BUTTON_PIXELS;
    if (!isSameButton) return { allowed: true };
    return { allowed: false, reason: `This is the button that committed "${last.record}". Verify by reading instead.` };
  }

  recordCommit(record: string, x: number, y: number): void {
    this.#committed.add(normalize(record));
    this.#unverified = { record, x, y };
  }

  /** The model read the stored record (list, detail or change log) and it shows the change. */
  markVerified(): void {
    this.#unverified = undefined;
  }

  get hasCommitted(): boolean {
    return this.#committed.size > 0;
  }

  get pendingVerification(): string | undefined {
    return this.#unverified?.record;
  }
}

function normalize(record: string): string {
  return record.trim().replace(/\s+/g, ' ').toLowerCase();
}
