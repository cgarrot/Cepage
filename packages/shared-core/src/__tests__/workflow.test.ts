import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode, GraphSnapshot } from '../graph.js';
import { parseWorkflowTransfer, workflowFromSnapshot } from '../workflow.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-07T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

test('parseWorkflowTransfer accepts v2 loop controller workflows', () => {
  const parsed = parseWorkflowTransfer({
    kind: 'cepage.workflow',
    version: 2,
    exportedAt: '2026-04-07T10:00:00.000Z',
    graph: {
      nodes: [
        node({
          id: 'loop-1',
          type: 'loop',
          creator: { type: 'human', userId: 'u1' },
          content: {
            mode: 'for_each',
            source: {
              kind: 'inline_list',
              items: ['chunk-a', 'chunk-b'],
            },
            bodyNodeId: 'sub-1',
            validatorNodeId: 'validator-1',
            advancePolicy: 'only_on_pass',
            sessionPolicy: {
              withinItem: 'reuse_execution',
              betweenItems: 'new_execution',
            },
            blockedPolicy: 'pause_controller',
          },
        }),
        node({
          id: 'sub-1',
          type: 'sub_graph',
          creator: { type: 'human', userId: 'u1' },
          content: {
            workflowRef: {
              kind: 'session',
              sessionId: 'template-1',
            },
            inputMap: {
              brief: '{{item.text}}',
            },
            execution: {
              newExecution: true,
            },
            expectedOutputs: ['deliverable.md'],
          },
        }),
        node({
          id: 'validator-1',
          type: 'decision',
          creator: { type: 'human', userId: 'u1' },
          content: {
            mode: 'workspace_validator',
            requirements: ['The loop item must produce a deliverable.'],
            checks: [{ kind: 'path_exists', path: 'deliverable.md' }],
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
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.version, 2);
});

test('workflowFromSnapshot upgrades control nodes to v2 and strips runtime controller metadata', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: {
            kind: 'inline_list',
            items: ['chunk-a'],
          },
          bodyNodeId: 'step-1',
          advancePolicy: 'only_on_pass',
          sessionPolicy: {
            withinItem: 'reuse_execution',
            betweenItems: 'new_execution',
          },
          blockedPolicy: 'pause_controller',
        },
        metadata: {
          controller: {
            id: 'ctl-1',
            status: 'running',
          },
          controllerState: {
            id: 'ctl-1',
          },
          label: 'keep-me',
        },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const flow = workflowFromSnapshot(snap);
  const loop = flow.graph.nodes.find((entry) => entry.id === 'loop-1');

  assert.equal(flow.version, 2);
  assert.equal(loop?.metadata?.label, 'keep-me');
  assert.equal('controller' in (loop?.metadata ?? {}), false);
  assert.equal('controllerState' in (loop?.metadata ?? {}), false);
});

test('parseWorkflowTransfer accepts shared node agent selections', () => {
  const parsed = parseWorkflowTransfer({
    kind: 'cepage.workflow',
    version: 2,
    exportedAt: '2026-04-07T10:00:00.000Z',
    graph: {
      nodes: [
        node({
          id: 'note-1',
          type: 'note',
          creator: { type: 'human', userId: 'u1' },
          content: {
            text: 'Use the inherited selection here.',
            agentSelection: {
              mode: 'inherit',
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
        node({
          id: 'step-1',
          type: 'agent_step',
          creator: { type: 'human', userId: 'u1' },
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
      ],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });

  assert.equal(parsed.success, true);
});

test('parseWorkflowTransfer rejects locked node agent selections without a selection', () => {
  const parsed = parseWorkflowTransfer({
    kind: 'cepage.workflow',
    version: 2,
    exportedAt: '2026-04-07T10:00:00.000Z',
    graph: {
      nodes: [
        node({
          id: 'step-1',
          type: 'agent_step',
          creator: { type: 'human', userId: 'u1' },
          content: {
            agentSelection: {
              mode: 'locked',
            },
          },
        }),
      ],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });

  assert.equal(parsed.success, false);
});

test('parseWorkflowTransfer accepts connector targets and connector phases in v2 workflows', () => {
  const parsed = parseWorkflowTransfer({
    kind: 'cepage.workflow',
    version: 2,
    exportedAt: '2026-04-07T10:00:00.000Z',
    graph: {
      nodes: [
        node({
          id: 'connector-1',
          type: 'connector_target',
          creator: { type: 'human', userId: 'u1' },
          content: {
            kind: 'http',
            title: 'Generate lyrics',
            method: 'POST',
            url: 'http://localhost:3000/api/lyrics',
            body: {
              kind: 'file',
              path: 'outputs/requests/lyrics.json',
              format: 'json',
            },
            output: {
              path: 'outputs/generation/lyrics-response.json',
              format: 'json',
            },
          },
        }),
        node({
          id: 'validator-1',
          type: 'decision',
          creator: { type: 'human', userId: 'u1' },
          content: {
            mode: 'workspace_validator',
            requirements: ['Connector must succeed and write lyrics output.'],
            checks: [
              { kind: 'connector_status_is', status: 'completed' },
              { kind: 'path_nonempty', path: 'outputs/generation/lyrics-response.json' },
            ],
            passAction: 'pass',
            failAction: 'retry_new_execution',
            blockAction: 'block',
          },
        }),
        node({
          id: 'flow-1',
          type: 'managed_flow',
          creator: { type: 'human', userId: 'u1' },
          content: {
            title: 'Connector flow',
            syncMode: 'managed',
            entryPhaseId: 'lyrics',
            phases: [
              {
                id: 'lyrics',
                kind: 'connector_phase',
                nodeId: 'connector-1',
                validatorNodeId: 'validator-1',
                expectedOutputs: ['outputs/generation/lyrics-response.json'],
              },
            ],
          },
        }),
      ],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });

  assert.equal(parsed.success, true);
});
