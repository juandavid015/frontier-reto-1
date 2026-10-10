// Experiment: can we see the remote desktop? Connects, prints the screen size, saves one PNG, disconnects.
// Usage: npm run probe:screenshot   (reads DESKTOP_WS_URL and DESKTOP_PASSWORD from .env)

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from '../src/image/png.ts';
import { redact } from '../src/secrets/redact.ts';
import { VncClient } from '../src/vnc/vnc-client.ts';

const OUTPUT_DIRECTORY = path.join('artifacts', 'probe');
const SECRET_VARIABLES = ['DESKTOP_PASSWORD', 'DESKTOP_TOKEN', 'TEAM_TOKEN', 'OPENROUTER_API_KEY'];

async function main(): Promise<void> {
  const url = requireVariable('DESKTOP_WS_URL');
  const password = requireVariable('DESKTOP_PASSWORD');
  // Only the host is printed: a URL can carry credentials in its query string.
  console.log(`Connecting to ${new URL(url).host} ...`);

  const startedAt = performance.now();
  const client = await VncClient.connect({ url, password });
  try {
    console.log(`Logged in after ${elapsed(startedAt)} ms. Desktop name: "${client.serverName}"`);
    console.log(`Screen: ${client.width}x${client.height}`);

    const captureStartedAt = performance.now();
    const frame = await client.captureScreen();
    console.log(`Screenshot received in ${elapsed(captureStartedAt)} ms`);

    const file = await saveFrame(encodePng(frame));
    console.log(`Saved ${file}`);
  } finally {
    client.close();
    console.log('Connection closed');
  }
}

function requireVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

async function saveFrame(png: Buffer): Promise<string> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const file = path.join(OUTPUT_DIRECTORY, `screenshot-${timestamp}.png`);
  await writeFile(file, png);
  return file;
}

function elapsed(since: number): number {
  return Math.round(performance.now() - since);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const secrets = SECRET_VARIABLES.map((name) => process.env[name]);
  console.error(`Probe failed. ${redact(message, secrets)}`);
  process.exitCode = 1;
}
