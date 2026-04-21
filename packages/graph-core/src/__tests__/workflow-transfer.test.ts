import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowTransfer,
  rekeyWorkflowTransfer,
  workflowFromSnapshot,
  workflowToSnapshot,
  type GraphSnapshot,
} from '@cepage/shared-core';

function snapshot(): GraphSnapshot {
  return {
    version: 1,
    id: 'session-a',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 4,
    nodes: [
      {
        id: 'node-a',
        type: 'note',
        createdAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:01:00.000Z',
        content: { text: 'hello', format: 'plaintext' },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 10, y: 20 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: ['branch-a'],
      },
      {
        id: 'node-b',
        type: 'human_message',
        createdAt: '2026-04-03T10:02:00.000Z',
        updatedAt: '2026-04-03T10:03:00.000Z',
        content: { text: 'world', format: 'plaintext' },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 120, y: 90 },
        dimensions: { width: 240, height: 140 },
        metadata: { pinned: true },
        status: 'active',
        branches: ['branch-a'],
      },
    ],
    edges: [
      {
        id: 'edge-a',
        source: 'node-a',
        target: 'node-b',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:03:30.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [
      {
        id: 'branch-a',
        name: 'Main',
        color: '#ff9900',
        createdAt: '2026-04-03T10:04:00.000Z',
        createdBy: { type: 'human', userId: 'u1' },
        headNodeId: 'node-b',
        nodeIds: ['node-a', 'node-b'],
        status: 'active',
      },
    ],
    viewport: { x: 1, y: 2, zoom: 0.9 },
  };
}

test('workflow transfer round-trip preserves graph payload', () => {
  const snap = snapshot();
  const flow = workflowFromSnapshot(snap);
  const parsed = parseWorkflowTransfer(flow);
  if (!parsed.success) {
    throw new Error(parsed.errors.join('; '));
  }
  assert.equal(parsed.success, true);

  const rebuilt = workflowToSnapshot('session-b', parsed.data, 9, '2026-04-03T12:00:00.000Z');
  assert.equal(rebuilt.id, 'session-b');
  assert.equal(rebuilt.lastEventId, 9);
  assert.equal(rebuilt.createdAt, '2026-04-03T12:00:00.000Z');
  assert.deepEqual(rebuilt.nodes, snap.nodes);
  assert.deepEqual(rebuilt.edges, snap.edges);
  assert.deepEqual(rebuilt.branches, snap.branches);
  assert.deepEqual(rebuilt.viewport, snap.viewport);
});

test('workflow transfer validation rejects broken references', () => {
  const flow = workflowFromSnapshot(snapshot());
  flow.graph.edges[0] = {
    ...flow.graph.edges[0],
    target: 'missing-node',
  };
  flow.graph.nodes[0] = {
    ...flow.graph.nodes[0],
    branches: ['missing-branch'],
  };

  const parsed = parseWorkflowTransfer(flow);
  assert.equal(parsed.success, false);
  if (parsed.success) {
    throw new Error('Expected invalid workflow transfer');
  }
  assert.match(parsed.errors.join('\n'), /missing target node: missing-node/);
  assert.match(parsed.errors.join('\n'), /Node node-a references missing branch: missing-branch/);
});

test('workflow transfer rekeys ids and keeps internal references aligned', () => {
  const flow = workflowFromSnapshot(snapshot());
  flow.graph.nodes[1] = {
    ...flow.graph.nodes[1],
    content: {
      ...flow.graph.nodes[1].content,
      config: {
        contextNodeIds: ['node-a'],
        triggerNodeId: 'node-a',
      },
    },
    metadata: {
      runtimeTarget: {
        targetNodeId: 'node-b',
        outputNodeId: 'node-a',
        kind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/demo',
        autoRun: true,
        source: 'text',
      },
      artifacts: {
        outputNodeId: 'node-b',
      },
    },
  };

  const next = rekeyWorkflowTransfer(flow);
  const nodeA = next.graph.nodes.find((node) => (node.content as { text?: string }).text === 'hello');
  const nodeB = next.graph.nodes.find((node) => (node.content as { text?: string }).text === 'world');
  assert.ok(nodeA);
  assert.ok(nodeB);
  assert.notEqual(nodeA?.id, 'node-a');
  assert.notEqual(nodeB?.id, 'node-b');
  assert.notEqual(next.graph.edges[0]?.id, 'edge-a');
  assert.notEqual(next.graph.branches[0]?.id, 'branch-a');
  assert.equal(next.graph.edges[0]?.source, nodeA?.id);
  assert.equal(next.graph.edges[0]?.target, nodeB?.id);
  assert.deepEqual(next.graph.nodes[0]?.branches, [next.graph.branches[0]?.id]);
  assert.equal(next.graph.branches[0]?.headNodeId, nodeB?.id);
  assert.deepEqual(next.graph.branches[0]?.nodeIds, [nodeA?.id, nodeB?.id]);
  assert.deepEqual(
    (next.graph.nodes[1]?.content as { config?: { contextNodeIds?: string[]; triggerNodeId?: string } }).config,
    {
      contextNodeIds: [nodeA?.id],
      triggerNodeId: nodeA?.id,
    },
  );
  assert.equal(
    (
      next.graph.nodes[1]?.metadata as {
        runtimeTarget?: { targetNodeId?: string; outputNodeId?: string };
      }
    ).runtimeTarget?.targetNodeId,
    nodeB?.id,
  );
  assert.equal(
    (
      next.graph.nodes[1]?.metadata as {
        runtimeTarget?: { targetNodeId?: string; outputNodeId?: string };
      }
    ).runtimeTarget?.outputNodeId,
    nodeA?.id,
  );
  assert.equal(
    (next.graph.nodes[1]?.metadata as { artifacts?: { outputNodeId?: string } }).artifacts?.outputNodeId,
    nodeB?.id,
  );
});

test('workflow transfer strips runtime nodes and normalizes legacy step nodes', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-a',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 8,
    nodes: [
      {
        id: 'input-1',
        type: 'input',
        createdAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        content: { mode: 'template', key: 'brief', label: 'Brief', accepts: ['text'], required: true },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 0, y: 0 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: [],
      },
      {
        id: 'bound-1',
        type: 'input',
        createdAt: '2026-04-03T10:01:00.000Z',
        updatedAt: '2026-04-03T10:01:00.000Z',
        content: {
          mode: 'bound',
          key: 'brief',
          label: 'Brief',
          runId: 'run-1',
          templateNodeId: 'input-1',
          executionId: 'exec-1',
          parts: [{ id: 'part-1', type: 'text', text: 'runtime value' }],
          summary: 'runtime value',
        },
        creator: { type: 'system', reason: 'workflow-run' },
        position: { x: 20, y: 160 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: [],
      },
      {
        id: 'spawn-1',
        type: 'agent_spawn',
        createdAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        content: {
          agentType: 'opencode',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
          config: { contextNodeIds: ['input-1'], triggerNodeId: 'input-1' },
        },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 260, y: 0 },
        dimensions: { width: 220, height: 120 },
        metadata: { artifacts: { outputNodeId: 'output-1' } },
        status: 'active',
        branches: [],
      },
      {
        id: 'output-1',
        type: 'agent_output',
        createdAt: '2026-04-03T10:02:00.000Z',
        updatedAt: '2026-04-03T10:02:00.000Z',
        content: { output: 'runtime output', outputType: 'stdout', isStreaming: false },
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        position: { x: 520, y: 0 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: [],
      },
      {
        id: 'artifact-1',
        type: 'workspace_file',
        createdAt: '2026-04-03T10:02:00.000Z',
        updatedAt: '2026-04-03T10:02:00.000Z',
        content: {
          title: 'Notes',
          relativePath: 'notes.md',
          pathMode: 'per_run',
          resolvedRelativePath: 'run-12345678/notes.md',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          excerpt: 'runtime excerpt',
          sourceExecutionId: 'exec-1',
          sourceRunId: 'run-1',
          status: 'available',
        },
        creator: { type: 'system', reason: 'runtime' },
        position: { x: 520, y: 180 },
        dimensions: { width: 220, height: 120 },
        metadata: { artifacts: { ownerNodeId: 'spawn-1' } },
        status: 'active',
        branches: [],
      },
      {
        id: 'runtime-1',
        type: 'runtime_run',
        createdAt: '2026-04-03T10:02:00.000Z',
        updatedAt: '2026-04-03T10:02:00.000Z',
        content: { runId: 'run-1' },
        creator: { type: 'system', reason: 'runtime' },
        position: { x: 780, y: 0 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: [],
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'input-1',
        target: 'spawn-1',
        relation: 'feeds_into',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'spawn-1',
        target: 'output-1',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:02:00.000Z',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        metadata: {},
      },
      {
        id: 'edge-3',
        source: 'spawn-1',
        target: 'artifact-1',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:02:00.000Z',
        creator: { type: 'system', reason: 'runtime' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const flow = workflowFromSnapshot(snap);
  const step = flow.graph.nodes.find((node) => node.id === 'spawn-1');
  const artifact = flow.graph.nodes.find((node) => node.id === 'artifact-1');

  assert.equal(step?.type, 'agent_step');
  assert.equal(flow.graph.nodes.some((node) => node.id === 'bound-1'), false);
  assert.equal(flow.graph.nodes.some((node) => node.id === 'output-1'), false);
  assert.equal(flow.graph.nodes.some((node) => node.id === 'runtime-1'), false);
  assert.equal(flow.graph.edges.some((edge) => edge.target === 'output-1'), false);
  assert.deepEqual(step?.metadata, {});
  assert.equal(
    (artifact?.content as { status?: string; sourceExecutionId?: string; sourceRunId?: string }).status,
    'declared',
  );
  assert.equal((artifact?.content as { pathMode?: string }).pathMode, 'per_run');
  assert.equal(
    (artifact?.content as { status?: string; sourceExecutionId?: string; sourceRunId?: string }).sourceExecutionId,
    undefined,
  );
  assert.equal(
    (artifact?.content as { status?: string; sourceExecutionId?: string; sourceRunId?: string }).sourceRunId,
    undefined,
  );
  assert.equal((artifact?.content as { resolvedRelativePath?: string }).resolvedRelativePath, undefined);

  const rebuilt = workflowToSnapshot('session-b', flow, 11, '2026-04-03T12:00:00.000Z');
  assert.equal(rebuilt.nodes.find((node) => node.id === 'spawn-1')?.type, 'agent_step');
  assert.equal(rebuilt.nodes.some((node) => node.id === 'output-1'), false);
  assert.equal(rebuilt.nodes.some((node) => node.id === 'bound-1'), false);
});

test('workflow transfer rejects malformed agent step content', () => {
  const flow = workflowFromSnapshot(snapshot());
  flow.graph.nodes.push({
    id: 'step-1',
    type: 'agent_step',
    createdAt: '2026-04-03T10:04:00.000Z',
    updatedAt: '2026-04-03T10:04:00.000Z',
    content: {
      agentType: 'research',
      model: { providerID: 'openai', modelID: '' },
    },
    creator: { type: 'human', userId: 'u1' },
    position: { x: 240, y: 140 },
    dimensions: { width: 220, height: 120 },
    metadata: {},
    status: 'active',
    branches: [],
  });

  const parsed = parseWorkflowTransfer(flow);

  assert.equal(parsed.success, false);
  if (parsed.success) {
    throw new Error('Expected malformed agent_step to be rejected');
  }
  assert.match(parsed.errors.join('\n'), /unsupported agentType/);
  assert.match(parsed.errors.join('\n'), /empty or incomplete model reference/);
});
