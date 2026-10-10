import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { StepReplySchema } from './actions.ts';

const click = { kind: 'click', x: 10, y: 20, commits: false };

test('the schema still produces the JSON Schema the model sees, with action as an object', () => {
  const schema = z.toJSONSchema(StepReplySchema, { io: 'input' }) as { properties: Record<string, unknown> };
  assert.ok('action' in schema.properties);
});

test('an action sent as a JSON string is parsed (run 4, E3)', () => {
  const reply = StepReplySchema.parse({ observation: 'o', plan: 'p', action: JSON.stringify(click) });
  assert.deepEqual(reply.action, click);
});

test('a reply without observation or plan keeps its valid action', () => {
  assert.deepEqual(StepReplySchema.parse({ action: click }), { observation: '', plan: '', action: click });
});

test('an action that is neither an object nor valid JSON is still rejected', () => {
  assert.equal(StepReplySchema.safeParse({ action: 'click the button' }).success, false);
});

test('read_rows with rows and finish with a count are accepted', () => {
  const rows = {
    kind: 'read_rows',
    table: 'facturas',
    rows: [{ id: 'INV-1', values: { cliente: 'X' } }],
    after_next: false,
  };
  assert.equal(StepReplySchema.safeParse({ action: rows }).success, true);
  const finish = {
    kind: 'finish',
    estado: 'terminada',
    summary: 's',
    count: { table: 'facturas', where: { cliente: 'X' } },
  };
  assert.equal(StepReplySchema.safeParse({ action: finish }).success, true);
});
