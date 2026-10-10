import { z } from 'zod';
import { NAMED_KEYS } from '../desktop/keysyms.ts';

// The only things the model can ask for. This schema validates every reply and generates the JSON Schema the model
// sees, so the two can never drift apart.

const coordinate = z.number().int().nonnegative();

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: coordinate, y: coordinate }),
  z.object({
    kind: z.literal('type'),
    text: z.string().min(1),
    replace: z
      .boolean()
      .describe('true selects all text in the focused field first, so the field ends with exactly this text'),
  }),
  z.object({
    kind: z.literal('keys'),
    keys: z
      .array(z.string().min(1))
      .min(1)
      .max(3)
      .describe(
        `Pressed together. Named keys: ${Object.keys(NAMED_KEYS).join(', ')}; or one character, e.g. ["Control", "a"]`,
      ),
  }),
  z.object({
    kind: z.literal('scroll'),
    x: coordinate,
    y: coordinate,
    direction: z.enum(['up', 'down']),
    steps: z.number().int().min(1).max(10),
  }),
  z.object({
    kind: z.literal('finish'),
    estado: z.enum(['terminada', 'fallida']),
    summary: z.string().min(1).describe('What you did and saw, with the exact data that explains the outcome'),
    answer: z
      .string()
      .optional()
      .describe('Only when the task asks a question and you found the answer: just the value(s), "a; b" for two'),
  }),
]);

export const StepReplySchema = z.object({
  observation: z.string().describe('What the current screen shows that matters for the task'),
  plan: z.string().describe('Why this action is the next step'),
  action: ActionSchema,
});

export type Action = z.infer<typeof ActionSchema>;
export type StepReply = z.infer<typeof StepReplySchema>;
