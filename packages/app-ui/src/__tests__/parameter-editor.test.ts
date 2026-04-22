import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonSchema } from '@cepage/shared-core';
import {
  addProperty,
  changePropertyType,
  makePropertySchema,
  parseEnumInput,
  removeProperty,
  renameProperty,
  serializeEnumInput,
  toggleRequired,
  updateProperty,
  validateParameterSchema,
} from '../parameter-editor-helpers.js';

const emptySchema: JsonSchema = { type: 'object', properties: {}, required: [] };

test('makePropertySchema builds string schema', () => {
  assert.deepEqual(makePropertySchema('string'), { type: 'string' });
});

test('makePropertySchema builds array schema with string items', () => {
  assert.deepEqual(makePropertySchema('array'), { type: 'array', items: { type: 'string' } });
});

test('validateParameterSchema returns empty for valid schema', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', default: 'hello' },
      count: { type: 'integer', default: 5 },
    },
    required: ['name'],
  };
  assert.deepEqual(validateParameterSchema(schema), []);
});

test('validateParameterSchema flags empty parameter name', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      '': { type: 'string' },
    },
  };
  const errors = validateParameterSchema(schema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].key, '');
  assert.ok(errors[0].message.includes('empty'));
});

test('renameProperty prevents overwriting an existing key', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
  };
  const next = renameProperty(schema, 'a', 'b');
  assert.deepEqual(Object.keys(next.properties ?? {}), ['a', 'b']);
});

test('validateParameterSchema flags unsupported type', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      bad: { type: 'object' },
    },
  };
  const errors = validateParameterSchema(schema);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes('Unsupported'));
});

test('validateParameterSchema flags default value type mismatch', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      count: { type: 'integer', default: 'not a number' },
    },
  };
  const errors = validateParameterSchema(schema);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes('Default value'));
});

test('validateParameterSchema accepts valid boolean default', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      active: { type: 'boolean', default: true },
    },
  };
  assert.deepEqual(validateParameterSchema(schema), []);
});

test('validateParameterSchema accepts valid array default', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      tags: { type: 'array', default: ['a', 'b'] },
    },
  };
  assert.deepEqual(validateParameterSchema(schema), []);
});

test('renameProperty renames a key and updates required', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { oldName: { type: 'string' } },
    required: ['oldName'],
  };
  const next = renameProperty(schema, 'oldName', 'newName');
  assert.deepEqual(Object.keys(next.properties ?? {}), ['newName']);
  assert.deepEqual(next.required, ['newName']);
});

test('renameProperty is noop when oldKey equals newKey', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { name: { type: 'string' } },
  };
  const next = renameProperty(schema, 'name', 'name');
  assert.strictEqual(next, schema);
});

test('updateProperty patches a single property', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { name: { type: 'string' } },
  };
  const next = updateProperty(schema, 'name', { default: 'world' });
  assert.deepEqual(next.properties?.name, { type: 'string', default: 'world' });
});

test('changePropertyType resets schema and preserves description', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      count: { type: 'string', description: 'Item count', default: '5' },
    },
  };
  const next = changePropertyType(schema, 'count', 'integer');
  assert.equal(next.properties?.count?.type, 'integer');
  assert.equal(next.properties?.count?.description, 'Item count');
  assert.equal(next.properties?.count?.default, undefined);
});

test('removeProperty deletes key and strips from required', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a', 'b'],
  };
  const next = removeProperty(schema, 'a');
  assert.deepEqual(Object.keys(next.properties ?? {}), ['b']);
  assert.deepEqual(next.required, ['b']);
});

test('addProperty appends a new property with given type', () => {
  const next = addProperty(emptySchema, 'foo', 'boolean');
  assert.deepEqual(next.properties?.foo, { type: 'boolean' });
});

test('toggleRequired adds key when absent', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { x: { type: 'string' } },
    required: [],
  };
  const next = toggleRequired(schema, 'x');
  assert.deepEqual(next.required, ['x']);
});

test('toggleRequired removes key when present', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { x: { type: 'string' } },
    required: ['x'],
  };
  const next = toggleRequired(schema, 'x');
  assert.deepEqual(next.required, []);
});

test('parseEnumInput splits comma-separated values', () => {
  assert.deepEqual(parseEnumInput('a, b, c'), ['a', 'b', 'c']);
});

test('parseEnumInput returns undefined for empty string', () => {
  assert.equal(parseEnumInput(''), undefined);
  assert.equal(parseEnumInput('   '), undefined);
});

test('serializeEnumInput joins values with comma and space', () => {
  assert.equal(serializeEnumInput(['x', 'y']), 'x, y');
});

test('serializeEnumInput returns empty string for undefined', () => {
  assert.equal(serializeEnumInput(undefined), '');
});
