import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillRun, WorkflowSkill } from '@cepage/sdk';
import {
  hasTypedInputs,
  runToToolResult,
  sanitizeSchemaForMcp,
  skillToTool,
  skillToToolName,
  toolNameToSlug,
} from '../src/tools.js';

function makeSkill(overrides: Partial<WorkflowSkill> = {}): WorkflowSkill {
  return {
    id: 'weekly-stripe-report',
    version: '1.0.0',
    title: 'Weekly Stripe Report',
    summary: 'Generate a weekly Stripe revenue report',
    tags: ['finance'],
    kind: 'workflow_template',
    inputsSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    outputsSchema: { type: 'object' },
    ...overrides,
  } as unknown as WorkflowSkill;
}

function makeRun(overrides: Partial<SkillRun> = {}): SkillRun {
  return {
    id: 'run-1',
    skillId: 'weekly-stripe-report',
    skillVersion: '1.0.0',
    skillKind: 'workflow_template',
    status: 'succeeded',
    inputs: {},
    outputs: { ok: true },
    error: null,
    sessionId: null,
    triggeredBy: 'mcp',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1234,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('skillToToolName hyphen→underscore with cepage_ prefix', () => {
  assert.equal(skillToToolName('weekly-stripe-report'), 'cepage_weekly_stripe_report');
  assert.equal(skillToToolName('foo'), 'cepage_foo');
});

test('toolNameToSlug is the inverse', () => {
  assert.equal(toolNameToSlug('cepage_weekly_stripe_report'), 'weekly-stripe-report');
  assert.equal(toolNameToSlug('weekly_stripe_report'), 'weekly-stripe-report');
});

test('skillToTool emits a well-formed MCP tool definition', () => {
  const tool = skillToTool(makeSkill());
  assert.equal(tool.name, 'cepage_weekly_stripe_report');
  assert.match(tool.description, /Weekly Stripe Report/);
  assert.equal((tool.inputSchema as { type?: string }).type, 'object');
  const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
  assert.ok(props && 'startDate' in props);
});

test('skillToTool tolerates skills without a typed inputsSchema', () => {
  const tool = skillToTool(makeSkill({ inputsSchema: undefined as never }));
  assert.equal((tool.inputSchema as { type?: string }).type, 'object');
  assert.match(tool.description, /no typed inputs/);
});

test('sanitizeSchemaForMcp strips x- extension keys', () => {
  const sanitized = sanitizeSchemaForMcp({
    type: 'object',
    properties: {
      token: { type: 'string', 'x-secret': true },
      regular: { type: 'string' },
    },
  });
  const props = (sanitized as { properties?: Record<string, unknown> }).properties ?? {};
  const token = props.token as Record<string, unknown>;
  assert.ok(!('x-secret' in token), 'x- extension keys must be stripped');
  assert.equal(token.type, 'string');
});

test('hasTypedInputs reflects the presence of properties', () => {
  assert.equal(hasTypedInputs(makeSkill()), true);
  assert.equal(
    hasTypedInputs(
      makeSkill({ inputsSchema: { type: 'object', properties: {} } as never }),
    ),
    false,
  );
});

test('runToToolResult formats succeeded outputs as JSON text', () => {
  const result = runToToolResult(makeRun({ outputs: { foo: 42 } }));
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /"foo":\s*42/);
});

test('runToToolResult marks failed runs with isError', () => {
  const result = runToToolResult(
    makeRun({
      status: 'failed',
      outputs: null,
      error: { code: 'INVALID_INPUT', message: 'topic is required' },
    }),
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /INVALID_INPUT/);
  assert.match(result.content[0].text, /topic is required/);
});

test('runToToolResult handles cancelled runs', () => {
  const result = runToToolResult(makeRun({ status: 'cancelled', outputs: null }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /cancelled/);
});
