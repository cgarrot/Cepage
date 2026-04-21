import assert from 'node:assert/strict';
import test from 'node:test';
import { statusFromApiErr, statusFromThrown } from '../api-error.js';

test('statusFromApiErr uses server key when present', () => {
  const s = statusFromApiErr({
    code: 'HTTP_ERROR',
    message: 'SESSION_NOT_FOUND',
    key: 'errors.codes.SESSION_NOT_FOUND',
  });
  assert.equal(s.key, 'errors.codes.SESSION_NOT_FOUND');
});

test('statusFromApiErr derives domain code from message', () => {
  const s = statusFromApiErr({
    code: 'HTTP_ERROR',
    message: 'RUN_NOT_FOUND',
  });
  assert.equal(s.key, 'errors.codes.RUN_NOT_FOUND');
});

test('statusFromThrown maps to generic', () => {
  const s = statusFromThrown(new Error('boom'));
  assert.equal(s.key, 'errors.codes.GENERIC');
  assert.equal(s.params?.message, 'boom');
});
