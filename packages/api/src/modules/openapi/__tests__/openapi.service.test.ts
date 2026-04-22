import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowSkill, WorkflowSkillCatalog } from '@cepage/shared-core';
import { OpenapiService, pascalCase, toCamelCase } from '../openapi.service.js';

function makeCatalogStub(skills: WorkflowSkill[]): WorkflowSkillCatalog {
  return {
    schemaVersion: '1',
    generatedAt: '2026-04-21T00:00:00Z',
    skills,
  } as WorkflowSkillCatalog;
}

function makeSkill(overrides: Partial<WorkflowSkill> = {}): WorkflowSkill {
  return {
    id: 'weekly-stripe-report',
    version: '1.0.0',
    title: 'Weekly Stripe Report',
    summary: 'Generate a weekly Stripe revenue report.',
    tags: [],
    kind: 'workflow_template',
    inputsSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
      },
      required: ['startDate', 'endDate'],
    },
    outputsSchema: {
      type: 'object',
      properties: {
        reportMd: { type: 'string' },
      },
      required: ['reportMd'],
    },
    ...overrides,
  } as unknown as WorkflowSkill;
}

test('pascalCase/toCamelCase handle slugs with hyphens and digits', () => {
  assert.equal(pascalCase('weekly-stripe-report'), 'WeeklyStripeReport');
  assert.equal(pascalCase('a1-b2'), 'A1B2');
  assert.equal(toCamelCase('weekly-stripe-report'), 'weeklyStripeReport');
});

test('buildDocument emits core static paths and schemas', async () => {
  const svc = new OpenapiService({
    async getCatalog() {
      return makeCatalogStub([]);
    },
  } as never);
  const doc = (await svc.buildDocument()) as Record<string, unknown>;
  assert.equal(doc.openapi, '3.1.0');
  const paths = doc.paths as Record<string, unknown>;
  const schemas = (doc.components as { schemas?: Record<string, unknown> }).schemas ?? {};
  assert.ok(paths['/workflow-skills']);
  assert.ok(paths['/skill-runs']);
  assert.ok(paths['/skill-runs/{runId}/stream']);
  assert.ok(paths['/scheduled-skill-runs']);
  assert.ok(paths['/sessions/{id}/save-as-skill']);
  assert.ok(paths['/webhooks']);
  assert.ok(paths['/webhooks/{id}']);
  assert.ok(paths['/webhooks/{id}/ping']);
  assert.ok(paths['/webhooks/{id}/rotate-secret']);
  assert.ok(schemas.WorkflowSkill);
  assert.ok(schemas.SkillRun);
  assert.ok(schemas.SkillRunError);
  assert.ok(schemas.DetectInputsResult);
  assert.ok(schemas.Webhook);
  assert.ok(schemas.WebhookWithSecret);
  assert.ok(schemas.CreateWebhookBody);
  assert.ok(schemas.WebhookPingResult);
});

test('buildDocument emits a typed path + inputs/outputs schemas per skill', async () => {
  const svc = new OpenapiService({
    async getCatalog() {
      return makeCatalogStub([makeSkill()]);
    },
  } as never);
  const doc = (await svc.buildDocument()) as Record<string, unknown>;
  const paths = doc.paths as Record<string, Record<string, unknown>>;
  const skillPath = paths['/skills/weekly-stripe-report/runs'];
  assert.ok(skillPath, 'typed path for the skill is present');
  const post = skillPath.post as Record<string, unknown>;
  assert.equal(post.operationId, 'run_weeklyStripeReport');
  const requestBody = (post.requestBody as {
    content: { 'application/json': { schema: { properties: { inputs: { $ref: string } } } } };
  }).content['application/json'].schema.properties.inputs;
  assert.equal(requestBody.$ref, '#/components/schemas/WeeklyStripeReportInputs');
  const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
  assert.ok(schemas.WeeklyStripeReportInputs);
  assert.ok(schemas.WeeklyStripeReportOutputs);
});

test('buildDocument falls back to a permissive schema when a skill has no inputsSchema', async () => {
  const svc = new OpenapiService({
    async getCatalog() {
      return makeCatalogStub([
        makeSkill({ inputsSchema: undefined as never, outputsSchema: undefined as never }),
      ]);
    },
  } as never);
  const doc = (await svc.buildDocument()) as Record<string, unknown>;
  const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
  const inputs = schemas.WeeklyStripeReportInputs as { additionalProperties?: boolean };
  assert.equal(inputs.additionalProperties, true);
});

test('buildDocument degrades gracefully when the catalog throws', async () => {
  const svc = new OpenapiService({
    async getCatalog() {
      throw new Error('catalog boom');
    },
  } as never);
  const doc = (await svc.buildDocument()) as Record<string, unknown>;
  const paths = doc.paths as Record<string, unknown>;
  // Static paths still emitted, no typed paths.
  assert.ok(paths['/workflow-skills']);
  assert.equal(
    Object.keys(paths).some((p) => p.startsWith('/skills/') && p.endsWith('/runs')),
    false,
  );
});
