import { Desktop, type ActionResult } from '../desktop/desktop.ts';
import { encodePng } from '../image/png.ts';
import { redact } from '../secrets/redact.ts';
import type { Action, StepReply } from './actions.ts';
import { agentConfig } from './config.ts';
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
type LoopEnd = { estado: Estado; summary: string; answer?: string | undefined };

export async function runTask(input: TaskInput): Promise<TaskOutcome> {
  const startedAt = performance.now();
  const secrets = [input.desktop.password, input.apiKey];
  const trace = await Trace.create(input.traceRoot, input.taskId, secrets);
  const counters = { steps: 0, costUsd: 0 };
  await trace.event('task', { task: input.task, model: input.model ?? agentConfig.model });

  let desktop: Desktop | undefined;
  let end: LoopEnd;
  try {
    desktop = await Desktop.connect(input.desktop);
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

async function agentLoop(
  desktop: Desktop,
  input: TaskInput,
  trace: Trace,
  counters: { steps: number; costUsd: number },
  startedAt: number,
): Promise<LoopEnd> {
  const history: string[] = [];
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
    if (reply.action.kind === 'finish') return finishFrom(reply.action);

    const result = await act(desktop, reply.action);
    history.push(`${step}. ${describeAction(reply.action)} (${reply.plan}) -> ${result}`);
    await trace.event('step', { step, observation: reply.observation, plan: reply.plan, action: reply.action, result });
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
      ok: result.ok,
    });
    if (result.ok) return result.reply;
    await trace.event('invalid_reply', { step, error: result.error });
    prompt = `${text}\n\nYour previous reply was rejected: ${result.error}. Reply again with a valid action.`;
  }
  throw new Error(`The model gave no valid action at step ${step}`);
}

async function act(desktop: Desktop, action: Exclude<Action, Finish>): Promise<string> {
  try {
    return describeResult(await runAction(desktop, action));
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function runAction(desktop: Desktop, action: Exclude<Action, Finish>): Promise<ActionResult> {
  switch (action.kind) {
    case 'click':
      return desktop.click(action.x, action.y);
    case 'type':
      return action.replace ? desktop.replaceText(action.text) : desktop.typeText(action.text);
    case 'keys':
      return desktop.pressKeys(action.keys);
    case 'scroll':
      return desktop.scroll(action.x, action.y, action.direction, action.steps);
  }
}

function finishFrom(action: Finish): LoopEnd {
  return { estado: action.estado, summary: action.summary, answer: action.answer };
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
      return `click (${action.x}, ${action.y})`;
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
