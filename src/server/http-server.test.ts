import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { TaskInput, TaskOutcome } from '../agent/run-task.ts';
import { createAgentServer } from './http-server.ts';

const TOKEN = 'team-token-for-tests';
const VALID_BODY = {
  tarea: 'Registra al cliente X.',
  escritorio: { url: 'wss://desktop.example/websockify', password: 'desk-pass' },
};

let finishTask: (outcome: Pick<TaskOutcome, 'estado' | 'resumen'>) => void = () => {};
const received: TaskInput[] = [];

// A fake agent that finishes only when the test says so, to observe en_curso first.
async function fakeRun(input: TaskInput): Promise<TaskOutcome> {
  received.push(input);
  const outcome = await new Promise<Pick<TaskOutcome, 'estado' | 'resumen'>>((resolve) => (finishTask = resolve));
  return { ...outcome, steps: 1, costUsd: 0, durationMs: 1, traceDirectory: '' };
}

const logDirectory = await mkdtemp(path.join(tmpdir(), 'agent-server-test-'));
const server = createAgentServer({
  teamToken: TOKEN,
  apiKey: 'unused',
  traceRoot: logDirectory,
  run: fakeRun,
  readBudget: async () => ({ usageUsd: 1.5, remainingUsd: 43.5 }),
});
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await rm(logDirectory, { recursive: true, force: true });
});

function call(path: string, init: RequestInit = {}, token = TOKEN): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
}

function postTask(body: unknown): Promise<Response> {
  return call('/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

test('task routes refuse a missing or wrong token', async () => {
  assert.equal((await call('/tasks/any', {}, 'wrong')).status, 401);
  assert.equal((await fetch(`${baseUrl}/tasks`, { method: 'POST', body: '{}' })).status, 401);
});

test('health answers 200 with or without the token', async () => {
  const withToken = await call('/health');
  assert.equal(withToken.status, 200);
  assert.deepEqual(await withToken.json(), { ok: true });
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});

test('a task body without a task, with an empty task or a non-websocket URL is refused', async () => {
  assert.equal((await postTask({ escritorio: VALID_BODY.escritorio })).status, 400);
  assert.equal((await postTask({ ...VALID_BODY, tarea: '   ' })).status, 400);
  assert.equal(
    (await postTask({ ...VALID_BODY, escritorio: { url: 'https://x.example', password: 'p' } })).status,
    400,
  );
  assert.equal((await call('/tasks', { method: 'POST', body: 'not json' })).status, 400);
});

test('a task answers with an id at once, runs in the background, then reports its outcome', async () => {
  const startedAt = performance.now();
  const response = await postTask(VALID_BODY);
  assert.equal(response.status, 200);
  assert.ok(performance.now() - startedAt < 2_000, 'POST /tasks must answer in under 2 seconds');
  const { task_id: taskId } = (await response.json()) as { task_id: string };

  assert.deepEqual(await (await call(`/tasks/${taskId}`)).json(), { estado: 'en_curso', resumen: '' });
  await waitForRun(taskId);
  assert.equal(received.at(-1)?.desktop.url, VALID_BODY.escritorio.url);

  finishTask({ estado: 'terminada', resumen: 'respuesta: 45' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await (await call(`/tasks/${taskId}`)).json(), { estado: 'terminada', resumen: 'respuesta: 45' });
});

test('the request log records each task received and finished, with cost and budget, and no password', async () => {
  const { task_id: taskId } = (await (await postTask(VALID_BODY)).json()) as { task_id: string };
  await waitForRun(taskId);
  finishTask({ estado: 'fallida', resumen: 'two matches' });
  const log = await waitForLogLine(`"task_finished","id":"${taskId}"`);
  const events = log
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.id === taskId);
  assert.deepEqual(
    events.map((event) => event.event),
    ['task_received', 'task_finished'],
  );
  assert.equal(events[0]!.desktop, 'desktop.example');
  assert.equal(events[1]!.estado, 'fallida');
  assert.equal(events[1]!.steps, 1);
  assert.equal(events[1]!.keyRemainingUsd, 43.5);
  assert.ok(!log.includes(VALID_BODY.escritorio.password), 'the desktop password must never be logged');
});

// The server logs the task before starting it, so the fake agent is called a moment after POST returns.
async function waitForRun(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (received.some((input) => input.taskId === taskId)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`The fake agent never received task ${taskId}`);
}

async function waitForLogLine(fragment: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const log = await readFile(path.join(logDirectory, 'requests.jsonl'), 'utf8').catch(() => '');
    if (log.includes(fragment)) return log;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Log line not found: ${fragment}`);
}

test('an unknown task id is 404', async () => {
  assert.equal((await call('/tasks/does-not-exist')).status, 404);
});
