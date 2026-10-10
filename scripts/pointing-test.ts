// Pointing test: which model clicks where we mean? Each target is a description and a box in screen pixels; a hit
// is a point inside the box (edges included). Every model gets the same prompt, image and schema as one tool call.
// Usage: pnpm pointing [model ...]   (default: the three candidates in NOTES.md)

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { requestToolCall, type ModelUsage } from '../src/agent/model-client.ts';
import { runProbe } from './probe-support.ts';

const DATA_DIRECTORY = path.join('evals', 'pointing');
const DEFAULT_MODELS = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash'];
// The screenshots are the desktop's size; the prompt states it so the model answers in the same pixels.
const SCREEN = { width: 1280, height: 800 };

const TargetSchema = z.object({
  image: z.string(),
  target: z.string(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
type Target = z.infer<typeof TargetSchema>;

const PointSchema = z.object({ x: z.number(), y: z.number() });

type Attempt = {
  model: string;
  target: string;
  image: string;
  point?: { x: number; y: number };
  hit: boolean;
  error?: string;
  usage: ModelUsage;
};

await runProbe(async () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY in .env');
  const models = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_MODELS;
  const targets = await loadTargets();
  const images = new Map<string, Buffer>();
  for (const target of targets) {
    if (!images.has(target.image)) images.set(target.image, await readFile(path.join(DATA_DIRECTORY, target.image)));
  }

  const attempts: Attempt[] = [];
  for (const model of models) {
    // One model at a time, targets in parallel: a model's latency does not depend on the others.
    const results = await Promise.all(targets.map((target) => point(apiKey, model, target, images.get(target.image)!)));
    attempts.push(...results);
    console.log(summarize(model, results));
    for (const miss of results.filter((result) => !result.hit)) {
      console.log(`  miss: ${miss.target} at ${JSON.stringify(miss.point ?? miss.error)}`);
    }
  }
  const directory = path.join('artifacts', 'pointing');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(file, JSON.stringify(attempts, null, 2));
  console.log(`Saved ${file}`);
});

async function loadTargets(): Promise<Target[]> {
  const text = await readFile(path.join(DATA_DIRECTORY, 'targets.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => TargetSchema.parse(JSON.parse(line)));
}

async function point(apiKey: string, model: string, target: Target, imagePng: Buffer): Promise<Attempt> {
  const base = { model, target: target.target, image: target.image };
  try {
    const result = await requestToolCall(
      {
        apiKey,
        model,
        system: `You point at elements in screenshots. The screenshot is ${SCREEN.width}x${SCREEN.height} pixels, origin at the top-left. Reply by calling the act tool with the pixel coordinates of the center of the element.`,
        text: `Point at: ${target.target}`,
        imagePng,
      },
      PointSchema,
    );
    if (!result.ok) return { ...base, hit: false, error: result.error, usage: result.usage };
    return { ...base, point: result.reply, hit: isInside(result.reply, target.box), usage: result.usage };
  } catch (error) {
    const empty = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    return { ...base, hit: false, error: error instanceof Error ? error.message : String(error), usage: empty };
  }
}

function isInside(point: { x: number; y: number }, [x1, y1, x2, y2]: Target['box']): boolean {
  return point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
}

function summarize(model: string, results: Attempt[]): string {
  const hits = results.filter((result) => result.hit).length;
  const cost = results.reduce((sum, result) => sum + result.usage.costUsd, 0);
  const tokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0) / results.length;
  return `${model}: ${hits}/${results.length} hits, cost $${cost.toFixed(4)}, ${Math.round(tokens)} input tokens per call`;
}
