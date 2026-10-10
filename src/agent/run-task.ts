import { Desktop, type ActionResult } from '../desktop/desktop.ts';
import { encodePng } from '../image/png.ts';
import { redact } from '../secrets/redact.ts';
import type { Action, StepReply } from './actions.ts';
import { CommitGuard } from './commit-guard.ts';
import { agentConfig } from './config.ts';
import { checkFinish, type TaskEnd } from './finish-rules.ts';
import { RowLedger } from './row-ledger.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { requestStep, type ModelUsage } from './model-client.ts';
import { stepPrompt, systemPrompt } from './prompt.ts';
import { Trace } from './trace.ts';

// One task from start to report: connect, then look, decide, act, record, until the model finishes or a limit hits.
// Every path ends in terminada or fallida; nothing is left en_curso.

export type Estado = 'terminada' | 'fallida';

export type TaskInput = {
  taskId: string;
  task: string;
  desktop: { url: string; password: string };
  apiKey: string;
  traceRoot: string;
  model?: string;
};

export type TaskOutcome = {
  estado: Estado;
  resumen: string;
  steps: number;
  costUsd: number;
  durationMs: number;
  traceDirectory: string;
};

type Finish = Extract<Action, { kind: 'finish' }>;
type LoopEnd = TaskEnd;
// What plain code remembers during one task, to enforce the rules the model might forget.
type TaskMemory = { ledger: RowLedger; guard: CommitGuard; refusedFinishes: number; clickedSinceLastRead: boolean };

export async function runTask(input: TaskInput): Promise<TaskOutcome> {
  const startedAt = performance.now();
  const secrets = [input.desktop.password, input.apiKey];
  const trace = await Trace.create(input.traceRoot, input.taskId, secrets);
  const counters = { steps: 0, costUsd: 0 };
  await trace.event('task', { task: input.task, model: input.model ?? agentConfig.model });

  let desktop: Desktop | undefined;
  let end: LoopEnd;
  try {
    desktop = await connectWithRetry(input.desktop, trace, startedAt);
    end = await agentLoop(desktop, input, trace, counters, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    end = { estado: 'fallida', summary: `The agent stopped on an error: ${message}` };
  } finally {
    desktop?.close();
  }

  const resumen = redact(buildSummary(end), secrets);
  const outcome: TaskOutcome = {
    estado: end.estado,
    resumen,
    steps: counters.steps,
    costUsd: counters.costUsd,
    durationMs: Math.round(performance.now() - startedAt),
    traceDirectory: trace.directory,
  };
  await trace.event('outcome', { ...outcome });
  return outcome;
}

// A desktop that does not answer at first is retried while the clock leaves time to work (NOTES: a 3-minute outage
// at 15:23 failed a whole eval run before step 1).
async function connectWithRetry(desktop: TaskInput['desktop'], trace: Trace, startedAt: number): Promise<Desktop> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await Desktop.connect(desktop);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await trace.event('connect_failed', { attempt, error: message });
      const timeLeftMs = agentConfig.taskDeadlineMs - (performance.now() - startedAt);
      if (timeLeftMs < agentConfig.connectReserveMs) throw error;
      await sleep(agentConfig.connectRetryDelayMs);
    }
  }
}

async function agentLoop(
  desktop: Desktop,
  input: TaskInput,
  trace: Trace,
  counters: { steps: number; costUsd: number },
  startedAt: number,
): Promise<LoopEnd> {
  const history: string[] = [];
  const memory: TaskMemory = {
    ledger: new RowLedger(),
    guard: new CommitGuard(),
    refusedFinishes: 0,
    clickedSinceLastRead: false,
  };
  const system = systemPrompt(desktop.width, desktop.height);
  for (let step = 1; step <= agentConfig.maxSteps; step++) {
    if (performance.now() - startedAt > agentConfig.taskDeadlineMs) {
      return {
        estado: 'fallida',
        summary: `Time ran out after ${step - 1} steps, before the task was confirmed done.`,
      };
    }
    counters.steps = step;
    const frame = desktop.screenshot();
    await trace.screenshot(`step-${String(step).padStart(2, '0')}`, frame);
    const secondsLeft = Math.round((agentConfig.taskDeadlineMs - (performance.now() - startedAt)) / 1000);
    const text = stepPrompt(input.task, history.slice(-agentConfig.historySteps), step, secondsLeft);
    const reply = await decide(input, system, text, encodePng(frame), trace, counters, step);
    const { action } = reply;
    if (action.kind === 'finish') {
      const decision = checkFinish(action, memory.ledger, memory.guard);
      await trace.event('finish', { step, action, decision });
      if (decision.accepted) return decision.end;
      memory.refusedFinishes++;
      if (memory.refusedFinishes >= agentConfig.maxRefusedFinishes) {
        return {
          estado: 'fallida',
          summary: `${action.summary} The result could not be confirmed: ${decision.reason}`,
        };
      }
      history.push(`${step}. finish refused by the rules: ${decision.reason}`);
      continue;
    }

    const result = await act(desktop, action, memory);
    history.push(`${step}. ${describeAction(action)} (${reply.plan}) -> ${result}`);
    await trace.event('step', { step, observation: reply.observation, plan: reply.plan, action, result });
  }
  return { estado: 'fallida', summary: `Reached the limit of ${agentConfig.maxSteps} steps before finishing.` };
}

