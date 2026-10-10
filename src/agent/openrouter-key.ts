import { agentConfig } from './config.ts';

// What the OpenRouter key has spent and has left, from GET /api/v1/key (free, no tokens). Checked on Oct 10: it
// returns `usage` and `limit_remaining` in US dollars. Logging it after each task shows what a validation spent.

export type KeyBudget = { usageUsd: number; remainingUsd: number | null };

const KEY_URL = 'https://openrouter.ai/api/v1/key';

/** Never throws: a budget we cannot read must not fail a task. */
export async function readKeyBudget(apiKey: string): Promise<KeyBudget | undefined> {
  try {
    const response = await fetch(KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(agentConfig.modelTimeoutMs),
    });
    if (!response.ok) return undefined;
    const { data } = (await response.json()) as { data?: { usage?: unknown; limit_remaining?: unknown } };
    if (typeof data?.usage !== 'number') return undefined;
    const remainingUsd = typeof data.limit_remaining === 'number' ? data.limit_remaining : null;
    return { usageUsd: data.usage, remainingUsd };
  } catch {
    return undefined;
  }
}
