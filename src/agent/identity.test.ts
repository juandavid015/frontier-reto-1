import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveIdentity, type Candidate } from './identity.ts';

const person = (record_id: string, full_name: string, ...identifiers: string[]): Candidate => ({
  record_id,
  full_name,
  identifiers,
});
const ask = (name: string, candidates: Candidate[], other_identifiers: string[] = [], list_complete = true) =>
  resolveIdentity({ name, candidates, other_identifiers, list_complete });

test('an exact match wins over a longer name that contains it (practice regression)', () => {
  const decision = ask('Comercial Alba', [person('C-1', 'Comercial Alba Norte'), person('C-2', 'Comercial Alba')]);
  assert.equal(decision.chosen?.record_id, 'C-2');
});

test('two records with the same name are ambiguous and name both (practice regression)', () => {
  const decision = ask('Lucía Mora', [person('P-5', 'Lucía Mora', '111'), person('P-31', 'Lucía Mora', '222')]);
  assert.equal(decision.chosen, undefined);
  assert.match(decision.chosen ? '' : decision.reason, /ambiguous: Lucía Mora \(P-5\); Lucía Mora \(P-31\)/);
});

test('a shorter form of a name picks the only record that contains all its words', () => {
  const decision = ask('Dra. Elena Ríos', [person('M-1', 'Dra. Elena Ríos Vargas'), person('M-2', 'Dr. Tomás Gil')]);
  assert.equal(decision.chosen?.record_id, 'M-1');
  assert.equal(decision.chosen ? decision.how : '', 'shorter form of the name');
});

test('a shorter form matching two records is ambiguous', () => {
  const decision = ask('Elena Ríos', [person('M-1', 'Elena Ríos Vargas'), person('M-7', 'Elena Ríos Peña')]);
  assert.equal(decision.chosen, undefined);
});

test('words are whole words, ignoring case and accents', () => {
  assert.equal(ask('elena rios', [person('M-1', 'Elena Ríos Vargas')]).chosen?.record_id, 'M-1');
  assert.equal(ask('Ana Ríos', [person('M-9', 'Anabel Ríos')]).chosen, undefined);
});

test('another identifier from the task must match; it also settles same-name records', () => {
  const twins = [person('P-5', 'Lucía Mora', '41.222.333'), person('P-31', 'Lucía Mora', '80111222')];
  assert.equal(ask('Lucía Mora', twins, ['41222333']).chosen?.record_id, 'P-5');
  assert.equal(ask('Lucía Mora', twins, ['999']).chosen, undefined);
});

test('nothing is chosen unless the whole result list was seen', () => {
  assert.equal(ask('Comercial Alba', [person('C-2', 'Comercial Alba')], [], false).chosen, undefined);
});
