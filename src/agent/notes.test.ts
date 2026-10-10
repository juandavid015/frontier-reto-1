import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Notes } from './notes.ts';

test('notes keep facts once, trimmed, in order', () => {
  const notes = new Notes();
  notes.add(['  appointment A-12 on 22/10 at 9:00 ', 'doctor D-3']);
  notes.add(['doctor D-3', '']);
  assert.deepEqual(notes.list(), ['appointment A-12 on 22/10 at 9:00', 'doctor D-3']);
});

test('notes are capped, dropping the oldest, and each note is cut to a fixed length', () => {
  const notes = new Notes();
  notes.add(Array.from({ length: 45 }, (_, index) => `fact ${index}`));
  notes.add(['x'.repeat(500)]);
  const list = notes.list();
  assert.equal(list.length, 40);
  assert.equal(list[0], 'fact 6');
  assert.equal(list.at(-1)!.length, 200);
});
