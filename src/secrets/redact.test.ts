import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, redactKeyLikeTokens } from './redact.ts';

test('every copy of every known secret is replaced, even a short one; empty secrets are ignored', () => {
  assert.equal(redact('pw=ab, again ab', ['ab', '', undefined]), 'pw=[redacted], again [redacted]');
});

test('key-shaped tokens are removed from a summary', () => {
  assert.equal(redactKeyLikeTokens('La clave es XYZ-7F3A-91QD.'), 'La clave es [redacted].');
  assert.equal(redactKeyLikeTokens('key sk-or-v1-0a1b2c3d4e'), 'key [redacted]');
  assert.equal(redactKeyLikeTokens('token a1b2c3d4e5f6a7b8c9d0e1'), 'token [redacted]');
});

test('ordinary ids, dates, amounts and phone numbers stay', () => {
  const text =
    'Factura INV-10218, pago TRF-550217, cita A-1430, autorización AUT-2026-118734, ' +
    'fecha 2026-10-13, 13/10/2026, valor 1.190.000, tel 3001112234, usuario caja03, respuesta: 45';
  assert.equal(redactKeyLikeTokens(text), text);
});
