import { z } from 'zod';
import { agentConfig } from './config.ts';
import { StepReplySchema, type StepReply } from './actions.ts';

// One call to a model through OpenRouter's OpenAI-compatible chat API. The model answers by calling a single tool
// whose parameters are the JSON Schema generated from a Zod schema; we validate the arguments with the same schema.

export type ModelUsage = { inputTokens: number; outputTokens: number; costUsd: number };

export type ModelRequest = {
  apiKey: string;
  model?: string;
  system: string;
  text: string;
  imagePng: Buffer;
};

export type ToolCallResult<T> =
  { ok: true; reply: T; usage: ModelUsage } | { ok: false; error: string; usage: ModelUsage };

const TOOL_NAME = 'act';

export function requestStep(request: ModelRequest): Promise<ToolCallResult<StepReply>> {
  return requestToolCall(request, StepReplySchema);
}

export async function requestToolCall<T>(request: ModelRequest, schema: z.ZodType<T>): Promise<ToolCallResult<T>> {
  const { $schema: _unused, ...toolParameters } = z.toJSONSchema(schema);
  const response = await fetch(agentConfig.openRouterUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(agentConfig.modelTimeoutMs),
    headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model ?? agentConfig.model,
      max_tokens: agentConfig.maxOutputTokens,
      temperature: 0,
      usage: { include: true },
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: request.text },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${request.imagePng.toString('base64')}` } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: TOOL_NAME, description: 'Reply', parameters: toolParameters } }],
      // Forcing the tool is refused by some providers (Bedrock for Sonnet 5.5, eval run 19-48-13), so the prompt asks
      // for it and a reply without it counts as invalid and is retried.
      tool_choice: 'auto',
    }),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`Model call failed with HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return parseResponse(body, schema);
}

function parseResponse<T>(body: unknown, schema: z.ZodType<T>): ToolCallResult<T> {
  const data = body as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }>; content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const usage: ModelUsage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    costUsd: data.usage?.cost ?? 0,
  };
  const argumentsText = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argumentsText) return { ok: false, error: 'The model did not call the tool', usage };
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return { ok: false, error: `Tool arguments are not JSON: ${argumentsText.slice(0, 200)}`, usage };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return { ok: false, error: `Invalid reply: ${z.prettifyError(result.error)}`, usage };
  return { ok: true, reply: result.data, usage };
}
