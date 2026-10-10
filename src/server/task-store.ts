import { randomUUID } from 'node:crypto';
import type { Estado } from '../agent/run-task.ts';

// Tasks live in memory: the brief polls a task for at most 5 minutes, and a restart loses only finished history.

export type TaskState = { estado: Estado | 'en_curso'; resumen: string };

// Oldest finished tasks are dropped beyond this, so a long demo day cannot grow memory without limit.
const MAX_TASKS = 1_000;

export class TaskStore {
  #tasks = new Map<string, TaskState>();

  create(): string {
    const id = randomUUID();
    this.#tasks.set(id, { estado: 'en_curso', resumen: '' });
    this.#dropOldFinished();
    return id;
  }

  get(id: string): TaskState | undefined {
    return this.#tasks.get(id);
  }

  finish(id: string, estado: Estado, resumen: string): void {
    this.#tasks.set(id, { estado, resumen });
  }

  #dropOldFinished(): void {
    for (const [id, task] of this.#tasks) {
      if (this.#tasks.size <= MAX_TASKS) return;
      if (task.estado !== 'en_curso') this.#tasks.delete(id);
    }
  }
}
