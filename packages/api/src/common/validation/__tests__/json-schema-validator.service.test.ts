import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonSchemaValidatorService } from '../json-schema-validator.service.js';

const service = new JsonSchemaValidatorService();

test('validate() accepts payloads that match the typed skill contract', () => {
  const schema = {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['topic'],
    additionalProperties: false,
  };
  const result = service.validate(schema, { topic: 'ship fast', limit: 5 }, 'test-ok');
  assert.equal(result.ok, true);
});

test('validate() surfaces per-field errors with a human path', () => {
  const schema = {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
    },
    required: ['email'],
  };
  const result = service.validate(schema, { email: 'not-an-email' }, 'test-email');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0].path, /email/);
});

test('validate() caches compiled validators by cacheKey', () => {
  const schema = { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] };
  const key = 'cache-key';
  const a = service.validate(schema, { foo: 'a' }, key);
  const b = service.validate(schema, { foo: 'b' }, key);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test('invalidate() forces a recompile for the same key', () => {
  const key = 'invalidate-key';
  const loose = { type: 'object' };
  const strict = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  };
  assert.equal(service.validate(loose, {}, key).ok, true);
  service.invalidate(key);
  const result = service.validate(strict, {}, key);
  assert.equal(result.ok, false);
});
