import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuardrails } from './guardrails.js';

test('accepts body with no rate figures', () => {
  const result = checkGuardrails('<p>The ECB is expected to raise rates this week.</p>');
  assert.equal(result.ok, true);
});

test('rejects body containing a decimal percentage figure', () => {
  const result = checkGuardrails('<p>PTSB now offers loans at 7.2% APR.</p>');
  assert.equal(result.ok, false);
  assert.match(result.reason, /rate\/percentage figure/);
});

test('rejects body containing a whole-number percentage figure', () => {
  const result = checkGuardrails('<p>Inflation hit 5% last month.</p>');
  assert.equal(result.ok, false);
});

test('does not false-positive on unrelated numbers', () => {
  const result = checkGuardrails('<p>Budget 2027 introduces new tax credit changes.</p>');
  assert.equal(result.ok, true);
});
