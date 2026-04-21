import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowCopilotCheckpoint, WorkflowCopilotMessage, WorkflowCopilotThread } from '@cepage/shared-core';
import {
  createPendingWorkflowCopilotSend,
  dropPendingWorkflowCopilotSend,
  mergeWorkflowCopilotLiveMessage,
  mergeWorkflowCopilotMessages,
  readWorkflowCopilotPatch,
  settlePendingWorkflowCopilotSend,
} from '../workflow-copilot-state.js';

test('readWorkflowCopilotPatch replaces the active bundle and clears transient flags', () => {
  const thread: WorkflowCopilotThread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    title: 'Workflow copilot',
    agentType: 'opencode',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z',
  };
  const messages: WorkflowCopilotMessage[] = [
    {
      id: 'message-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'completed',
      content: 'Go back to the previous version.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
      executionResults: [],
      createdAt: '2026-04-08T10:01:00.000Z',
      updatedAt: '2026-04-08T10:01:00.000Z',
    },
    {
      id: 'message-2',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      content: 'Restored to the earlier checkpoint.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
      executionResults: [],
      createdAt: '2026-04-08T10:02:00.000Z',
      updatedAt: '2026-04-08T10:02:00.000Z',
    },
  ];
  const checkpoint: WorkflowCopilotCheckpoint = {
    id: 'checkpoint-1',
    sessionId: 'session-1',
    threadId: 'thread-1',
    messageId: 'message-2',
    summary: ['Restore workflow'],
    createdAt: '2026-04-08T10:02:30.000Z',
    restoredAt: '2026-04-08T10:03:00.000Z',
  };
  assert.deepEqual(readWorkflowCopilotPatch({ thread, messages, checkpoints: [checkpoint] }), {
    workflowCopilotThread: thread,
    workflowCopilotMessages: messages,
    workflowCopilotCheckpoints: [checkpoint],
    workflowCopilotLoading: false,
    workflowCopilotSending: false,
    workflowCopilotStopping: false,
    workflowCopilotApplyingMessageId: null,
    workflowCopilotRestoringCheckpointId: null,
  });
});

function message(input: Partial<WorkflowCopilotMessage> & Pick<WorkflowCopilotMessage, 'id' | 'threadId' | 'role'>): WorkflowCopilotMessage {
  return {
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    status: input.status ?? 'completed',
    content: input.content ?? '',
    summary: input.summary ?? [],
    warnings: input.warnings ?? [],
    ops: input.ops ?? [],
    executions: input.executions ?? [],
    executionResults: input.executionResults ?? [],
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? input.createdAt ?? '2026-04-03T10:00:00.000Z',
    ...(input.analysis ? { analysis: input.analysis } : {}),
    ...(input.apply ? { apply: input.apply } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.agentType ? { agentType: input.agentType } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.rawOutput ? { rawOutput: input.rawOutput } : {}),
    ...(input.thinkingOutput ? { thinkingOutput: input.thinkingOutput } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
}

test('createPendingWorkflowCopilotSend creates optimistic user and assistant messages', () => {
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: 'Add a multiplayer branch.',
    scope: { kind: 'node', nodeId: 'node-1' },
    selection: {
      type: 'cursor_agent',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4',
      },
    },
    at: new Date('2026-04-03T10:00:00.000Z'),
  });

  assert.equal(pending.messages[0].role, 'user');
  assert.equal(pending.messages[0].status, 'completed');
  assert.equal(pending.messages[0].content, 'Add a multiplayer branch.');
  assert.deepEqual(pending.messages[0].scope, { kind: 'node', nodeId: 'node-1' });
  assert.deepEqual(pending.messages[0].model, { providerID: 'openai', modelID: 'gpt-5.4' });

  assert.equal(pending.messages[1].role, 'assistant');
  assert.equal(pending.messages[1].status, 'pending');
  assert.equal(pending.messages[1].content, '');
  assert.equal(pending.messages[1].createdAt, '2026-04-03T10:00:00.001Z');
});

