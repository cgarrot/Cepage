import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { GraphNode, GraphSnapshot, WorkflowSubgraphContent } from '@cepage/shared-core';
import {
  collectWorkflowPromptInputs,
  hasWorkflowFileLastLine,
  isWorkflowOutputFresh,
  pickWorkflowControllerOutputNodeId,
  pickWorkflowControllerPromptNodeId,
  pickWorkflowChildSelection,
  renderReferencedWorkflowPrompt,
} from '../workflow-controller.util.js';
import {
  hasWorkflowJsonPath,
  hasWorkflowJsonPathArrayNonempty,
  hasWorkflowJsonPathNonempty,
  readWorkflowJsonPath,
} from '../workflow-json.util.js';
import { WorkflowControllerService } from '../workflow-controller.service.js';

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

test('renderReferencedWorkflowPrompt exposes latest bound parent inputs', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'objective-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'global_objective',
          label: 'Global objective',
          accepts: ['text'],
          required: true,
        },
      }),
      node({
        id: 'objective-old',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        updatedAt: '2026-04-07T10:01:00.000Z',
        content: {
          mode: 'bound',
          templateNodeId: 'objective-template',
          parts: [{ id: 'part-old', type: 'text', text: 'Old goal' }],
        },
      }),
      node({
        id: 'objective-new',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        updatedAt: '2026-04-07T10:02:00.000Z',
        content: {
          mode: 'bound',
          templateNodeId: 'objective-template',
          parts: [{ id: 'part-new', type: 'text', text: 'Ship the feature' }],
        },
      }),
      node({
        id: 'step-note',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: {
          text: 'Objective: {{controller.global_objective}}\nChunk: {{loop.item_text}}',
          format: 'markdown',
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-note',
    inputMap: {
      objective: '{{controller.global_objective}}',
      objectiveRich: '{{inputs.global_objective.text}}',
      chunk: '{{loop.item_text}}',
    },
    execution: {},
  };

  const prompt = renderReferencedWorkflowPrompt(snap, subgraph, {
    item: {
      key: 'item-1',
      label: 'Chunk 1',
      value: 'Build the validator',
      text: 'Build the validator',
    },
    index: 0,
    attempt: 1,
    completedSummaries: [],
    inputs: collectWorkflowPromptInputs(snap),
  });

  assert.match(prompt, /Input objective\nShip the feature/);
  assert.match(prompt, /Input objectiveRich\nShip the feature/);
  assert.match(prompt, /Input chunk\nBuild the validator/);
  assert.match(prompt, /Objective: Ship the feature/);
  assert.match(prompt, /Chunk: Build the validator/);
  assert.match(prompt, /Parent inputs\nGlobal objective \(global_objective\)\nShip the feature/);
});

test('renderReferencedWorkflowPrompt keeps referenced workflow local to the entry node', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'brand-brief',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Brand brief',
          relativePath: 'inputs/brand-brief.md',
          role: 'input',
          origin: 'user_upload',
          kind: 'text',
          transferMode: 'reference',
        },
      }),
      node({
        id: 'step-local',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: {
          label: 'Local step',
          agentSelection: {
            mode: 'locked',
            selection: {
              type: 'cursor_agent',
              model: { providerID: 'cursor', modelID: 'composer-2-fast' },
            },
          },
        },
      }),
      node({
        id: 'local-output',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Chunk result',
          relativePath: 'outputs/chunk-result.md',
          role: 'intermediate',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
        },
      }),
      node({
        id: 'step-downstream',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: {
          label: 'Downstream step',
          agentSelection: {
            mode: 'locked',
            selection: {
              type: 'cursor_agent',
              model: { providerID: 'cursor', modelID: 'composer-2-fast' },
            },
          },
        },
      }),
      node({
        id: 'downstream-output',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Downstream report',
          relativePath: 'outputs/downstream.md',
          role: 'intermediate',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'brand-brief',
        target: 'step-local',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'step-local',
        target: 'local-output',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-3',
        source: 'local-output',
        target: 'step-downstream',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-4',
        source: 'step-downstream',
        target: 'downstream-output',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-local',
    inputMap: {},
    execution: {},
  };

  const prompt = renderReferencedWorkflowPrompt(snap, subgraph, {
    item: {
      key: 'item-1',
      label: 'Chunk 1',
      value: 'Build the validator',
      text: 'Build the validator',
    },
    index: 0,
    attempt: 1,
    completedSummaries: [],
  });

  assert.match(prompt, /Brand brief/);
  assert.match(prompt, /Local step/);
  assert.match(prompt, /Chunk result/);
  assert.doesNotMatch(prompt, /Downstream step/);
  assert.doesNotMatch(prompt, /Downstream report/);
});

