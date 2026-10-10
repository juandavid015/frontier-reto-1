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

test('a condition on a column no row has is reported, so the summary can say why the count is 0', () => {
  const ledger = new RowLedger();
  ledger.record('facturas', page([1], 'Comercial Alba'));
  assert.deepEqual(ledger.count('facturas', { vence: 'hoy' }), { count: 0, rowsRead: 1, missingColumns: ['vence'] });
});
