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

test('rejects body containing a script tag', () => {
  const result = checkGuardrails('<p>Intro.</p><script>alert(1)</script>');
  assert.equal(result.ok, false);
  assert.match(result.reason, /disallowed markup/);
});

test('rejects body containing an inline event handler', () => {
  const result = checkGuardrails('<p><a href="#" onclick="alert(1)">click</a></p>');
  assert.equal(result.ok, false);
  assert.match(result.reason, /disallowed markup/);
});

test('rejects body containing a javascript: URL', () => {
  const result = checkGuardrails('<p><a href="javascript:alert(1)">click</a></p>');
  assert.equal(result.ok, false);
  assert.match(result.reason, /disallowed markup/);
});

test('accepts a clean body using only allowed tags', () => {
  const result = checkGuardrails(
    '<h2>Title</h2><p>Text with <a href="https://example.com">a link</a> and <strong>bold</strong>.</p>'
  );
  assert.equal(result.ok, true);
});