async function decide(
  input: TaskInput,
  system: string,
  text: string,
  imagePng: Buffer,
  trace: Trace,
  counters: { costUsd: number },
  step: number,
): Promise<StepReply> {
  let prompt = text;
  for (let attempt = 0; attempt <= agentConfig.invalidReplyRetries; attempt++) {
    const callStartedAt = performance.now();
    const result = await requestStep({ apiKey: input.apiKey, model: input.model, system, text: prompt, imagePng });
    counters.costUsd += result.usage.costUsd;
    await trace.event('model', {
      step,
      attempt,
      ms: Math.round(performance.now() - callStartedAt),
      ...usageOf(result.usage),
      stopReason: result.stopReason,
      ok: result.ok,
    });
    if (result.ok) return result.reply;
    await trace.event('invalid_reply', { step, error: result.error });
    prompt = `${text}\n\nYour previous reply was rejected: ${result.error}. Reply again with a valid action.`;
  }
  throw new Error(`The model gave no valid action at step ${step}`);
}

async function act(desktop: Desktop, action: Exclude<Action, Finish>, memory: TaskMemory): Promise<string> {
  try {
    switch (action.kind) {
      case 'click':
        memory.clickedSinceLastRead = true;
        return await click(desktop, action, memory.guard);
      case 'type':
        return describeResult(
          await (action.replace ? desktop.replaceText(action.text) : desktop.typeText(action.text)),
        );
      case 'keys':
        return describeResult(await desktop.pressKeys(action.keys));
      case 'scroll':
        return describeResult(await desktop.scroll(action.x, action.y, action.direction, action.steps));
      case 'read_rows': {
        // "Pressed next" counts only if a click really happened since the previous read.
        const afterNext = action.after_next && memory.clickedSinceLastRead;
        memory.clickedSinceLastRead = false;
        const page = { afterNext, totalShown: action.total_shown };
        const { added, total } = memory.ledger.record(action.table, action.rows, page);
        const evidence = memory.ledger.endOfListEvidence(action.table) ?? 'not proven yet';
        return `recorded ${action.rows.length} rows (${added} new); "${action.table}" has ${total} distinct rows; end of list: ${evidence}`;
      }
      case 'verify_saved':
        memory.guard.markVerified();
        return 'verification recorded';
    }
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Exploring clicks keep the "no visible change" signal: it catches a missed click. A commit never reports it,
// because on v4.2 a good save leaves the form almost unchanged and the signal would invite a duplicate.
async function click(
  desktop: Desktop,
  action: Extract<Action, { kind: 'click' }>,
  guard: CommitGuard,
): Promise<string> {
  const record = action.record?.trim() || `the record at (${action.x}, ${action.y})`;
  const decision = action.commits ? guard.checkCommit(record) : guard.checkClick(action.x, action.y);
  if (!decision.allowed) return `refused, not clicked: ${decision.reason}`;
  const result = await desktop.click(action.x, action.y);
  if (!action.commits) return describeResult(result);
  guard.recordCommit(record, action.x, action.y);
  return `commit sent for "${record}". Do not click it again. Verify by reading the stored record (list or change log), then verify_saved`;
}

// The brief: a question's answer goes on a line "respuesta: <value>". A task that fails carries no such line.
function buildSummary(end: LoopEnd): string {
  const hasAnswer = end.estado === 'terminada' && end.answer !== undefined && end.answer.trim() !== '';
  if (!hasAnswer) return end.summary;
  return `respuesta: ${end.answer!.trim()}\n${end.summary}`;
}

function describeAction(action: Exclude<Action, Finish>): string {
  switch (action.kind) {
    case 'click':
      return `${action.commits ? 'commit click' : 'click'} (${action.x}, ${action.y})`;
    case 'read_rows':
      return `read_rows "${action.table}" (${action.rows.length} rows)`;
    case 'verify_saved':
      return `verify_saved: ${action.evidence}`;
    case 'type':
      return `${action.replace ? 'replace with' : 'type'} ${JSON.stringify(action.text)}`;
    case 'keys':
      return `keys ${action.keys.join('+')}`;
    case 'scroll':
      return `scroll ${action.direction} ${action.steps} at (${action.x}, ${action.y})`;
  }
}

function describeResult(result: ActionResult): string {
  if (result.stillChanging) return 'screen still changing';
  return result.changed ? 'screen changed' : 'no visible change';
}

function usageOf(usage: ModelUsage): Record<string, number> {
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd };
}
