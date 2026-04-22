import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphEdge, GraphNode } from '@cepage/shared-core';
import { createGraphStore } from '@cepage/graph-core';
import { GraphMapperService, type ExtractedSession } from '../graph-mapper.service.js';

const service = new GraphMapperService();

function makeNode(
  id: string,
  type: GraphNode['type'],
  content: Record<string, unknown>,
  createdAt: string,
): GraphNode {
  return {
    id,
    type,
    createdAt,
    updatedAt: createdAt,
    content,
    creator: { type: 'agent', agentType: 'test', agentId: 'graph-mapper' },
    position: { x: 0, y: 0 },
    dimensions: { width: 0, height: 0 },
    metadata: {},
    status: 'active',
    branches: [],
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  relation: GraphEdge['relation'] = 'produces',
): GraphEdge {
  return {
    id,
    source,
    target,
    relation,
    direction: 'source_to_target',
    strength: 1,
    createdAt: '2026-04-22T10:00:00.000Z',
    creator: { type: 'agent', agentType: 'test', agentId: 'graph-mapper' },
    metadata: {},
  };
}

test('map returns an empty GraphSnapshot for empty sessions', () => {
  const result = service.map({ nodes: [], edges: [], metadata: { sessionId: 'empty' }, warnings: [] });

  assert.equal(result.id, 'empty');
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.branches, []);
});

test('map normalizes a linear session into canonical graph nodes and edges', () => {
  const session: ExtractedSession = {
    metadata: { sessionId: 'linear' },
    warnings: [],
    nodes: [
      makeNode('human-1', 'human_message', { text: 'Add tests' }, '2026-04-22T10:00:00.000Z'),
      makeNode('step-1', 'agent_spawn', { summary: 'Plan work' }, '2026-04-22T10:01:00.000Z'),
      makeNode('file-1', 'file_diff', { path: 'src/app.ts', operation: 'write' }, '2026-04-22T10:02:00.000Z'),
      makeNode('run-1', 'runtime_run', { command: 'pnpm test', exitCode: 0 }, '2026-04-22T10:03:00.000Z'),
      makeNode('out-1', 'agent_output', { text: 'Done' }, '2026-04-22T10:04:00.000Z'),
    ],
    edges: [
      makeEdge('e1', 'human-1', 'step-1', 'responds_to'),
      makeEdge('e2', 'step-1', 'file-1', 'produces'),
      makeEdge('e3', 'step-1', 'run-1', 'produces'),
      makeEdge('e4', 'run-1', 'out-1', 'produces'),
    ],
  };

  const snapshot = service.map(session);

  assert.equal(snapshot.nodes.find((node) => node.id === 'step-1')?.type, 'agent_step');
  assert.equal(snapshot.nodes.find((node) => node.id === 'file-1')?.type, 'file_diff');
  assert.equal(snapshot.nodes.find((node) => node.id === 'run-1')?.type, 'runtime_run');
  assert.equal(snapshot.nodes.find((node) => node.id === 'run-1')?.metadata.runtimeCategory, 'test');
  assert.ok(snapshot.edges.some((edge) => edge.source === 'step-1' && edge.target === 'file-1' && edge.relation === 'revises'));
  assert.ok(snapshot.edges.some((edge) => edge.source === 'step-1' && edge.target === 'run-1' && edge.relation === 'produces'));
  assert.ok(snapshot.edges.some((edge) => edge.source === 'run-1' && edge.target === 'out-1' && edge.relation === 'feeds_into'));
});

test('map inserts branch points for parallel agent flows', () => {
  const session: ExtractedSession = {
    nodes: [
      makeNode('step-root', 'agent_step', { summary: 'fan out' }, '2026-04-22T10:00:00.000Z'),
      makeNode('step-a', 'agent_step', { summary: 'lint' }, '2026-04-22T10:01:00.000Z'),
      makeNode('step-b', 'agent_step', { summary: 'test' }, '2026-04-22T10:01:30.000Z'),
      makeNode('out-a', 'agent_output', { text: 'lint ok' }, '2026-04-22T10:02:00.000Z'),
      makeNode('out-b', 'agent_output', { text: 'tests ok' }, '2026-04-22T10:02:30.000Z'),
    ],
    edges: [
      makeEdge('e1', 'step-root', 'step-a', 'produces'),
      makeEdge('e2', 'step-root', 'step-b', 'produces'),
      makeEdge('e3', 'step-a', 'out-a', 'produces'),
      makeEdge('e4', 'step-b', 'out-b', 'produces'),
    ],
  };

  const snapshot = service.map(session);
  const branchPoint = snapshot.nodes.find((node) => node.type === 'branch_point');

  assert.ok(branchPoint);
  assert.ok(snapshot.edges.some((edge) => edge.source === 'step-root' && edge.target === branchPoint?.id && edge.relation === 'feeds_into'));
  assert.ok(snapshot.edges.some((edge) => edge.source === branchPoint?.id && edge.target === 'step-a' && edge.relation === 'spawns'));
  assert.ok(snapshot.edges.some((edge) => edge.source === branchPoint?.id && edge.target === 'step-b' && edge.relation === 'spawns'));
  assert.ok(snapshot.branches.length >= 2);
});