test('renderReferencedWorkflowPrompt limits parent inputs to referenced bindings', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'objective-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'global_objective',
          label: 'Global objective',
          accepts: ['text'],
          required: true,
        },
      }),
      node({
        id: 'objective-bound',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        updatedAt: '2026-04-07T10:02:00.000Z',
        content: {
          mode: 'bound',
          templateNodeId: 'objective-template',
          parts: [{ id: 'part-new', type: 'text', text: 'Ship the feature' }],
        },
      }),
      node({
        id: 'extra-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'extra_context',
          label: 'Extra context',
          accepts: ['text'],
          required: false,
        },
      }),
      node({
        id: 'extra-bound',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        updatedAt: '2026-04-07T10:03:00.000Z',
        content: {
          mode: 'bound',
          templateNodeId: 'extra-template',
          parts: [{ id: 'part-extra', type: 'text', text: 'Do not include me' }],
        },
      }),
      node({
        id: 'step-note',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: {
          text: 'Objective: {{controller.global_objective}}',
          format: 'markdown',
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-note',
    inputMap: {
      objective: '{{inputs.global_objective.text}}',
      chunk: '{{loop.item_text}}',
    },
    execution: {},
  };

  const prompt = renderReferencedWorkflowPrompt(snap, subgraph, {
    item: {
      key: 'item-1',
      label: 'Chunk 1',
      value: 'Build the validator',
      text: 'Build the validator',
    },
    index: 0,
    attempt: 1,
    completedSummaries: [],
    inputs: collectWorkflowPromptInputs(snap),
  });

  assert.match(prompt, /Parent inputs\nGlobal objective \(global_objective\)\nShip the feature/);
  assert.doesNotMatch(prompt, /Extra context \(extra_context\)/);
});

test('renderReferencedWorkflowPrompt lists resolved current-run outputs', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    inputMap: {},
    execution: {},
    expectedOutputs: ['outputs/chunk-result.md'],
  };

  const prompt = renderReferencedWorkflowPrompt(snap, subgraph, {
    item: {
      key: 'item-1',
      label: 'Chunk 1',
      value: 'Build the validator',
      text: 'Build the validator',
    },
    index: 0,
    attempt: 1,
    completedSummaries: [],
    outputs: [
      {
        relativePath: 'outputs/chunk-result.md',
        resolvedRelativePath: 'outputs/run-abcd1234/chunk-result.md',
        pathMode: 'per_run',
      },
    ],
  });

  assert.match(prompt, /Current run outputs/);
  assert.match(prompt, /Write output files to the resolved path for this attempt/);
  assert.match(prompt, /outputs\/run-abcd1234\/chunk-result\.md \(template: outputs\/chunk-result\.md, mode: per_run\)/);
});

test('isWorkflowOutputFresh rejects outputs older than the current attempt', () => {
  const startedAt = new Date('2026-04-07T10:00:05.000Z');

  assert.equal(isWorkflowOutputFresh(startedAt.getTime(), startedAt), true);
  assert.equal(isWorkflowOutputFresh(startedAt.getTime() - 500, startedAt), true);
  assert.equal(isWorkflowOutputFresh(startedAt.getTime() - 5_000, startedAt), false);
  assert.equal(isWorkflowOutputFresh(undefined, startedAt), false);
  assert.equal(isWorkflowOutputFresh(undefined, null), true);
});

test('hasWorkflowFileLastLine requires an exact terminal marker', () => {
  assert.equal(hasWorkflowFileLastLine('hello\n<!-- CHUNK_DONE -->\n', '<!-- CHUNK_DONE -->'), true);
  assert.equal(hasWorkflowFileLastLine('hello\n<!-- CHUNK_DONE -->\nextra', '<!-- CHUNK_DONE -->'), false);
  assert.equal(hasWorkflowFileLastLine('hello\n<!-- chunk_done -->', '<!-- CHUNK_DONE -->'), false);
});

test('workflow json path helpers support nested keys and array indexes', () => {
  const report = {
    summary: { total: 2 },
    items: [
      { title: 'Add boss wave' },
      { title: 'Tune progression' },
    ],
    empty: [],
  };

  assert.equal(hasWorkflowJsonPath(report, 'summary.total'), true);
  assert.equal(hasWorkflowJsonPath(report, 'items[1].title'), true);
  assert.equal(hasWorkflowJsonPath(report, 'items[2].title'), false);
  assert.equal(hasWorkflowJsonPathNonempty(report, 'summary'), true);
  assert.equal(hasWorkflowJsonPathNonempty(report, 'items[0].title'), true);
  assert.equal(hasWorkflowJsonPathNonempty(report, 'empty'), false);
  assert.equal(hasWorkflowJsonPathArrayNonempty(report, 'items'), true);
  assert.equal(hasWorkflowJsonPathArrayNonempty(report, 'empty'), false);
  assert.equal(readWorkflowJsonPath(report, 'items[0].title'), 'Add boss wave');
});

