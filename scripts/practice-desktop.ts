// Shared by the eval runner and the remote test: the practice cases, and the organizers' admin routes on the
// practice desktop (POST /__reset and POST /__check, both with the desktop token).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

const AFTER_RESET_WAIT_MS = 8_000;
const HTTP_TIMEOUT_MS = 30_000;

export const CaseSchema = z.object({
  id: z.string(),
  instruccion: z.string(),
  estado_esperado: z.enum(['terminada', 'fallida']),
  respuesta_esperada: z.string().optional(),
  claves_razon: z.array(z.string()).optional(),
  diff_esperado: z.array(z.object({ accion: z.string() }).passthrough()),
});
export type EvalCase = z.infer<typeof CaseSchema>;

export function requireEnv<const Names extends string[]>(names: Names): Record<Names[number], string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} in .env`);
    values[name] = value;
  }
  return values as Record<Names[number], string>;
}

// wss://host/websockify -> https://host
export function httpBaseUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.origin;
}

export async function loadCases(folder: string): Promise<EvalCase[]> {
  const files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (file) => CaseSchema.parse(JSON.parse(await readFile(path.join(folder, file), 'utf8')))),
  );
}

export async function resetDesktop(baseUrl: string, token: string): Promise<void> {
  const response = await fetch(`${baseUrl}/__reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Reset failed with HTTP ${response.status}`);
  // The reset restarts the browser; give it time to show the app again.
  await sleep(AFTER_RESET_WAIT_MS);
}

export async function checkApp(baseUrl: string, token: string, evalCase: EvalCase): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}/__check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(evalCase),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return await response.json();
  } catch (error) {
    return { pass: false, error: error instanceof Error ? error.message : String(error) };
  }
}
