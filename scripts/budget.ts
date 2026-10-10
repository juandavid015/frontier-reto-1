// Prints what the OpenRouter key has spent and has left. Free: no model is called.
// Usage: pnpm budget

import { readKeyBudget } from '../src/agent/openrouter-key.ts';
import { runProbe } from './probe-support.ts';

await runProbe(async () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY in .env');
  const budget = await readKeyBudget(apiKey);
  if (!budget) throw new Error('Could not read the key budget from OpenRouter');
  const remaining = budget.remainingUsd === null ? 'no limit set' : `$${budget.remainingUsd.toFixed(3)}`;
  console.log(`Spent $${budget.usageUsd.toFixed(3)}. Remaining: ${remaining}.`);
});
