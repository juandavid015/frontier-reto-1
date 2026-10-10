import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { readKeyBudget } from '../agent/openrouter-key.ts';
import { runTask, type TaskOutcome } from '../agent/run-task.ts';
import { logRequestEvent } from './request-log.ts';
import { TaskStore } from './task-store.ts';

// The entrypoint contract from the brief: GET /health, POST /tasks, GET /tasks/{id}. The task routes need the team's
// Bearer token; /health is open (NOTES.md). POST /tasks answers at once; the task runs in the background and is
// polled. Every task we receive is logged with its outcome, steps, cost and the key's remaining budget.

export type ServerOptions = {
  teamToken: string;
  apiKey: string;
  traceRoot: string;
  // Replaced in tests by fakes, so no test reaches a desktop or a paid service.
  run?: typeof runTask;
  readBudget?: typeof readKeyBudget;
};

const MAX_BODY_BYTES = 64 * 1024;

const TaskRequestSchema = z.object({
  tarea: z.string().trim().min(1),
  escritorio: z.object({
    url: z.url({ protocol: /^wss?$/ }),
    password: z.string().min(1),
  }),
});

export function createAgentServer(options: ServerOptions): Server {
  const store = new TaskStore();
  const run = options.run ?? runTask;
  return createServer((request, response) => {
    handle(request, response, options, store, run).catch(() => send(response, 500, { error: 'internal error' }));
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
  store: TaskStore,
  run: typeof runTask,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true });
  if (!isAuthorized(request, options.teamToken)) return send(response, 401, { error: 'unauthorized' });

  if (request.method === 'POST' && url.pathname === '/tasks') {
    const parsed = TaskRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { error: z.prettifyError(parsed.error) });
    const id = store.create();
    send(response, 200, { task_id: id });
    await logRequestEvent(options.traceRoot, {
      event: 'task_received',
      id,
      tarea: parsed.data.tarea,
      desktop: new URL(parsed.data.escritorio.url).host,
    });
    void runInBackground(id, parsed.data, options, store, run);
    return;
  }

  const taskMatch = /^\/tasks\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && taskMatch) {
    const task = store.get(decodeURIComponent(taskMatch[1]!));
    if (!task) return send(response, 404, { error: 'unknown task' });
    return send(response, 200, task);
  }

  send(response, 404, { error: 'not found' });
}

async function runInBackground(
  id: string,
  request: z.infer<typeof TaskRequestSchema>,
  options: ServerOptions,
  store: TaskStore,
  run: typeof runTask,
): Promise<void> {
  let outcome: Partial<TaskOutcome> & Pick<TaskOutcome, 'estado' | 'resumen'>;
  try {
    outcome = await run({
      taskId: id,
      task: request.tarea,
      desktop: request.escritorio,
      apiKey: options.apiKey,
      traceRoot: options.traceRoot,
    });
  } catch {
    // runTask already turns failures into fallida; this is the last guard so a task never stays en_curso.
    outcome = { estado: 'fallida', resumen: 'The agent stopped on an unexpected error.' };
  }
  store.finish(id, outcome.estado, outcome.resumen);
  const budget = await (options.readBudget ?? readKeyBudget)(options.apiKey);
  await logRequestEvent(options.traceRoot, {
    event: 'task_finished',
    id,
    estado: outcome.estado,
    steps: outcome.steps,
    costUsd: outcome.costUsd,
    durationMs: outcome.durationMs,
    keySpentUsd: budget?.usageUsd,
    keyRemainingUsd: budget?.remainingUsd,
  });
}

// Constant-time comparison, so response timing does not reveal how much of a guessed token was right.
function isAuthorized(request: IncomingMessage, teamToken: string): boolean {
  const header = request.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${teamToken}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
