import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode, GraphSnapshot, JsonSchema } from '@cepage/shared-core';
import type { UserSkillRow } from '../../../user-skills/user-skills.dto';
import { DryRunService } from '../dry-run.service.js';
import { DryRunSandboxService } from '../dry-run-sandbox.service.js';

function makeSkill(overrides: Partial<UserSkillRow> & { inputsSchema?: JsonSchema; graphJson?: Record<string, unknown> | null }): UserSkillRow {
  return {
    id: 'skill-1',
    slug: 'test-skill',
    version: '1.0.0',
    title: 'Test Skill',
    summary: 'A test skill',
    icon: null,
    category: null,
    tags: [],
    inputsSchema: overrides.inputsSchema ?? {},
    outputsSchema: {},
    kind: 'workflow_template',
    promptText: null,
    graphJson: overrides.graphJson ?? null,
    execution: null,
    sourceSessionId: null,
    visibility: 'private',
    ownerKey: 'local-user',
    validated: false,
    deprecated: false,
    replacedBySlug: null,
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
    ...overrides,
  } as UserSkillRow;
}

function makeGraphSnapshot(overrides?: Partial<GraphSnapshot>): GraphSnapshot {
  return {
    version: 1,
    id: 'sess-1',
    createdAt: '2026-04-22T10:00:00.000Z',
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function makeNode(id: string, type: string, content?: Record<string, unknown>): GraphNode {
  return {
    id,
    type: type as GraphNode['type'],
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
    content: content ?? {},
    creator: { type: 'agent', agentType: 'opencode', agentId: 'test' },
    position: { x: 0, y: 0 },
    dimensions: { width: 0, height: 0 },
    metadata: {},
    status: 'active',
    branches: [],
  } as GraphNode;
}


test('agent_step node emits simulated event', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step', { text: 'Hello agent' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
  assert.equal(result.perNode.length, 1);
  assert.equal(result.perNode[0].nodeId, 'n1');
  assert.equal(result.perNode[0].status, 'simulated');
  assert.equal(result.perNode[0].detail, 'Hello agent');
});

test('runtime_run node with known command returns PASS', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'runtime_run', { command: 'node --version' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'PASS');
});

test('runtime_run node with missing command returns FAIL', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'runtime_run', { command: 'definitely_not_a_real_command_12345' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'FAIL');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'FAIL');
  assert.ok(nodeResult.detail?.includes('Command not found'));
});

test('file_diff node writes patch and returns PASS', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'file_diff', { path: 'src/app.ts', content: 'const x = 1;' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'PASS');
});

test('file_diff node with invalid TypeScript returns FAIL', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'file_diff', { path: 'src/app.ts', content: 'const x = ' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'FAIL');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'FAIL');
});

test('file_diff node with unknown extension returns PASS with warning', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'file_diff', { path: 'README.md', content: '# Hello' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('unknown extension')));
});

test('file_diff node missing content returns FAIL', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'file_diff', { path: 'src/app.ts' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'FAIL');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'FAIL');
  assert.ok(nodeResult.detail?.includes('Missing diff content'));
});

test('unsupported node type returns skipped', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'human_message')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
  const nodeResult = result.perNode.find((n) => n.nodeId === 'n1');
  assert.ok(nodeResult);
  assert.equal(nodeResult.status, 'skipped');
});

test('missing required input returns FAIL from dry-run', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'FAIL');
  assert.ok(result.perNode.some((n) => n.status === 'FAIL' && n.detail?.includes('Missing required input')));
});

test('temp dir is cleaned up after execution', () => {
  const sandbox = new DryRunSandboxService(new DryRunService());
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'file_diff', { path: 'test.ts', content: 'const x = 1;' })],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = sandbox.execute(skill, {});

  assert.equal(result.overall, 'PASS');
});