test('pickWorkflowChildSelection prefers a locked child node over the parent subgraph override', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: {
          role: 'builder',
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
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-1',
    inputMap: {},
    execution: {
      type: 'opencode',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4',
      },
    },
  };

  assert.deepEqual(pickWorkflowChildSelection(snap, subgraph), {
    type: 'cursor_agent',
    role: 'builder',
    model: {
      providerID: 'cursor',
      modelID: 'composer-2-fast',
    },
  });
});

test('pickWorkflowChildSelection falls back to the parent subgraph override before nearby inherited context', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: {
          role: 'builder',
          agentSelection: {
            mode: 'inherit',
          },
        },
      }),
      node({
        id: 'note-1',
        type: 'note',
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
    edges: [{ id: 'edge-1', source: 'step-1', target: 'note-1', relation: 'feeds_into', direction: 'source_to_target', strength: 1, createdAt: '2026-04-07T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} }],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-1',
    inputMap: {},
    execution: {
      type: 'opencode',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-4.5-sonnet',
      },
    },
  };

  assert.deepEqual(pickWorkflowChildSelection(snap, subgraph), {
    type: 'opencode',
    role: 'builder',
    model: {
      providerID: 'anthropic',
      modelID: 'claude-4.5-sonnet',
    },
  });
});

test('pickWorkflowChildSelection uses the nearest locked graph context when the step inherits and no parent override exists', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: {
          role: 'builder',
          agentSelection: {
            mode: 'inherit',
          },
        },
      }),
      node({
        id: 'note-near',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        createdAt: '2026-04-07T10:00:01.000Z',
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
        id: 'note-far',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        createdAt: '2026-04-07T10:00:02.000Z',
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
    ],
    edges: [
      { id: 'edge-1', source: 'step-1', target: 'note-near', relation: 'feeds_into', direction: 'source_to_target', strength: 1, createdAt: '2026-04-07T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} },
      { id: 'edge-2', source: 'note-near', target: 'note-far', relation: 'feeds_into', direction: 'source_to_target', strength: 1, createdAt: '2026-04-07T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const subgraph: WorkflowSubgraphContent = {
    workflowRef: { kind: 'session', sessionId: 'session-1' },
    entryNodeId: 'step-1',
    inputMap: {},
    execution: {},
  };

  assert.deepEqual(pickWorkflowChildSelection(snap, subgraph), {
    type: 'cursor_agent',
    role: 'builder',
    model: {
      providerID: 'cursor',
      modelID: 'composer-2-fast',
    },
  });
});

test('pickWorkflowControllerPromptNodeId reuses the latest controller-owned note', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'note-human',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      }),
      node({
        id: 'note-old',
        type: 'note',
        creator: { type: 'system', reason: 'workflow_controller' },
        updatedAt: '2026-04-07T10:01:00.000Z',
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: 'ctrl-1',
        },
      }),
      node({
        id: 'note-new',
        type: 'note',
        creator: { type: 'system', reason: 'workflow_controller' },
        updatedAt: '2026-04-07T10:02:00.000Z',
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: 'ctrl-1',
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  assert.equal(pickWorkflowControllerPromptNodeId(snap, 'ctrl-1'), 'note-new');
  assert.equal(pickWorkflowControllerPromptNodeId(snap, 'ctrl-1', 'note-old'), 'note-old');
});

test('pickWorkflowControllerOutputNodeId prefers the declared workflow output over unrelated matches', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'subgraph-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'declared-output',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Chunk result',
          relativePath: 'outputs/chunk-result.md',
          pathMode: 'static',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'controller-output',
        type: 'workspace_file',
        creator: { type: 'system', reason: 'workflow_controller' },
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: 'ctrl-1',
        },
        content: {
          title: 'Chunk result copy',
          relativePath: 'outputs/chunk-result.md',
          pathMode: 'static',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'other-output',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Other chunk result',
          relativePath: 'outputs/chunk-result.md',
          pathMode: 'static',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
    ],
    edges: [
      { id: 'edge-1', source: 'subgraph-1', target: 'step-1', relation: 'contains', direction: 'source_to_target', strength: 1, createdAt: '2026-04-07T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} },
      { id: 'edge-2', source: 'step-1', target: 'declared-output', relation: 'produces', direction: 'source_to_target', strength: 1, createdAt: '2026-04-07T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  assert.equal(
    pickWorkflowControllerOutputNodeId(snap, {
      controllerId: 'ctrl-1',
      bodyNodeId: 'subgraph-1',
      relativePath: 'outputs/chunk-result.md',
    }),
    'declared-output',
  );
  assert.equal(
    pickWorkflowControllerOutputNodeId(snap, {
      controllerId: 'ctrl-1',
      bodyNodeId: 'subgraph-1',
      relativePath: 'outputs/chunk-result.md',
      currentId: 'controller-output',
    }),
    'controller-output',
  );
});

