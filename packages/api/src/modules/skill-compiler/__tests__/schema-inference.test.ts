import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonSchema } from '@cepage/shared-core';
import { SchemaInferenceService } from '../schema-inference/schema-inference.service.js';
import type { Parameter } from '../parametrizer/parametrizer.service.js';

function makeParameter(overrides: Partial<Parameter> & { name: string }): Parameter {
  return {
    originalValue: '',
    inferredType: 'string',
    isSecret: false,
    suggestedDefault: '',
    ...overrides,
  };
}

function readItems(schema: JsonSchema): JsonSchema | undefined {
  return schema.items && !Array.isArray(schema.items) ? schema.items : undefined;
}

test('infers schema for stripe parameters', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'payment_provider', originalValue: 'Stripe', inferredType: 'string', suggestedDefault: 'Stripe' }),
    makeParameter({ name: 'api_key', originalValue: 'sk_live_xxx', inferredType: 'secret', isSecret: true, suggestedDefault: '' }),
    makeParameter({ name: 'webhook_events', originalValue: '["invoice.paid"]', inferredType: 'string', suggestedDefault: '[]' }),
    makeParameter({ name: 'sandbox_mode', originalValue: 'false', inferredType: 'boolean', suggestedDefault: 'false' }),
  ];

  const result = service.inferSchema(parameters);

  assert.equal(result.inputsSchema.type, 'object');
  assert.ok(result.inputsSchema.properties);
  assert.equal(Object.keys(result.inputsSchema.properties!).length, 4);
  assert.deepEqual(result.inputsSchema.required?.sort(), ['api_key', 'payment_provider', 'sandbox_mode', 'webhook_events']);

  assert.equal(result.inputsSchema.properties!.payment_provider.type, 'string');
  assert.equal(result.inputsSchema.properties!.payment_provider.default, 'Stripe');

  assert.equal(result.inputsSchema.properties!.api_key.type, 'string');
  assert.equal(result.inputsSchema.properties!.api_key.format, 'password');
  assert.equal(result.inputsSchema.properties!.api_key.writeOnly, true);

  assert.equal(result.inputsSchema.properties!.webhook_events.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.webhook_events)?.type, 'string');
  assert.deepEqual(result.inputsSchema.properties!.webhook_events.default, ['invoice.paid']);

  assert.equal(result.inputsSchema.properties!.sandbox_mode.type, 'boolean');
  assert.equal(result.inputsSchema.properties!.sandbox_mode.default, false);
});

test('detects email format', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'contact_email', originalValue: 'admin@example.com', suggestedDefault: 'admin@example.com' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.contact_email.type, 'string');
  assert.equal(result.inputsSchema.properties!.contact_email.format, 'email');
});

test('detects uri format', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'api_url', originalValue: 'https://api.stripe.com/v1', suggestedDefault: 'https://api.stripe.com/v1' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.api_url.type, 'string');
  assert.equal(result.inputsSchema.properties!.api_url.format, 'uri');
});

test('detects date format', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'start_date', originalValue: '2026-04-22', suggestedDefault: '2026-04-22' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.start_date.type, 'string');
  assert.equal(result.inputsSchema.properties!.start_date.format, 'date');
});

test('detects date-time format', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'created_at', originalValue: '2026-04-22T10:30:00Z', suggestedDefault: '2026-04-22T10:30:00Z' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.created_at.type, 'string');
  assert.equal(result.inputsSchema.properties!.created_at.format, 'date-time');
});

test('detects integer type', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'max_retries', originalValue: '3', inferredType: 'number', suggestedDefault: '3' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.max_retries.type, 'integer');
  assert.equal(result.inputsSchema.properties!.max_retries.default, 3);
});

test('detects float type', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'tax_rate', originalValue: '0.075', inferredType: 'number', suggestedDefault: '0.075' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.tax_rate.type, 'number');
  assert.equal(result.inputsSchema.properties!.tax_rate.default, 0.075);
});

test('detects boolean from string true/false', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'enable_logging', originalValue: 'true', inferredType: 'boolean', suggestedDefault: 'true' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.enable_logging.type, 'boolean');
  assert.equal(result.inputsSchema.properties!.enable_logging.default, true);
});

test('detects array of strings', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'tags', originalValue: '["alpha", "beta"]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.tags.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.tags)?.type, 'string');
  assert.deepEqual(result.inputsSchema.properties!.tags.default, ['alpha', 'beta']);
});

test('detects array of integers', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'port_list', originalValue: '[80, 443, 8080]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.port_list.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.port_list)?.type, 'integer');
});

test('detects array of booleans', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'flags', originalValue: '[true, false, true]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.flags.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.flags)?.type, 'boolean');
});

