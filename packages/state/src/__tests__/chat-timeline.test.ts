import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AgentRun,
  Creator,
  GraphNode,
  NodeContent,
  NodeType,
  TimelineEntry,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotMessage,
  WorkflowExecution,
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

// -----------------------------------------------------------------------------
// Execution grouping tests: these assert that providing `agentRuns`,
// `executions`, and `activity` collapses every graph node rattached to a
// run into a single `ChatTimelineExecution` block, with fallback siblings,
// configured-vs-called model mismatch detection, and activity-derived
// fallback events. Back-compat is the most important invariant: without
// those inputs the selector must behave exactly like before (orphan blocks).
// -----------------------------------------------------------------------------

const DEFAULT_RUNTIME: AgentRun['runtime'] = {
  kind: 'local_process',
  cwd: '/tmp',
};

function makeAgentRun(input: {
  id: string;
  sessionId?: string;
  executionId?: string;
  type?: string;
  status?: AgentRun['status'];
  startedAt?: string;
  endedAt?: string;
  retryOfRunId?: string;
  stepNodeId?: string;
  rootNodeId?: string;
  model?: { providerID: string; modelID: string };
  outputText?: string;
  isStreaming?: boolean;
}): AgentRun {
  return {
    id: input.id,
    sessionId: (input.sessionId ?? 's1') as AgentRun['sessionId'],
    type: (input.type ?? 'opencode') as AgentRun['type'],
    role: 'executor',
    runtime: DEFAULT_RUNTIME,
    wakeReason: 'manual' as AgentRun['wakeReason'],
    status: (input.status ?? 'completed') as AgentRun['status'],
    startedAt: input.startedAt ?? '2026-04-07T10:00:00.000Z',
    seedNodeIds: [],
    ...(input.executionId ? { executionId: input.executionId as AgentRun['sessionId'] } : {}),
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
    ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId as AgentRun['sessionId'] } : {}),
    ...(input.stepNodeId ? { stepNodeId: input.stepNodeId } : {}),
    ...(input.rootNodeId ? { rootNodeId: input.rootNodeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
    ...(input.isStreaming !== undefined ? { isStreaming: input.isStreaming } : {}),
  };
}

function makeExecution(input: {
  id: string;
  sessionId?: string;
  status?: AgentRun['status'];
  currentRunId?: string;
  latestRunId?: string;
  startedAt?: string;
  endedAt?: string;
}): WorkflowExecution {
  return {
    id: input.id,
    sessionId: (input.sessionId ?? 's1') as WorkflowExecution['sessionId'],
    type: 'opencode' as WorkflowExecution['type'],
    role: 'executor',
    runtime: DEFAULT_RUNTIME,
    wakeReason: 'manual' as WorkflowExecution['wakeReason'],
    status: (input.status ?? 'completed') as WorkflowExecution['status'],
    startedAt: input.startedAt ?? '2026-04-07T10:00:00.000Z',
    createdAt: input.startedAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.startedAt ?? '2026-04-07T10:00:00.000Z',
    seedNodeIds: [],
    ...(input.currentRunId
      ? { currentRunId: input.currentRunId as WorkflowExecution['currentRunId'] }
      : {}),
    ...(input.latestRunId
      ? { latestRunId: input.latestRunId as WorkflowExecution['latestRunId'] }
      : {}),
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
  };
}

function makeActivity(input: {
  id: string;
  runId: string;
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
  timestamp?: string;
}): TimelineEntry {
  return {
    id: input.id,
    timestamp: input.timestamp ?? '2026-04-07T10:00:05.000Z',
    actorType: 'agent',
    actorId: input.runId,
    runId: input.runId,
    summary: `Fallback: ${input.fromProvider}/${input.fromModel} → ${input.toProvider}/${input.toModel} (${input.reason})`,
    summaryKey: 'activity.agent_fallback_switch',
    summaryParams: {
      fromProvider: input.fromProvider,
      fromModel: input.fromModel,
      toProvider: input.toProvider,
      toModel: input.toModel,
      reason: input.reason,
    },
    metadata: { kind: 'agent_fallback_switch' },
  };
}

test('selectUnifiedChatTimeline stays back-compat when agentRuns/executions are omitted', () => {
  // Exact same input as the prior spawn/step tests rely on — no agentRuns /
  // executions / activity. The selector must keep emitting the standalone
  // `agent_spawn` and `agent_step` blocks or the UI breaks for every
  // workflow that hasn't yet run.
  const items = selectUnifiedChatTimeline({
    nodes: [
      node({
        id: 'spawn-1',
        type: 'agent_spawn',
        creator: agent,
        createdAt: '2026-04-07T10:00:00.000Z',
        content: { agentType: 'opencode' },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: agent,
        createdAt: '2026-04-07T10:00:01.000Z',
        content: { agentType: 'opencode', label: 'Plan' },
      }),
    ],
  });
  assert.deepEqual(
    items.map((i) => `${i.kind}:${i.id}`),
    ['agent_spawn:spawn-1', 'agent_step:step-1'],
  );
});