test('createPendingWorkflowCopilotSend carries attachments on the user message', () => {
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: '',
    attachments: [
      {
        filename: 'x.txt',
        mime: 'text/plain',
        data: 'data:text/plain;base64,aGk=',
      },
    ],
  });
  assert.equal(pending.messages[0].attachments?.length, 1);
  assert.equal(pending.messages[0].attachments?.[0]?.filename, 'x.txt');
});

test('settlePendingWorkflowCopilotSend swaps optimistic messages for persisted ones', () => {
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: 'Add a multiplayer branch.',
    at: new Date('2026-04-03T10:00:00.000Z'),
  });
  const current = mergeWorkflowCopilotMessages(
    [
      message({
        id: 'old-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'Previous turn',
        createdAt: '2026-04-03T09:59:00.000Z',
      }),
    ],
    pending.messages,
  );

  const settled = settlePendingWorkflowCopilotSend({
    current,
    pending,
    next: [
      message({
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Add a multiplayer branch.',
        createdAt: '2026-04-03T10:00:00.100Z',
      }),
      message({
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'I added the new branch.',
        createdAt: '2026-04-03T10:00:00.200Z',
      }),
    ],
  });

  assert.deepEqual(
    settled.map((entry) => entry.id),
    ['old-1', 'user-1', 'assistant-1'],
  );
  assert.ok(!settled.some((entry) => entry.id === pending.userId || entry.id === pending.assistantId));
});

test('dropPendingWorkflowCopilotSend removes optimistic placeholders after a failure', () => {
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: 'Add a multiplayer branch.',
  });
  const current = mergeWorkflowCopilotMessages(
    [
      message({
        id: 'old-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'Previous turn',
      }),
    ],
    pending.messages,
  );

  assert.deepEqual(
    dropPendingWorkflowCopilotSend(current, pending).map((entry) => entry.id),
    ['old-1'],
  );
});

test('mergeWorkflowCopilotLiveMessage replaces optimistic placeholders with persisted messages', () => {
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: 'Add a multiplayer branch.',
    at: new Date('2026-04-03T10:00:00.000Z'),
  });
  const current = mergeWorkflowCopilotMessages([], pending.messages);

  const user = mergeWorkflowCopilotLiveMessage(
    current,
    message({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      content: 'Add a multiplayer branch.',
      createdAt: '2026-04-03T10:00:00.100Z',
    }),
  );
  const next = mergeWorkflowCopilotLiveMessage(
    user,
    message({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      rawOutput: 'step 1',
      createdAt: '2026-04-03T10:00:00.200Z',
    }),
  );

  assert.deepEqual(
    next.map((entry) => entry.id),
    ['user-1', 'assistant-1'],
  );
  assert.equal(next[1]?.rawOutput, 'step 1');
});

test('mergeWorkflowCopilotLiveMessage carries streamed thinkingOutput on pending assistant updates', () => {
  // Live progress dispatches of the assistant message include the running
  // reasoning trail. The merger must keep the latest snapshot so the Copilot
  // panel can re-render the live "Thinking…" section without losing context.
  const pending = createPendingWorkflowCopilotSend({
    threadId: 'thread-1',
    content: 'Add a multiplayer branch.',
    at: new Date('2026-04-03T10:00:00.000Z'),
  });
  const seeded = mergeWorkflowCopilotMessages([], pending.messages);
  const afterUser = mergeWorkflowCopilotLiveMessage(
    seeded,
    message({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      content: 'Add a multiplayer branch.',
      createdAt: '2026-04-03T10:00:00.100Z',
    }),
  );

  const firstChunk = mergeWorkflowCopilotLiveMessage(
    afterUser,
    message({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      thinkingOutput: 'thinking step 1',
      createdAt: '2026-04-03T10:00:00.200Z',
    }),
  );

  const secondChunk = mergeWorkflowCopilotLiveMessage(
    firstChunk,
    message({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      thinkingOutput: 'thinking step 1\nthinking step 2',
      createdAt: '2026-04-03T10:00:00.200Z',
    }),
  );

  assert.deepEqual(
    secondChunk.map((entry) => entry.id),
    ['user-1', 'assistant-1'],
  );
  assert.equal(secondChunk[1]?.thinkingOutput, 'thinking step 1\nthinking step 2');
});
