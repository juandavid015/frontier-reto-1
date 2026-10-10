import { z } from 'zod';
import { NAMED_KEYS } from '../desktop/keysyms.ts';

// The only things the model can ask for. This schema validates every reply and generates the JSON Schema the model
// sees, so the two can never drift apart.

const coordinate = z.number().int().nonnegative();
const columnValues = z.record(z.string(), z.string());

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: coordinate,
    y: coordinate,
    commits: z
      .boolean()
      .describe('true when this click stores a change: save, create, apply, export, delete, void, confirm'),
    record: z
      .string()
      .optional()
      .describe('When commits is true: the record it applies to, e.g. "customer C-7" or "new customer Tienda Sol"'),
  }),
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
    kind: z.literal('read_rows'),
    table: z.string().min(1).describe('A short name for the list, the same on every page, e.g. "facturas"'),
    rows: z
      .array(z.object({ id: z.string().min(1), values: columnValues }))
      .describe('Every row visible now. Only its id and the columns your count checks, copied exactly as on screen'),
  }),
  z.object({
    kind: z.literal('verify_saved'),
    evidence: z.string().min(1).describe('Where you read the stored record and what it shows, e.g. the list row'),
  }),
  z.object({
    kind: z.literal('finish'),
    estado: z.enum(['terminada', 'fallida']),
    summary: z.string().min(1).describe('What you did and saw, with the exact data that explains the outcome'),
    answer: z
      .string()
      .optional()
      .describe('Only when the task asks a question that is not a count: just the value(s), "a; b" for two'),
    count: z
      .object({ table: z.string().min(1), where: columnValues })
      .optional()
      .describe('When the question asks how many: code counts the rows you read with read_rows that match exactly'),
  }),
]);

// Models sometimes send a nested object as a JSON string (run 4, E3: action arrived as "{\"kind\": ...}"). Parsing it
// here keeps a correct action from being thrown away; anything that is not valid JSON is left for the schema to reject.
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const StepReplySchema = z.object({
  // Only the trace reads these two, so a reply without them still counts if its action is valid.
  observation: z.string().default('').describe('What the current screen shows that matters for the task'),
  plan: z.string().default('').describe('Why this action is the next step'),
  action: z.preprocess(parseIfJsonString, ActionSchema),
});

export type Action = z.infer<typeof ActionSchema>;
export type StepReply = z.infer<typeof StepReplySchema>;
