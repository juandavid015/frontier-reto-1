import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// One JSON line per event about the tasks we receive. Written to stdout, which the host keeps (Railway logs), and to
// a local file for runs on this machine. Callers pass only safe fields: never a password, token or key.

export async function logRequestEvent(directory: string, event: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  console.log(line);
  try {
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, 'requests.jsonl'), `${line}\n`);
  } catch {
    // The stdout copy is the one that matters in deployment; a read-only disk must not fail a task.
  }
}
