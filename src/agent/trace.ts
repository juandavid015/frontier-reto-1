import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from '../image/png.ts';
import { redact } from '../secrets/redact.ts';
import type { Frame } from '../vnc/framebuffer.ts';

// Every run leaves a trace (AGENTS.md): one folder per task with a screenshot per step and trace.jsonl, one JSON
// line per event. Every line passes through redact, so no secret reaches the disk.

export class Trace {
  readonly directory: string;
  readonly #secrets: string[];

  private constructor(directory: string, secrets: string[]) {
    this.directory = directory;
    this.#secrets = secrets;
  }

  static async create(root: string, taskId: string, secrets: string[]): Promise<Trace> {
    const directory = path.join(root, taskId);
    await mkdir(directory, { recursive: true });
    return new Trace(directory, secrets);
  }

  async event(type: string, data: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), type, ...data });
    await appendFile(path.join(this.directory, 'trace.jsonl'), `${redact(line, this.#secrets)}\n`);
  }

  async screenshot(name: string, frame: Frame): Promise<string> {
    const file = path.join(this.directory, `${name}.png`);
    await writeFile(file, encodePng(frame));
    return file;
  }
}