test('detects enum from multiple string values', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'environment', originalValue: 'production', suggestedDefault: 'production' }),
    makeParameter({ name: 'environment', originalValue: 'staging', suggestedDefault: 'staging' }),
    makeParameter({ name: 'environment', originalValue: 'development', suggestedDefault: 'development' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.environment.type, 'string');
  assert.deepEqual(result.inputsSchema.properties!.environment.enum, ['development', 'production', 'staging']);
});

test('does not create enum for single unique value', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'region', originalValue: 'us-east-1', suggestedDefault: 'us-east-1' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.region.type, 'string');
  assert.strictEqual(result.inputsSchema.properties!.region.enum, undefined);
});

test('does not create enum for more than 5 unique values', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'color', originalValue: 'red' }),
    makeParameter({ name: 'color', originalValue: 'green' }),
    makeParameter({ name: 'color', originalValue: 'blue' }),
    makeParameter({ name: 'color', originalValue: 'yellow' }),
    makeParameter({ name: 'color', originalValue: 'purple' }),
    makeParameter({ name: 'color', originalValue: 'orange' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.color.type, 'string');
  assert.strictEqual(result.inputsSchema.properties!.color.enum, undefined);
});

test('handles empty parameter list', () => {
  const service = new SchemaInferenceService();
  const result = service.inferSchema([]);

  assert.equal(result.inputsSchema.type, 'object');
  assert.deepEqual(result.inputsSchema.properties, {});
  assert.deepEqual(result.inputsSchema.required, []);
});

test('filters invalid parameters', () => {
  const service = new SchemaInferenceService();
  const parameters = [
    { name: '', originalValue: 'x', inferredType: 'string' as const, isSecret: false, suggestedDefault: 'x' },
    { name: 'valid', originalValue: 'y', inferredType: 'string' as const, isSecret: false, suggestedDefault: 'y' },
  ];

  const result = service.inferSchema(parameters as Parameter[]);
  assert.equal(Object.keys(result.inputsSchema.properties!).length, 1);
  assert.ok(result.inputsSchema.properties!.valid);
});

test('generates default outputs schema', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'input_val', originalValue: 'test' }),
  ];

  const result = service.inferSchema(parameters);

  assert.equal(result.outputsSchema.type, 'object');
  assert.ok(result.outputsSchema.properties!.sessionId);
  assert.ok(result.outputsSchema.properties!.mode);
  assert.deepEqual(result.outputsSchema.required, ['sessionId', 'mode']);
});

test('includes output-like parameters in outputs schema', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'api_response', originalValue: '{"status": "ok"}' }),
  ];

  const result = service.inferSchema(parameters);
  assert.ok(result.outputsSchema.properties!.api_response);
  assert.ok(result.outputsSchema.required?.includes('api_response'));
});

test('validates generated schemas with ajv', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'email', originalValue: 'test@example.com', suggestedDefault: 'test@example.com' }),
    makeParameter({ name: 'count', originalValue: '5', inferredType: 'number', suggestedDefault: '5' }),
    makeParameter({ name: 'active', originalValue: 'true', inferredType: 'boolean', suggestedDefault: 'true' }),
  ];

  const result = service.inferSchema(parameters);

  assert.ok(result.inputsSchema);
  assert.ok(result.outputsSchema);
  assert.equal(result.inputsSchema.type, 'object');
  assert.equal(result.outputsSchema.type, 'object');
});

test('detects enum in array items', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'statuses', originalValue: '["pending", "approved", "rejected"]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.statuses.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.statuses)?.type, 'string');
  assert.deepEqual(readItems(result.inputsSchema.properties!.statuses)?.enum, ['approved', 'pending', 'rejected']);
});

test('handles array with uri items', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'endpoints', originalValue: '["https://a.com", "https://b.com"]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.endpoints.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.endpoints)?.type, 'string');
  assert.equal(readItems(result.inputsSchema.properties!.endpoints)?.format, 'uri');
});

test('handles array with email items', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'recipients', originalValue: '["a@example.com", "b@example.com"]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.recipients.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.recipients)?.type, 'string');
  assert.equal(readItems(result.inputsSchema.properties!.recipients)?.format, 'email');
});

test('handles mixed type array as string array fallback', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'mixed', originalValue: '["text", 42, true]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.mixed.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.mixed)?.type, 'string');
});

test('handles empty array', () => {
  const service = new SchemaInferenceService();
  const parameters: Parameter[] = [
    makeParameter({ name: 'items', originalValue: '[]', suggestedDefault: '[]' }),
  ];

  const result = service.inferSchema(parameters);
  assert.equal(result.inputsSchema.properties!.items.type, 'array');
  assert.equal(readItems(result.inputsSchema.properties!.items)?.type, 'string');
  assert.deepEqual(result.inputsSchema.properties!.items.default, []);
});