test('selectUnifiedChatTimeline collapses runs/nodes into a single execution block', () => {
  const primary = makeAgentRun({
    id: 'run-1',
    executionId: 'exec-1',
    status: 'failed',
    startedAt: '2026-04-07T10:00:00.000Z',
    endedAt: '2026-04-07T10:00:03.000Z',
    stepNodeId: 'step-1',
    model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
  });
  const sibling = makeAgentRun({
    id: 'run-2',
    executionId: 'exec-1',
    status: 'completed',
    startedAt: '2026-04-07T10:00:04.000Z',
    endedAt: '2026-04-07T10:00:08.000Z',
    retryOfRunId: 'run-1',
    stepNodeId: 'step-1',
    model: { providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' },
    outputText: 'done',
  });
  const execution = makeExecution({
    id: 'exec-1',
    status: 'completed',
    currentRunId: 'run-2',
    latestRunId: 'run-2',
    startedAt: '2026-04-07T10:00:00.000Z',
    endedAt: '2026-04-07T10:00:08.000Z',
  });

  const items = selectUnifiedChatTimeline({
    nodes: [
      // Spawn was created by the copilot (or runtime) — should get subsumed.
      node({
        id: 'spawn-1',
        type: 'agent_spawn',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        createdAt: '2026-04-07T10:00:00.000Z',
        content: { agentType: 'opencode' },
      }),
      // Step node is the declared target of both runs — subsumed into steps[].
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        createdAt: '2026-04-07T10:00:01.000Z',
        content: {
          agentType: 'opencode',
          label: 'Plan',
          model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
        },
      }),
    ],
    agentRuns: { 'run-1': primary, 'run-2': sibling },
    executions: { 'exec-1': execution },
    activity: [
      makeActivity({
        id: 'act-1',
        runId: 'run-1',
        fromProvider: 'google',
        fromModel: 'gemini-1.5-flash',
        toProvider: 'zai-coding-plan',
        toModel: 'glm-5v-turbo',
        reason: 'HTTP 503',
        timestamp: '2026-04-07T10:00:03.500Z',
      }),
    ],
  });

  // Only the execution block should remain; spawn + step are folded in.
  assert.equal(items.length, 1);
  const block = items[0]!;
  assert.equal(block.kind, 'execution');
  if (block.kind !== 'execution') return;
  assert.equal(block.id, 'exec-1');
  assert.equal(block.currentRunId, 'run-2');
  assert.equal(block.status, 'completed');
  // Siblings ordered chronologically, primary flagged:
  assert.equal(block.siblings.length, 2);
  assert.equal(block.siblings[0]!.runId, 'run-1');
  assert.equal(block.siblings[0]!.isPrimary, true);
  assert.equal(block.siblings[1]!.runId, 'run-2');
  assert.equal(block.siblings[1]!.isPrimary, false);
  // Configured model (from step content) vs called model (from current run):
  assert.deepEqual(block.configuredModel, { providerId: 'google', modelId: 'gemini-1.5-flash' });
  assert.deepEqual(block.calledModel, {
    providerId: 'zai-coding-plan',
    modelId: 'glm-5v-turbo',
  });
  // Step node was subsumed into steps[].
  assert.equal(block.steps.length, 1);
  assert.equal(block.steps[0]!.id, 'step-1');
  // Fallback event was matched by runId.
  assert.equal(block.fallbackEvents.length, 1);
  assert.equal(block.fallbackEvents[0]!.reason, 'HTTP 503');
  assert.deepEqual(block.fallbackEvents[0]!.fromModel, {
    providerId: 'google',
    modelId: 'gemini-1.5-flash',
  });
  assert.deepEqual(block.fallbackEvents[0]!.toModel, {
    providerId: 'zai-coding-plan',
    modelId: 'glm-5v-turbo',
  });
  // Timestamp of the block = primary.startedAt so it inserts at the right
  // position in the unified feed (not at the sibling's later timestamp).
  assert.equal(block.createdAt, '2026-04-07T10:00:00.000Z');
});

test('selectUnifiedChatTimeline keeps orphan nodes standalone when no run is attached', () => {
  // Execution grouping is engaged (one exec has runs), but the second spawn
  // is not linked to any run → must continue rendering as a standalone
  // `agent_spawn` block so the user still sees the designed workflow.
  const run = makeAgentRun({
    id: 'run-1',
    executionId: 'exec-1',
    status: 'completed',
    stepNodeId: 'step-1',
  });
  const items = selectUnifiedChatTimeline({
    nodes: [
      node({
        id: 'spawn-1',
        type: 'agent_spawn',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        createdAt: '2026-04-07T10:00:00.000Z',
        content: { agentType: 'opencode' },
      }),
      node({
        id: 'spawn-orphan',
        type: 'agent_spawn',
        creator: agent,
        createdAt: '2026-04-07T10:00:02.000Z',
        content: { agentType: 'opencode' },
      }),
    ],
    agentRuns: { 'run-1': run },
    executions: { 'exec-1': makeExecution({ id: 'exec-1', currentRunId: 'run-1' }) },
  });
  // Expect: orphan spawn + one execution block (attached run-1).
  const kinds = items.map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['agent_spawn', 'execution']);
  const orphan = items.find((i) => i.kind === 'agent_spawn');
  assert.equal(orphan?.id, 'spawn-orphan');
});

test('selectUnifiedChatTimeline produces equal configured/called models with no mismatch when run uses the configured model', () => {
  const run = makeAgentRun({
    id: 'run-1',
    executionId: 'exec-1',
    status: 'completed',
    stepNodeId: 'step-1',
    model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
  });
  const items = selectUnifiedChatTimeline({
    nodes: [
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        createdAt: '2026-04-07T10:00:00.000Z',
        content: {
          agentType: 'opencode',
          label: 'Plan',
          model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
        },
      }),
    ],
    agentRuns: { 'run-1': run },
    executions: { 'exec-1': makeExecution({ id: 'exec-1', currentRunId: 'run-1' }) },
  });
  const block = items[0]!;
  assert.equal(block.kind, 'execution');
  if (block.kind !== 'execution') return;
  assert.deepEqual(block.configuredModel, block.calledModel);
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
