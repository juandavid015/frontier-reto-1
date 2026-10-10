// Experiment: drive the desktop by hand, one step per argument, with a screenshot after each step.
// Usage: npm run probe:input -- click:120,48 "type:Papelería" keys:Control+a scroll:640,400,down,3 wait:1000
//   click:X,Y            left click held for the configured time
//   type:TEXT            type TEXT into the focused field (appends)
//   replace:TEXT         select all, then type TEXT
//   keys:K1+K2           press keys together, e.g. Enter, Escape, Control+a (names in src/desktop/keysyms.ts)
//   scroll:X,Y,DIR,N     N wheel steps, DIR up or down
//   wait:MS              just wait

import { setTimeout as sleep } from 'node:timers/promises';
import { Desktop, type ActionResult } from '../src/desktop/desktop.ts';
import { createRunDirectory, desktopSettings, runProbe, saveFrame } from './probe-support.ts';

type Step = { kind: string; argument: string };

await runProbe(async () => {
  const steps = process.argv.slice(2).map(parseStep);
  if (steps.length === 0) throw new Error('Give at least one step, e.g. click:120,48');
  const { url, password, host } = desktopSettings();
  console.log(`Connecting to ${host} ...`);
  const desktop = await Desktop.connect({ url, password });
  try {
    const directory = await createRunDirectory();
    console.log(
      `Screen ${desktop.width}x${desktop.height}. Saved ${await saveFrame(directory, '00-start', desktop.screenshot())}`,
    );
    for (const [index, step] of steps.entries()) {
      const result = await runStep(desktop, step);
      const name = `${String(index + 1).padStart(2, '0')}-${step.kind}`;
      const file = await saveFrame(directory, name, desktop.screenshot());
      console.log(`${name} ${describeStep(step)} -> ${describeResult(result)}. Saved ${file}`);
    }
  } finally {
    desktop.close();
    console.log('Connection closed');
  }
});

function parseStep(argument: string): Step {
  const separator = argument.indexOf(':');
  if (separator < 0) throw new Error(`Step "${argument}" needs the form kind:argument`);
  return { kind: argument.slice(0, separator), argument: argument.slice(separator + 1) };
}

async function runStep(desktop: Desktop, step: Step): Promise<ActionResult | undefined> {
  switch (step.kind) {
    case 'click': {
      const [x, y] = numbers(step.argument, 2);
      return desktop.click(x!, y!);
    }
    case 'type':
      return desktop.typeText(step.argument);
    case 'replace':
      return desktop.replaceText(step.argument);
    case 'keys':
      return desktop.pressKeys(step.argument.split('+'));
    case 'scroll': {
      const [x, y, direction, count] = step.argument.split(',');
      if (direction !== 'up' && direction !== 'down') throw new Error(`Scroll direction must be up or down`);
      return desktop.scroll(Number(x), Number(y), direction, Number(count));
    }
    case 'wait':
      await sleep(Number(step.argument));
      return undefined;
    default:
      throw new Error(`Unknown step kind "${step.kind}"`);
  }
}

function numbers(argument: string, count: number): number[] {
  const values = argument.split(',').map(Number);
  if (values.length !== count || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Expected ${count} numbers separated by commas, got "${argument}"`);
  }
  return values;
}

// Shows each character's code point too, so we can tell a typing problem from a terminal encoding problem.
function describeStep(step: Step): string {
  if (step.kind !== 'type' && step.kind !== 'replace') return step.argument;
  const codePoints = [...step.argument].map((character) => character.codePointAt(0)!.toString(16)).join(' ');
  return `${JSON.stringify(step.argument)} [${codePoints}]`;
}

function describeResult(result: ActionResult | undefined): string {
  if (!result) return 'done';
  if (result.stillChanging) return `still changing after ${result.waitedMs} ms`;
  return result.changed ? `screen changed, stable after ${result.waitedMs} ms` : `no change in ${result.waitedMs} ms`;
}
