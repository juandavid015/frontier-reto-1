// Shared by the probe scripts: read the desktop settings, save screenshots, report a failure without secrets.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from '../src/image/png.ts';
import { redact } from '../src/secrets/redact.ts';
import type { Frame } from '../src/vnc/framebuffer.ts';

const OUTPUT_ROOT = path.join('artifacts', 'probe');
const SECRET_VARIABLES = ['DESKTOP_PASSWORD', 'DESKTOP_TOKEN', 'TEAM_TOKEN', 'OPENROUTER_API_KEY'];

export function desktopSettings(): { url: string; password: string; host: string } {
  const url = requireVariable('DESKTOP_WS_URL');
  // Only the host is ever printed: a URL can carry credentials in its query string.
  return { url, password: requireVariable('DESKTOP_PASSWORD'), host: new URL(url).host };
}

/** A new folder per run, named by its start time, so runs never overwrite each other. */
export async function createRunDirectory(): Promise<string> {
  const directory = path.join(OUTPUT_ROOT, new Date().toISOString().replaceAll(':', '-'));
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function saveFrame(directory: string, name: string, frame: Frame): Promise<string> {
  const file = path.join(directory, `${name}.png`);
  await writeFile(file, encodePng(frame));
  return file;
}

export function elapsedMs(since: number): number {
  return Math.round(performance.now() - since);
}

export async function runProbe(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const secrets = SECRET_VARIABLES.map((name) => process.env[name]);
    console.error(`Probe failed. ${redact(message, secrets)}`);
    process.exitCode = 1;
  }
}

function requireVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}
