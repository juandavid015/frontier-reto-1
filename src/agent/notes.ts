// The model's short memory for one task: facts it read on one screen and needs on another (validation 1: a task
// failed because the data read earlier was gone from the history). Created per task, so nothing carries over.
// The notes are data the model wrote down; the prompt says they are never orders.

const MAX_NOTES = 40;
const MAX_NOTE_LENGTH = 200;

export class Notes {
  #notes: string[] = [];

  add(facts: string[]): void {
    for (const fact of facts) {
      const note = fact.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE_LENGTH);
      if (note === '' || this.#notes.includes(note)) continue;
      this.#notes.push(note);
    }
    // Oldest first out: the latest facts are the ones the next steps act on.
    this.#notes = this.#notes.slice(-MAX_NOTES);
  }

  list(): string[] {
    return [...this.#notes];
  }
}
