// Eval runner: for each case, reset the desktop, run the agent, ask the organizers' /__check about the app state,
// then check our own estado and summary the way the brief scores them. Prints and saves the numbers per task type.
// Usage: pnpm eval [cases folder, default pruebas] [case id filter, e.g. E3]

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { runTask, type TaskOutcome } from '../src/agent/run-task.ts';
import { agentConfig } from '../src/agent/config.ts';
import { runProbe } from './probe-support.ts';

const AFTER_RESET_WAIT_MS = 8_000;
const HTTP_TIMEOUT_MS = 30_000;

const CaseSchema = z.object({
  id: z.string(),
  instruccion: z.string(),
  estado_esperado: z.enum(['terminada', 'fallida']),
  respuesta_esperada: z.string().optional(),
  claves_razon: z.array(z.string()).optional(),
  diff_esperado: z.array(z.object({ accion: z.string() }).passthrough()),
});
type EvalCase = z.infer<typeof CaseSchema>;

type CaseResult = {
  id: string;
  type: string;
  correct: boolean;
  falseSuccess: boolean;
  appCheck: unknown;
  ourChecks: Record<string, boolean>;
  estado: string;
  resumen: string;
  steps: number;
  costUsd: number;
  durationMs: number;
  trace: string;
};

await runProbe(async () => {
  const [folder = 'pruebas', filter] = process.argv.slice(2);
  const env = requireEnv(['DESKTOP_WS_URL', 'DESKTOP_PASSWORD', 'DESKTOP_TOKEN', 'OPENROUTER_API_KEY']);
  const baseUrl = httpBaseUrl(env.DESKTOP_WS_URL);
  const cases = (await loadCases(folder)).filter((evalCase) => !filter || evalCase.id === filter);
  const runDirectory = path.join('artifacts', 'eval', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(runDirectory, { recursive: true });
  console.log(
    `Model ${agentConfig.model}, ${cases.length} cases, max ${agentConfig.maxSteps} steps. Traces: ${runDirectory}`,
  );

  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    await resetDesktop(baseUrl, env.DESKTOP_TOKEN);
    const outcome = await runTask({
      taskId: evalCase.id,
      task: evalCase.instruccion,
      desktop: { url: env.DESKTOP_WS_URL, password: env.DESKTOP_PASSWORD },
      apiKey: env.OPENROUTER_API_KEY,
      traceRoot: runDirectory,
    });
    const appCheck = await checkApp(baseUrl, env.DESKTOP_TOKEN, evalCase);
    const result = scoreCase(evalCase, outcome, appCheck);
    results.push(result);
    console.log(formatCase(result));
    await writeFile(path.join(runDirectory, 'results.json'), JSON.stringify(results, null, 2));
  }
  console.log(`\n${formatTotals(results)}`);
});

function requireEnv<const Names extends string[]>(names: Names): Record<Names[number], string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} in .env`);
    values[name] = value;
  }
  return values as Record<Names[number], string>;
}

// wss://host/websockify -> https://host
function httpBaseUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.origin;
}

async function loadCases(folder: string): Promise<EvalCase[]> {
  const files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (file) => CaseSchema.parse(JSON.parse(await readFile(path.join(folder, file), 'utf8')))),
  );
}

async function resetDesktop(baseUrl: string, token: string): Promise<void> {
  const response = await fetch(`${baseUrl}/__reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Reset failed with HTTP ${response.status}`);
  // The reset restarts the browser; give it time to show the app again.
  await sleep(AFTER_RESET_WAIT_MS);
}

async function checkApp(baseUrl: string, token: string, evalCase: EvalCase): Promise<unknown> {
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

function scoreCase(evalCase: EvalCase, outcome: TaskOutcome, appCheck: unknown): CaseResult {
  const appPassed = (appCheck as { pass?: unknown }).pass === true;
  const ourChecks: Record<string, boolean> = { 'estado esperado': outcome.estado === evalCase.estado_esperado };
  const answerLine = outcome.resumen.split('\n').find((line) => line.trim().toLowerCase().startsWith('respuesta:'));
  if (evalCase.respuesta_esperada !== undefined) {
    ourChecks['respuesta'] = answerMatches(answerLine, evalCase.respuesta_esperada);
  }
  if (evalCase.claves_razon) {
    ourChecks['claves de la razón'] = evalCase.claves_razon.every((key) => outcome.resumen.includes(key));
  }
  const correct = appPassed && Object.values(ourChecks).every(Boolean);
  return {
    id: evalCase.id,
    type: taskType(evalCase),
    correct,
    falseSuccess: outcome.estado === 'terminada' && !correct,
    appCheck,
    ourChecks,
    estado: outcome.estado,
    resumen: outcome.resumen,
    steps: outcome.steps,
    costUsd: outcome.costUsd,
    durationMs: outcome.durationMs,
    trace: outcome.traceDirectory,
  };
}

// The brief: if the value is a number, the first number on the line is compared.
function answerMatches(line: string | undefined, expected: string): boolean {
  if (!line) return false;
  const value = line.slice(line.indexOf(':') + 1).trim();
  const isNumber = /^-?\d+([.,]\d+)?$/.test(expected.trim());
  if (!isNumber) return value.toLowerCase() === expected.trim().toLowerCase();
  return value.match(/-?\d+([.,]\d+)?/)?.[0] === expected.trim();
}

function taskType(evalCase: EvalCase): string {
  if (evalCase.estado_esperado === 'fallida') return 'must fail';
  if (evalCase.respuesta_esperada !== undefined) return 'question';
  const actions = new Set(evalCase.diff_esperado.map((change) => change.accion));
  if (actions.has('export')) return 'export';
  if (actions.has('create')) return 'create';
  return 'edit';
}

function formatCase(result: CaseResult): string {
  const verdict = result.correct ? 'PASS' : 'FAIL';
  const failedChecks = Object.entries(result.ourChecks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const app = JSON.stringify(result.appCheck);
  return [
    `${verdict} ${result.id} (${result.type}) estado=${result.estado} steps=${result.steps} ` +
      `cost=$${result.costUsd.toFixed(3)} time=${(result.durationMs / 1000).toFixed(0)}s`,
    `  app check: ${app}`,
    failedChecks.length > 0 ? `  our checks failed: ${failedChecks.join(', ')}` : '  our checks: ok',
    `  resumen: ${result.resumen.replaceAll('\n', ' | ').slice(0, 300)}`,
  ].join('\n');
}

function formatTotals(results: CaseResult[]): string {
  const types = [...new Set(results.map((result) => result.type))];
  const lines = types.map((type) => {
    const ofType = results.filter((result) => result.type === type);
    return `${type}: ${ofType.filter((result) => result.correct).length}/${ofType.length}`;
  });
  const cost = results.reduce((sum, result) => sum + result.costUsd, 0);
  const falseSuccesses = results.filter((result) => result.falseSuccess).length;
  const passed = results.filter((result) => result.correct).length;
  return [
    `Total ${passed}/${results.length}. False successes: ${falseSuccesses}. Cost $${cost.toFixed(3)}.`,
    ...lines,
  ].join('\n');
}
