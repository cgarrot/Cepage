import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphEdge, GraphNode } from '@cepage/shared-core';
import type { LiveRunDescriptor } from '../workspace-types.js';
import { planLoopRun, planNodeRun, readNodeSelection, resolveNodeSelection } from '../workspace-run.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function liveRun(input: Partial<LiveRunDescriptor> & Pick<LiveRunDescriptor, 'id' | 'type' | 'status'>): LiveRunDescriptor {
  return {
    id: input.id,
    type: input.type,
    status: input.status,
    agentLabel: input.agentLabel ?? 'Cursor Agent',
    model: input.model,
    workspacePath: input.workspacePath,
    rootNodeId: input.rootNodeId,
    outputNodeId: input.outputNodeId,
    sourceNodeId: input.sourceNodeId,
    seedNodeIds: input.seedNodeIds ?? [],
    output: input.output ?? '',
    isStreaming: input.isStreaming ?? false,
    isActive: input.isActive ?? false,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    lastUpdateAt: input.lastUpdateAt ?? '2026-04-03T10:00:00.000Z',
  };
}

test('planNodeRun reruns the owning run from produced nodes', () => {
  const spawn = node({
    id: 'spawn-1',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
  });
  const output = node({
    id: 'output-1',
    type: 'agent_output',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
  });
  const target = node({
    id: 'target-1',
    type: 'runtime_target',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
  });
  const run = liveRun({
    id: 'run-1',
    type: 'opencode',
    status: 'completed',
    rootNodeId: 'spawn-1',
    outputNodeId: 'output-1',
    model: {
      providerID: 'openai',
      modelID: 'gpt-5.4-medium',
    },
  });
  const edges: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [
    { source: 'spawn-1', target: 'output-1', relation: 'produces' },
    { source: 'output-1', target: 'target-1', relation: 'produces' },
  ];

  assert.deepEqual(planNodeRun(spawn, [run], edges), {
    mode: 'rerun',
    runId: 'run-1',
    selection: {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });
  assert.deepEqual(planNodeRun(output, [run], edges), {
    mode: 'rerun',
    runId: 'run-1',
    selection: {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });
  assert.deepEqual(planNodeRun(target, [run], edges), {
    mode: 'rerun',
    runId: 'run-1',
    selection: {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });
});

test('planNodeRun falls back to spawn for nodes outside the produces chain', () => {
  const note = node({
    id: 'note-1',
    type: 'note',
    creator: { type: 'human', userId: 'u1' },
  });
  const run = liveRun({
    id: 'run-1',
    type: 'opencode',
    status: 'completed',
    rootNodeId: 'spawn-1',
    outputNodeId: 'output-1',
  });
  const edges: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [
    { source: 'spawn-1', target: 'output-1', relation: 'produces' },
  ];

  assert.deepEqual(planNodeRun(note, [run], edges), { mode: 'spawn' });
});

test('planLoopRun routes nodes inside a loop component to the controller', () => {
  const nodes = [
    node({
      id: 'loop-1',
      type: 'loop',
      creator: { type: 'human', userId: 'u1' },
    }),
    node({
      id: 'body-1',
      type: 'sub_graph',
      creator: { type: 'human', userId: 'u1' },
    }),
    node({
      id: 'step-1',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
    }),
  ];
  const edges: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [
    { source: 'loop-1', target: 'body-1', relation: 'contains' },
    { source: 'body-1', target: 'step-1', relation: 'contains' },
  ];

  assert.deepEqual(planLoopRun('step-1', nodes, edges), {
    mode: 'controller',
    nodeId: 'loop-1',
  });
});

test('planLoopRun flags ambiguous loop selections', () => {
  const nodes = [
    node({
      id: 'loop-a',
      type: 'loop',
      creator: { type: 'human', userId: 'u1' },
    }),
    node({
      id: 'loop-b',
      type: 'loop',
      creator: { type: 'human', userId: 'u1' },
    }),
    node({
      id: 'body-1',
      type: 'sub_graph',
      creator: { type: 'human', userId: 'u1' },
    }),
    node({
      id: 'step-1',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
    }),
  ];
  const edges: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [
    { source: 'loop-a', target: 'body-1', relation: 'contains' },
    { source: 'loop-b', target: 'body-1', relation: 'contains' },
    { source: 'body-1', target: 'step-1', relation: 'contains' },
  ];

  assert.deepEqual(planLoopRun('step-1', nodes, edges), {
    mode: 'ambiguous',
    nodeIds: ['loop-a', 'loop-b'],
  });
});

test('planNodeRun keeps the stored spawn selection when no live run exists', () => {
  const spawn = node({
    id: 'spawn-1',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
    content: {
      agentType: 'cursor_agent',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });

  assert.deepEqual(planNodeRun(spawn, [], []), {
    mode: 'spawn',
    selection: {
      type: 'cursor_agent',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });
});

test('readNodeSelection rebuilds the stored spawn model choice', () => {
  const spawn = node({
    id: 'spawn-1',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
    content: {
      agentType: 'cursor_agent',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
    },
  });

  assert.deepEqual(readNodeSelection(spawn), {
    type: 'cursor_agent',
    model: {
      providerID: 'openai',
      modelID: 'gpt-5.4-medium',
    },
  });
});

test('readNodeSelection reads locked selections from any node type', () => {
  const note = node({
    id: 'note-1',
    type: 'note',
    creator: { type: 'human', userId: 'u1' },
    content: {
      text: 'Use a local model here.',
      agentSelection: {
        mode: 'locked',
        selection: {
          type: 'opencode',
          model: {
            providerID: 'anthropic',
            modelID: 'claude-4.5-sonnet',
          },
        },
      },
    },
  });

  assert.deepEqual(readNodeSelection(note), {
    type: 'opencode',
    model: {
      providerID: 'anthropic',
      modelID: 'claude-4.5-sonnet',
    },
  });
});

test('resolveNodeSelection prefers the nearest locked context before the global fallback', () => {
  const nodes = [
    node({
      id: 'start',
      type: 'note',
      creator: { type: 'human', userId: 'u1' },
      content: {
        agentSelection: {
          mode: 'inherit',
        },
      },
    }),
    node({
      id: 'near',
      type: 'note',
      creator: { type: 'human', userId: 'u1' },
      createdAt: '2026-04-03T10:00:01.000Z',
      content: {
        agentSelection: {
          mode: 'locked',
          selection: {
            type: 'cursor_agent',
            model: {
              providerID: 'cursor',
              modelID: 'composer-2-fast',
            },
          },
        },
      },
    }),
    node({
      id: 'far',
      type: 'note',
      creator: { type: 'human', userId: 'u1' },
      createdAt: '2026-04-03T10:00:02.000Z',
      content: {
        agentSelection: {
          mode: 'locked',
          selection: {
            type: 'opencode',
            model: {
              providerID: 'openai',
              modelID: 'gpt-5.4',
            },
          },
        },
      },
    }),
  ];
  const edges: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [
    { source: 'start', target: 'near', relation: 'feeds_into' },
    { source: 'near', target: 'far', relation: 'feeds_into' },
  ];

  assert.deepEqual(
    resolveNodeSelection('start', nodes, edges, {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-mini',
      },
    }),
    {
      type: 'cursor_agent',
      model: {
        providerID: 'cursor',
        modelID: 'composer-2-fast',
      },
    },
  );
});

test('resolveNodeSelection falls back to the provided global selection when no local context exists', () => {
  const nodes = [
    node({
      id: 'start',
      type: 'note',
      creator: { type: 'human', userId: 'u1' },
      content: {
        agentSelection: {
          mode: 'inherit',
        },
      },
    }),
  ];

  assert.deepEqual(
    resolveNodeSelection('start', nodes, [], {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4',
      },
    }),
    {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4',
      },
    },
  );
});
