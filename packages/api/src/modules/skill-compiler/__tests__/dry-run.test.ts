import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphEdge, GraphNode, GraphSnapshot, JsonSchema } from '@cepage/shared-core';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';
import { DryRunService } from '../dry-run/dry-run.service.js';

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

function makeNode(id: string, type: string, extra?: Record<string, unknown>): GraphNode {
  return {
    id,
    type: type as GraphNode['type'],
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
    content: {},
    creator: { type: 'agent', agentType: 'opencode', agentId: 'test' },
    position: { x: 0, y: 0 },
    dimensions: { width: 0, height: 0 },
    metadata: {},
    status: 'active',
    branches: [],
    ...extra,
  } as GraphNode;
}

function makeEdge(id: string, source: string, target: string, extra?: Record<string, unknown>): GraphEdge {
  return {
    id,
    source,
    target,
    relation: 'spawns' as GraphEdge['relation'],
    direction: 'source_to_target',
    strength: 1,
    createdAt: '2026-04-22T10:00:00.000Z',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'test' },
    metadata: {},
    ...extra,
  } as GraphEdge;
}

test('valid skill + complete inputs → PASS', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['name'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, { name: 'Alice', count: 42 });

  assert.equal(result.overall, 'PASS');
  assert.equal(result.checks.parametric, 'PASS');
  assert.equal(result.checks.schema, 'PASS');
  assert.equal(result.checks.graph, 'PASS');
  assert.equal(result.errors.length, 0);
  assert.ok(result.estimatedCost >= 0);
});

test('missing required input → FAIL (parametric)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.checks.parametric, 'FAIL');
  assert.equal(result.checks.schema, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'parametric' && e.field === 'name'));
});

test('wrong input type → FAIL (schema)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, { count: 'not-a-number' });

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.checks.parametric, 'PASS');
  assert.equal(result.checks.schema, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'schema' && e.field === 'count'));
});

test('dangling edge in graph → FAIL (graph)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [makeEdge('e1', 'n1', 'missing-node')],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.checks.graph, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'graph' && e.message.includes('Dangling edge')));
});

test('warnings only + permissive mode → PASS', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, { name: 'Alice', extraField: 'surprise' }, 'permissive');

  assert.equal(result.overall, 'PASS');
  assert.equal(result.checks.parametric, 'PASS');
  assert.equal(result.checks.schema, 'PASS');
  assert.equal(result.checks.graph, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('extraField')));
});

test('warnings + strict mode → FAIL', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, { name: 'Alice', extraField: 'surprise' }, 'strict');

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.checks.parametric, 'PASS');
  assert.equal(result.checks.schema, 'PASS');
  assert.equal(result.checks.graph, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('extraField')));
});

test('invalid node type → FAIL (graph)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'not_a_real_type')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.overall, 'FAIL');
  assert.equal(result.checks.graph, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'graph' && e.message.includes('Invalid node type')));
});

test('dangling source edge → FAIL (graph)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [makeEdge('e1', 'missing-source', 'n1')],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.checks.graph, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'graph' && e.message.includes('source node')));
});

test('no graphJson warns but passes graph check', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: null,
  });

  const result = service.validate(skill, {});

  assert.equal(result.checks.graph, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('No graphJson')));
});

test('no inputsSchema warns but passes schema check', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.checks.schema, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('No inputsSchema')));
});

test('estimated cost is computed from graph', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [
        makeNode('n1', 'runtime_target'),
        makeNode('n2', 'runtime_run'),
        makeNode('n3', 'file_diff'),
        makeNode('n4', 'agent_step'),
        makeNode('n5', 'agent_output'),
        makeNode('n6', 'human_message'),
      ],
      edges: [
        makeEdge('e1', 'n1', 'n2'),
        makeEdge('e2', 'n2', 'n3'),
      ],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.estimatedCost, 9.65);
});

test('empty graph warns but passes', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {},
    graphJson: makeGraphSnapshot({
      nodes: [],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, {});

  assert.equal(result.checks.graph, 'PASS');
  assert.ok(result.warnings.some((w) => w.includes('no nodes')));
});

test('invalid inputsSchema compilation → FAIL (schema)', () => {
  const service = new DryRunService();
  const skill = makeSkill({
    inputsSchema: {
      type: 'object',
      properties: {
        count: { type: 'not_a_type' },
      },
    },
    graphJson: makeGraphSnapshot({
      nodes: [makeNode('n1', 'agent_step')],
      edges: [],
    }) as unknown as Record<string, unknown>,
  });

  const result = service.validate(skill, { count: 5 });

  assert.equal(result.checks.schema, 'FAIL');
  assert.ok(result.errors.some((e) => e.check === 'schema' && e.message.includes('Invalid inputsSchema')));
});
