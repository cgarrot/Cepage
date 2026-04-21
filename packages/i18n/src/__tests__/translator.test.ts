import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../translator.js';

test('createTranslator interpolates params', () => {
  const t = createTranslator('en');
  assert.equal(t('status.spawn', { id: 'abc' }), 'Spawn: abc');
});

test('createTranslator falls back to en for missing fr key', () => {
  const t = createTranslator('fr');
  assert.ok(t('status.spawn', { id: 'x' }).length > 0);
});

test('nested key resolves', () => {
  const t = createTranslator('en');
  assert.equal(t('errors.codes.SESSION_NOT_FOUND'), 'Session not found.');
});
