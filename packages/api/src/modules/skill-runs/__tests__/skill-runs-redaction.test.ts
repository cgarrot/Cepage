import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowSkill } from '@cepage/shared-core';
import { SkillRunsService } from '../skill-runs.service.js';

// SkillRunsService is heavily DB-coupled, but the copilot-message builder
// and its redaction helpers are pure so we can exercise them directly by
// constructing the service with typed stubs and using a cast to reach the
// private method. This guards the behavior that user inputs marked as
// `writeOnly`, `format: "password"`, or `x-secret: true` never end up
// embedded verbatim in the copilot agent's prompt.

type PrivateApi = {
  buildCopilotMessage(skill: WorkflowSkill, inputs: Record<string, unknown>): string;
};

function makeService(): PrivateApi {
  const svc = new SkillRunsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return svc as unknown as PrivateApi;
}

function makeSkill(schema: WorkflowSkill['inputsSchema']): WorkflowSkill {
  return {
    id: 'test-skill',
    version: '1.0.0',
    title: 'Test skill',
    summary: 'test',
    tags: [],
    kind: 'workflow_template',
    inputsSchema: schema,
    outputsSchema: { type: 'object' },
  } as unknown as WorkflowSkill;
}

test('copilot message redacts writeOnly fields', () => {
  const api = makeService();
  const skill = makeSkill({
    type: 'object',
    properties: {
      topic: { type: 'string' },
      apiToken: { type: 'string', writeOnly: true },
    },
  });
  const message = api.buildCopilotMessage(skill, {
    topic: 'ship fast',
    apiToken: 'sk-live-1234567890',
  });
  assert.match(message, /topic: ship fast/);
  assert.doesNotMatch(message, /sk-live-1234567890/);
  assert.match(message, /apiToken: «redacted»/);
});

test('copilot message redacts format: password', () => {
  const api = makeService();
  const skill = makeSkill({
    type: 'object',
    properties: {
      secret: { type: 'string', format: 'password' },
    },
  });
  const message = api.buildCopilotMessage(skill, {
    secret: 'correct-horse-battery-staple',
  });
  assert.doesNotMatch(message, /battery/);
  assert.match(message, /secret: «redacted»/);
});

test('copilot message redacts x-secret extension', () => {
  const api = makeService();
  const skill = makeSkill({
    type: 'object',
    properties: {
      githubPat: { type: 'string', 'x-secret': true },
    },
  });
  const message = api.buildCopilotMessage(skill, {
    githubPat: 'ghp_xxxx',
  });
  assert.doesNotMatch(message, /ghp_xxxx/);
  assert.match(message, /githubPat: «redacted»/);
});

test('copilot message leaves regular inputs untouched', () => {
  const api = makeService();
  const skill = makeSkill({
    type: 'object',
    properties: { topic: { type: 'string' } },
  });
  const message = api.buildCopilotMessage(skill, { topic: 'release notes' });
  assert.match(message, /topic: release notes/);
  assert.doesNotMatch(message, /redacted/);
});
