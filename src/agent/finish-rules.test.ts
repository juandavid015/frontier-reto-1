import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommitGuard } from './commit-guard.ts';
import { checkFinish } from './finish-rules.ts';
import { RowLedger } from './row-ledger.ts';

const rows = (from: number, to: number, cliente = 'Comercial Alba') =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ id: `INV-${from + index}`, values: { cliente } }));
const done = (extra: object = {}) => ({
  kind: 'finish' as const,
  estado: 'terminada' as const,
  summary: 's',
  ...extra,
});
const countAlba = { count: { table: 'facturas', where: { cliente: 'Comercial Alba' } } };

test('fallida is always accepted, even with an unverified commit', () => {
  const guard = new CommitGuard();
  guard.recordCommit('customer C-7', 10, 10);
  const decision = checkFinish({ ...done(), estado: 'fallida' }, new RowLedger(), guard);
  assert.equal(decision.accepted, true);
});

test('terminada after reading rows, with no count and no answer, is refused (run 5)', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', rows(1, 20));
  const decision = checkFinish(done(), ledger, new CommitGuard());
  assert.equal(decision.accepted, false);
});

test('a create that read rows to verify its save is accepted without an answer (run 6, E1)', () => {
  const ledger = new RowLedger();
  ledger.record('clientes', rows(1, 1));
  const guard = new CommitGuard();
  guard.recordCommit('new customer Tienda Sol', 10, 10);
  guard.markVerified();
  assert.equal(checkFinish(done(), ledger, guard).accepted, true);
});

test('terminada with no rows read and no answer is accepted (a create or edit task)', () => {
  assert.equal(checkFinish(done(), new RowLedger(), new CommitGuard()).accepted, true);
});

test('a count over full pages with no proof of the end is refused (run 5)', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', rows(1, 20));
  ledger.record('facturas', rows(21, 40), { afterNext: true });
  ledger.record('facturas', rows(41, 60), { afterNext: true });
  const decision = checkFinish(done(countAlba), ledger, new CommitGuard());
  assert.equal(decision.accepted, false);
  assert.match(decision.accepted ? '' : decision.reason, /nothing proves every page was read/);
});

test('a count with a shorter last page is accepted, and code writes the answer', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', [...rows(1, 18), ...rows(19, 20, 'Comercial Alba Norte')]);
  ledger.record('facturas', rows(21, 31), { afterNext: true });
  const decision = checkFinish(done({ ...countAlba, answer: '99' }), ledger, new CommitGuard());
  assert.ok(decision.accepted);
  assert.equal(decision.end.answer, '29');
  assert.match(decision.end.summary, /Counted by code: 29 of 31 rows read/);
});

test('terminada with an unverified commit is refused', () => {
  const guard = new CommitGuard();
  guard.recordCommit('customer C-7', 10, 10);
  assert.equal(checkFinish(done(), new RowLedger(), guard).accepted, false);
});