test('map collapses retry chains and preserves only the latest successful node', () => {
  const session: ExtractedSession = {
    nodes: [
      makeNode('step-1', 'agent_step', { summary: 'run tests' }, '2026-04-22T10:00:00.000Z'),
      { ...makeNode('run-1', 'runtime_run', { command: 'pnpm test', exitCode: 1, stderr: 'fail' }, '2026-04-22T10:01:00.000Z'), status: 'error' },
      makeNode('run-2', 'runtime_run', { command: 'pnpm test', exitCode: 0, stdout: 'pass' }, '2026-04-22T10:02:00.000Z'),
      makeNode('out-1', 'agent_output', { text: 'Green' }, '2026-04-22T10:03:00.000Z'),
    ],
    edges: [
      makeEdge('e1', 'step-1', 'run-1', 'produces'),
      makeEdge('e2', 'run-1', 'run-2', 'feeds_into'),
      makeEdge('e3', 'run-2', 'out-1', 'produces'),
    ],
  };

  const snapshot = service.map(session);
  const runs = snapshot.nodes.filter((node) => node.type === 'runtime_run');

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, 'run-2');
  assert.equal(runs[0]?.metadata.collapsedRetries, 1);
  assert.ok(snapshot.edges.some((edge) => edge.source === 'step-1' && edge.target === 'run-2'));
  assert.ok(!snapshot.edges.some((edge) => edge.source === 'run-1' || edge.target === 'run-1'));
});

test('map upgrades deploy-like commands into runtime targets and remains graph-store compatible', () => {
  const session: ExtractedSession = {
    metadata: { sessionId: 'deploy' },
    nodes: [
      makeNode('step-1', 'agent_step', { summary: 'launch preview' }, '2026-04-22T10:00:00.000Z'),
      makeNode('deploy-1', 'runtime_run', { command: 'pnpm dev --host 0.0.0.0' }, '2026-04-22T10:01:00.000Z'),
      makeNode('out-1', 'agent_output', { text: 'Preview launched' }, '2026-04-22T10:02:00.000Z'),
    ],
    edges: [
      makeEdge('e1', 'step-1', 'deploy-1', 'produces'),
      makeEdge('e2', 'deploy-1', 'out-1', 'produces'),
    ],
  };

  const snapshot = service.map(session);
  const target = snapshot.nodes.find((node) => node.id === 'deploy-1');

  assert.equal(target?.type, 'runtime_target');
  assert.equal(target?.metadata.runtimeCategory, 'deploy');

  const store = createGraphStore({ sessionId: 'deploy' });
  store.hydrateFromSnapshot(snapshot);
  assert.equal(store.listNodes().length, snapshot.nodes.length);
  assert.equal(store.listEdges().length, snapshot.edges.length);
});

test('map handles mixed OpenCode and Cursor artifacts with >=90% canonical coverage', () => {
  const session: ExtractedSession = {
    metadata: { sessionId: 'mixed' },
    warnings: [],
    nodes: [
      makeNode('msg-user', 'human_message', { content: 'Ship it' }, '2026-04-22T10:00:00.000Z'),
      makeNode('msg-assistant', 'agent_output', { content: 'Working' }, '2026-04-22T10:01:00.000Z'),
      makeNode('tool-write', 'file_diff', { path: 'src/index.ts', operation: 'write' }, '2026-04-22T10:02:00.000Z'),
      makeNode('tool-shell', 'runtime_run', { command: 'pnpm test --runInBand', exitCode: 0 }, '2026-04-22T10:03:00.000Z'),
      makeNode('op-step', 'agent_spawn', { summary: 'Inspect repo' }, '2026-04-22T10:04:00.000Z'),
      makeNode('op-file', 'file_diff', { path: 'README.md', operation: 'patch' }, '2026-04-22T10:05:00.000Z'),
      makeNode('op-run', 'runtime_run', { command: 'npm test', exitCode: 0 }, '2026-04-22T10:06:00.000Z'),
      makeNode('op-deploy', 'runtime_run', { command: 'vercel deploy --prebuilt' }, '2026-04-22T10:07:00.000Z'),
      makeNode('cursor-read', 'workspace_file', { path: 'package.json' }, '2026-04-22T10:08:00.000Z'),
      makeNode('done', 'agent_output', { text: 'Completed' }, '2026-04-22T10:09:00.000Z'),
    ],
    edges: [
      makeEdge('e1', 'msg-user', 'msg-assistant', 'responds_to'),
      makeEdge('e2', 'msg-assistant', 'tool-write', 'produces'),
      makeEdge('e3', 'msg-assistant', 'tool-shell', 'produces'),
      makeEdge('e4', 'tool-shell', 'op-step', 'produces'),
      makeEdge('e5', 'op-step', 'op-file', 'spawns'),
      makeEdge('e6', 'op-step', 'op-run', 'spawns'),
      makeEdge('e7', 'op-run', 'op-deploy', 'feeds_into'),
      makeEdge('e8', 'op-deploy', 'done', 'produces'),
      makeEdge('e9', 'cursor-read', 'op-step', 'responds_to'),
    ],
  };

  const snapshot = service.map(session);
  const expectedMapped = session.nodes.length;
  const canonical = snapshot.nodes.filter((node) =>
    ['human_message', 'agent_output', 'agent_step', 'file_diff', 'runtime_run', 'runtime_target', 'workspace_file', 'branch_point'].includes(node.type),
  ).length;
  const coverage = canonical / expectedMapped;

  assert.ok(coverage >= 0.9, `expected >=90% canonical coverage, got ${(coverage * 100).toFixed(1)}%`);
  assert.ok(snapshot.nodes.some((node) => node.id === 'op-step' && node.type === 'agent_step'));
  assert.ok(snapshot.nodes.some((node) => node.id === 'op-deploy' && node.type === 'runtime_target'));
  assert.ok(snapshot.edges.some((edge) => edge.relation === 'revises'));
  assert.ok(snapshot.edges.some((edge) => edge.relation === 'feeds_into'));
  assert.ok(snapshot.edges.some((edge) => edge.relation === 'produces'));
});
