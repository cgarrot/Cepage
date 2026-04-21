import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Creator,
  GraphNode,
  NodeContent,
  NodeType,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotMessage,
} from '@cepage/shared-core';
import {
  selectChatConversation,
  selectChatTimeline,
  selectUnifiedChatTimeline,
} from '../chat-timeline.js';

function node(input: {
  id: string;
  type: NodeType;
  creator: Creator;
  content?: NodeContent;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.updatedAt ?? input.createdAt ?? '2026-04-07T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: { x: 0, y: 0 },
    dimensions: { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: 'active',
    branches: [],
  };
}

const human: Creator = { type: 'human', userId: 'u1' };
const agent: Creator = { type: 'agent', agentType: 'opencode', agentId: 'a1' };
const system: Creator = { type: 'system', reason: 'health' };

test('selectChatTimeline keeps only chat-shaped nodes and sorts ascending by createdAt', () => {
  const items = selectChatTimeline([
    node({
      id: 'msg-2',
      type: 'agent_message',
      creator: agent,
      createdAt: '2026-04-07T10:01:00.000Z',
      content: { text: 'hello back', format: 'markdown' },
    }),
    node({
      id: 'msg-1',
      type: 'human_message',
      creator: human,
      createdAt: '2026-04-07T10:00:00.000Z',
      content: { text: 'hi' },
    }),
    node({
      id: 'unrelated',
      type: 'tag',
      creator: system,
      createdAt: '2026-04-07T10:02:00.000Z',
      content: { label: 'pinned' },
    }),
  ]);
  assert.deepEqual(
    items.map((item) => `${item.kind}:${item.id}`),
    ['human_message:msg-1', 'agent_message:msg-2'],
  );
});

test('selectChatTimeline drops messages whose payload is unusable', () => {
  const items = selectChatTimeline([
    node({
      id: 'empty-text',
      type: 'human_message',
      creator: human,
      content: { text: '   ' },
    }),
    node({
      id: 'no-text',
      type: 'agent_message',
      creator: agent,
      content: { format: 'markdown' },
    }),
    node({
      id: 'good',
      type: 'human_message',
      creator: human,
      content: { text: 'real content' },
    }),
  ]);
  assert.deepEqual(
    items.map((item) => item.id),
    ['good'],
  );
});

test('selectChatTimeline reads agent metadata (model + agentType) for agent messages', () => {
  const [item] = selectChatTimeline([
    node({
      id: 'msg-1',
      type: 'agent_message',
      creator: agent,
      content: {
        text: 'hi',
        format: 'markdown',
        agentType: 'planner',
        model: { providerID: 'openai', modelID: 'gpt-5' },
      },
    }),
  ]);
  assert.equal(item.kind, 'agent_message');
  if (item.kind !== 'agent_message') return;
  assert.equal(item.agentType, 'planner');
  assert.deepEqual(item.model, { providerId: 'openai', modelId: 'gpt-5' });
});

test('selectChatTimeline carries workspace_file artifact metadata', () => {
  const [item] = selectChatTimeline([
    node({
      id: 'file-1',
      type: 'workspace_file',
      creator: agent,
      content: {
        title: 'Plan',
        relativePath: 'docs/plan.md',
        role: 'output',
        origin: 'agent_output',
        kind: 'text',
        status: 'available',
        change: 'added',
        summary: 'Project plan',
      },
    }),
  ]);
  assert.equal(item.kind, 'workspace_file');
  if (item.kind !== 'workspace_file') return;
  assert.equal(item.path, 'docs/plan.md');
  assert.equal(item.title, 'Plan');
  assert.equal(item.status, 'available');
  assert.equal(item.change, 'added');
  assert.equal(item.role, 'output');
});

test('selectChatTimeline orders ties by id', () => {
  const items = selectChatTimeline([
    node({
      id: 'b',
      type: 'human_message',
      creator: human,
      createdAt: '2026-04-07T10:00:00.000Z',
      content: { text: 'second tied' },
    }),
    node({
      id: 'a',
      type: 'human_message',
      creator: human,
      createdAt: '2026-04-07T10:00:00.000Z',
      content: { text: 'first tied' },
    }),
  ]);
  assert.deepEqual(
    items.map((item) => item.id),
    ['a', 'b'],
  );
});

test('selectChatConversation hides agent_output rows that should fold under their step', () => {
  const items = selectChatConversation([
    node({
      id: 'step-1',
      type: 'agent_step',
      creator: agent,
      createdAt: '2026-04-07T10:00:00.000Z',
      content: { agentType: 'opencode', label: 'Plan' },
    }),
    node({
      id: 'out-1',
      type: 'agent_output',
      creator: agent,
      createdAt: '2026-04-07T10:00:01.000Z',
      content: { output: 'thinking…', outputType: 'stdout' },
    }),
    node({
      id: 'msg-1',
      type: 'agent_message',
      creator: agent,
      createdAt: '2026-04-07T10:00:02.000Z',
      content: { text: 'done' },
    }),
  ]);
  assert.deepEqual(
    items.map((item) => `${item.kind}:${item.id}`),
    ['agent_step:step-1', 'agent_message:msg-1'],
  );
});

function copilotMessage(input: {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  status?: 'pending' | 'completed' | 'error';
  content?: string;
  createdAt: string;
  analysis?: string;
  summary?: string[];
  warnings?: string[];
  ops?: number;
  apply?: { summary: string[] };
  thinkingOutput?: string;
}): WorkflowCopilotMessage {
  return {
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    status: input.status ?? 'completed',
    content: input.content ?? '',
    summary: input.summary ?? [],
    warnings: input.warnings ?? [],
    ops: Array.from({ length: input.ops ?? 0 }).map<WorkflowCopilotMessage['ops'][number]>(
      () => ({
        kind: 'add_node',
        type: 'tag',
        position: { x: 0, y: 0 },
      }),
    ),
    executions: [],
    executionResults: [],
    ...(input.analysis ? { analysis: input.analysis } : {}),
    ...(input.thinkingOutput ? { thinkingOutput: input.thinkingOutput } : {}),
    ...(input.apply
      ? {
          apply: {
            summary: input.apply.summary,
            createdNodeIds: [],
            updatedNodeIds: [],
            deletedNodeIds: [],
            createdEdgeIds: [],
            deletedEdgeIds: [],
            mergedBranchIds: [],
            abandonedBranchIds: [],
            viewportUpdated: false,
            appliedAt: input.createdAt,
          },
        }
      : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  } as WorkflowCopilotMessage;
}

function copilotCheckpoint(input: {
  id: string;
  threadId: string;
  messageId: string;
  createdAt: string;
  summary?: string[];
}): WorkflowCopilotCheckpoint {
  return {
    id: input.id,
    sessionId: 's1',
    threadId: input.threadId,
    messageId: input.messageId,
    summary: input.summary ?? [],
    createdAt: input.createdAt,
  };
}

test('selectUnifiedChatTimeline interleaves graph nodes with copilot messages by createdAt', () => {
  const items = selectUnifiedChatTimeline({
    nodes: [
      node({
        id: 'graph-msg',
        type: 'human_message',
        creator: human,
        createdAt: '2026-04-07T10:00:01.000Z',
        content: { text: 'Hello from graph' },
      }),
    ],
    copilotMessages: [
      copilotMessage({
        id: 'cp-1',
        threadId: 't1',
        role: 'user',
        content: 'Hello copilot',
        createdAt: '2026-04-07T10:00:00.000Z',
      }),
      copilotMessage({
        id: 'cp-2',
        threadId: 't1',
        role: 'assistant',
        content: 'Hello human',
        analysis: 'thinking',
        summary: ['did x'],
        createdAt: '2026-04-07T10:00:02.000Z',
      }),
    ],
  });
  assert.deepEqual(
    items.map((item) => item.kind),
    ['copilot_message', 'human_message', 'copilot_message'],
  );
  const last = items[2]!;
  assert.equal(last.kind, 'copilot_message');
  if (last.kind !== 'copilot_message') return;
  assert.equal(last.role, 'assistant');
  assert.equal(last.analysis, 'thinking');
  assert.deepEqual(last.summary, ['did x']);
});

test('selectUnifiedChatTimeline anchors checkpoint to the user message that triggered it', () => {
  const items = selectUnifiedChatTimeline({
    nodes: [],
    copilotMessages: [
      copilotMessage({
        id: 'm-user',
        threadId: 't1',
        role: 'user',
        content: 'do it',
        createdAt: '2026-04-07T10:00:00.000Z',
      }),
      copilotMessage({
        id: 'm-assist',
        threadId: 't1',
        role: 'assistant',
        content: 'ok',
        ops: 1,
        createdAt: '2026-04-07T10:00:02.000Z',
      }),
    ],
    copilotCheckpoints: [
      copilotCheckpoint({
        id: 'ckpt-1',
        threadId: 't1',
        messageId: 'm-assist',
        createdAt: '2026-04-07T10:00:01.500Z',
        summary: ['snapshot'],
      }),
    ],
  });
  const checkpoint = items.find((i) => i.kind === 'copilot_checkpoint');
  assert.ok(checkpoint, 'expected checkpoint item');
  if (checkpoint!.kind !== 'copilot_checkpoint') return;
  assert.equal(checkpoint!.forUserMessageId, 'm-user');
  assert.deepEqual(checkpoint!.summary, ['snapshot']);
});

test('selectUnifiedChatTimeline propagates streamed thinkingOutput onto the assistant item', () => {
  // The Copilot panel renders `thinkingOutput` as a collapsible "Thinking…"
  // section above the analysis block. We assert here that it survives the
  // chat-timeline projection so the panel can show streamed reasoning live.
  const items = selectUnifiedChatTimeline({
    nodes: [],
    copilotMessages: [
      copilotMessage({
        id: 'm-assist',
        threadId: 't1',
        role: 'assistant',
        content: 'streaming…',
        status: 'pending',
        thinkingOutput: 'thinking step 1\nthinking step 2',
        createdAt: '2026-04-07T10:00:00.000Z',
      }),
    ],
  });
  const item = items[0]!;
  assert.equal(item.kind, 'copilot_message');
  if (item.kind !== 'copilot_message') return;
  assert.equal(item.thinkingOutput, 'thinking step 1\nthinking step 2');
});

test('selectUnifiedChatTimeline omits thinkingOutput when the agent did not surface reasoning', () => {
  const items = selectUnifiedChatTimeline({
    nodes: [],
    copilotMessages: [
      copilotMessage({
        id: 'm-assist',
        threadId: 't1',
        role: 'assistant',
        content: 'done',
        createdAt: '2026-04-07T10:00:00.000Z',
      }),
    ],
  });
  const item = items[0]!;
  assert.equal(item.kind, 'copilot_message');
  if (item.kind !== 'copilot_message') return;
  assert.equal(item.thinkingOutput, undefined);
});

test('selectUnifiedChatTimeline exposes apply receipt + opCount on assistant messages', () => {
  const items = selectUnifiedChatTimeline({
    nodes: [],
    copilotMessages: [
      copilotMessage({
        id: 'm-assist',
        threadId: 't1',
        role: 'assistant',
        content: 'applied',
        ops: 2,
        apply: { summary: ['+ node A', '+ node B'] },
        createdAt: '2026-04-07T10:00:00.000Z',
      }),
    ],
  });
  const item = items[0]!;
  assert.equal(item.kind, 'copilot_message');
  if (item.kind !== 'copilot_message') return;
  assert.equal(item.opCount, 2);
  assert.ok(item.apply);
  assert.deepEqual(item.apply!.summary, ['+ node A', '+ node B']);
});