test('pickWorkflowControllerOutputNodeId matches per-run outputs on the template path and prefers the current item', () => {
  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [
      node({
        id: 'subgraph-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'declared-output',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Chunk result',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-550e8400/chunk-result.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'available',
        },
      }),
      node({
        id: 'controller-output-a',
        type: 'workspace_file',
        creator: { type: 'system', reason: 'workflow_controller' },
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: 'ctrl-1',
          itemKey: 'item-a',
        },
        content: {
          title: 'Chunk result A',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-11111111/chunk-result.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'available',
        },
      }),
      node({
        id: 'controller-output-b',
        type: 'workspace_file',
        creator: { type: 'system', reason: 'workflow_controller' },
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: 'ctrl-1',
          itemKey: 'item-b',
        },
        content: {
          title: 'Chunk result B',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-22222222/chunk-result.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'available',
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'subgraph-1',
        target: 'step-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'step-1',
        target: 'declared-output',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-07T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  assert.equal(
    pickWorkflowControllerOutputNodeId(snap, {
      controllerId: 'ctrl-1',
      bodyNodeId: 'subgraph-1',
      relativePath: 'outputs/chunk-result.md',
      currentId: 'controller-output-a',
      itemKey: 'item-b',
    }),
    'controller-output-b',
  );
});

test('evaluateChildRun resolves per-run output paths for expected outputs and validators', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-output-'));
  const runId = '550e8400-e29b-41d4-a716-446655440000';
  const cwd = path.join(root, 'workspace');
  const filepath = path.join(cwd, 'outputs', 'run-550e8400', 'chunk-result.md');

  try {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, 'Summary\nCHUNK_COMPLETE');

    const service = new WorkflowControllerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const evaluation = await (
      service as unknown as {
        evaluateChildRun: (input: {
          session: {
            id: string;
            workspaceParentDirectory: string | null;
            workspaceDirectoryName: string | null;
          };
          refSnapshot: GraphSnapshot;
          loop: {
            mode: 'for_each';
            source: { kind: 'inline_list'; items: string[] };
            bodyNodeId: string;
            advancePolicy: 'only_on_pass';
            sessionPolicy: {
              withinItem: 'reuse_execution';
              betweenItems: 'new_execution';
            };
            blockedPolicy: 'pause_controller';
            itemLabel: string;
          };
          subgraph: WorkflowSubgraphContent;
          validatorNode: { id: string; type: string; content: Record<string, unknown> } | null;
          childStatus: string;
          run: {
            id: string;
            outputText: string | null;
            status: string;
            startedAt: Date;
            endedAt: Date | null;
          } | null;
        }) => Promise<{ outcome: string; detail: string }>;
      }
    ).evaluateChildRun({
      session: {
        id: 'session-1',
        workspaceParentDirectory: root,
        workspaceDirectoryName: 'workspace',
      },
      refSnapshot: {
        version: 1,
        id: 'session-1',
        createdAt: '2026-04-07T10:00:00.000Z',
        lastEventId: 1,
        nodes: [
          node({
            id: 'declared-output',
            type: 'workspace_file',
            creator: { type: 'human', userId: 'u1' },
            content: {
              title: 'Chunk result',
              relativePath: 'outputs/chunk-result.md',
              pathMode: 'per_run',
              role: 'output',
              origin: 'derived',
              kind: 'text',
              transferMode: 'reference',
              status: 'declared',
            },
          }),
        ],
        edges: [],
        branches: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      loop: {
        mode: 'for_each',
        source: { kind: 'inline_list', items: ['chunk-a'] },
        bodyNodeId: 'subgraph-1',
        advancePolicy: 'only_on_pass',
        sessionPolicy: {
          withinItem: 'reuse_execution',
          betweenItems: 'new_execution',
        },
        blockedPolicy: 'pause_controller',
        itemLabel: 'chunk',
      },
      subgraph: {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        expectedOutputs: ['outputs/chunk-result.md'],
      },
      validatorNode: {
        id: 'validator-1',
        type: 'decision',
        content: {
          mode: 'workspace_validator',
          requirements: ['Chunk output must be complete.'],
          evidenceFrom: ['outputs/chunk-result.md'],
          checks: [
            {
              kind: 'file_last_line_equals',
              path: 'outputs/chunk-result.md',
              text: 'CHUNK_COMPLETE',
            },
          ],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      childStatus: 'completed',
      run: {
        id: runId,
        outputText: 'Chunk completed',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000),
        endedAt: new Date(),
      },
    });

    assert.equal(evaluation.outcome, 'pass');
    assert.equal(evaluation.detail, 'Chunk completed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
