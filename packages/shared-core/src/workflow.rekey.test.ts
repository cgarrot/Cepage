import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode } from './graph';
import { parseWorkflowTransfer, rekeyWorkflowTransfer, type WorkflowTransfer } from './workflow';

function node(input: {
  id: string;
  type: GraphNode['type'];
  content?: GraphNode['content'];
}): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z',
    content: input.content ?? {},
    creator: { type: 'human', userId: 'u1' } as const,
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 120 },
    metadata: {},
    status: 'active' as const,
    branches: [],
  };
}

test('rekeyWorkflowTransfer remaps templateNodeId references', () => {
  const flow: WorkflowTransfer = {
    kind: 'cepage.workflow' as const,
    version: 2 as const,
    exportedAt: '2026-04-08T10:00:00.000Z',
    graph: {
      nodes: [
        node({
          id: 'input-1',
          type: 'input',
          content: {
            mode: 'template',
            key: 'chunks',
            label: 'Chunks',
            accepts: ['text'],
            multiple: true,
            required: true,
          },
        }),
        node({
          id: 'bound-1',
          type: 'input',
          content: {
            mode: 'bound',
            templateNodeId: 'input-1',
            parts: [{ id: 'part-1', type: 'text', text: 'chunk-a' }],
            summary: 'one chunk',
          },
        }),
        node({
          id: 'loop-1',
          type: 'loop',
          content: {
            mode: 'for_each',
            source: {
              kind: 'input_parts',
              templateNodeId: 'input-1',
            },
            bodyNodeId: 'sub-1',
            validatorNodeId: 'validator-1',
            advancePolicy: 'only_on_pass',
            sessionPolicy: {
              withinItem: 'new_execution',
              betweenItems: 'new_execution',
            },
            blockedPolicy: 'pause_controller',
          },
        }),
        node({
          id: 'sub-1',
          type: 'sub_graph',
          content: {
            workflowRef: { kind: 'session', sessionId: 'session-template' },
            inputMap: {},
            execution: { newExecution: true },
            entryNodeId: 'step-1',
          },
        }),
        node({
          id: 'step-1',
          type: 'agent_step',
          content: { agentType: 'opencode' },
        }),
        node({
          id: 'validator-1',
          type: 'decision',
          content: {
            mode: 'workspace_validator',
            requirements: ['child output exists'],
            checks: [{ kind: 'path_exists', path: 'outputs/result.txt' }],
            passAction: 'pass',
            failAction: 'retry_same_item',
            blockAction: 'block',
          },
        }),
      ],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  const rekeyed = rekeyWorkflowTransfer(flow);
  const input = rekeyed.graph.nodes.find((entry) => entry.type === 'input' && (entry.content as { mode?: string }).mode === 'template');
  const bound = rekeyed.graph.nodes.find((entry) => entry.type === 'input' && (entry.content as { mode?: string }).mode === 'bound');
  const loop = rekeyed.graph.nodes.find((entry) => entry.type === 'loop');
  const subgraph = rekeyed.graph.nodes.find((entry) => entry.type === 'sub_graph');
  const step = rekeyed.graph.nodes.find((entry) => entry.type === 'agent_step');

  assert.ok(input);
  assert.ok(bound);
  assert.ok(loop);
  assert.ok(subgraph);
  assert.ok(step);
  assert.notEqual(input.id, 'input-1');
  assert.equal((bound.content as { templateNodeId?: string }).templateNodeId, input.id);
  assert.equal(
    (((loop.content as { source?: { templateNodeId?: string } }).source ?? {}).templateNodeId),
    input.id,
  );
  assert.equal((loop.content as { bodyNodeId?: string }).bodyNodeId, subgraph.id);
  assert.equal((subgraph.content as { entryNodeId?: string }).entryNodeId, step.id);

  const parsed = parseWorkflowTransfer(rekeyed);
  assert.equal(parsed.success, true);
});
