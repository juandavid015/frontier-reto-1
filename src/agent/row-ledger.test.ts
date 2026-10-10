import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RowLedger } from './row-ledger.ts';

const page = (ids: number[], cliente: string, estado = 'Vencida') =>
  ids.map((id) => ({ id: `INV-${id}`, values: { Cliente: cliente, Estado: estado } }));

test('counts only rows whose name matches exactly, not a longer name', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', [...page([1, 2], 'Comercial Alba'), ...page([3], 'Comercial Alba Norte')]);
  assert.equal(ledger.count('facturas', { cliente: 'Comercial Alba' }).count, 2);
});

test('a row read twice (going back a page) counts once', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page([1, 2], 'Comercial Alba'));
  ledger.record('facturas', page([3], 'Comercial Alba'));
  const again = ledger.record('facturas', page([1, 2], 'Comercial Alba'));
  assert.deepEqual(again, { added: 0, total: 3 });
  assert.equal(ledger.count('facturas', { cliente: 'Comercial Alba' }).count, 3);
});

test('all conditions must match: client and state', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', [...page([1], 'Comercial Alba'), ...page([2], 'Comercial Alba', 'Pagada')]);
  assert.equal(ledger.count('facturas', { cliente: 'Comercial Alba', estado: 'Vencida' }).count, 1);
});

test('accents matter, extra spaces and column case do not', () => {
  const ledger = new RowLedger();
  ledger.record('Facturas', page([1], '  Comercial   Albán '));
  assert.equal(ledger.count('facturas', { CLIENTE: 'Comercial Albán' }).count, 1);
  assert.equal(ledger.count('facturas', { cliente: 'Comercial Alban' }).count, 0);
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test('three full pages read back and forth prove nothing about the end of the list (run 5)', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page(range(1, 20), 'Comercial Alba'));
  ledger.record('facturas', page(range(21, 40), 'Comercial Alba'), { afterNext: true });
  ledger.record('facturas', page(range(41, 60), 'Comercial Alba'), { afterNext: true });
  ledger.record('facturas', page(range(21, 40), 'Comercial Alba'), { afterNext: false });
  ledger.record('facturas', page(range(21, 40), 'Comercial Alba'), { afterNext: false });
  assert.equal(ledger.endOfListEvidence('facturas'), undefined);
});

test('a last page shorter than the others proves the end', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page(range(1, 20), 'Comercial Alba'));
  ledger.record('facturas', page(range(21, 31), 'Comercial Alba'), { afterNext: true });
  assert.match(ledger.endOfListEvidence('facturas') ?? '', /11 rows, shorter than the others \(20\)/);
});

test('a total shown by the app proves the end only when it equals the distinct rows read', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page(range(1, 20), 'Comercial Alba'), { afterNext: false, totalShown: 45 });
  assert.equal(ledger.endOfListEvidence('facturas'), undefined);
  ledger.record('facturas', page(range(21, 40), 'Comercial Alba'), { afterNext: true, totalShown: 40 });
  assert.match(ledger.endOfListEvidence('facturas') ?? '', /total of 40/);
});

test('"next" showing the same rows as the page before proves the end; the same rows without "next" do not', () => {
  const single = new RowLedger();
  single.record('facturas', page(range(1, 7), 'Comercial Alba'));
  single.record('facturas', page(range(1, 7), 'Comercial Alba'), { afterNext: false });
  assert.equal(single.endOfListEvidence('facturas'), undefined);
  single.record('facturas', page(range(1, 7), 'Comercial Alba'), { afterNext: true });
  assert.match(single.endOfListEvidence('facturas') ?? '', /same rows again/);
});

test('a condition on a column no row has is reported, so the summary can say why the count is 0', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page([1], 'Comercial Alba'));
  assert.deepEqual(ledger.count('facturas', { vence: 'hoy' }), { count: 0, rowsRead: 1, missingColumns: ['vence'] });
});
