import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ChatTimelineAgentOutput,
  ChatTimelineAgentStep,
  ChatTimelineCopilotCheckpoint,
  ChatTimelineCopilotMessage,
  ChatTimelineExecution,
  ChatTimelineItem,
} from '@cepage/state';
import { groupTimelineForRender } from '../chat/groupTimeline.js';

// -----------------------------------------------------------------------------
// `groupTimelineForRender` is the last-mile folder that turns the ordered
// timeline into render-ready groups:
//  - orphan rows stay standalone
//  - agent_output stays attached to the preceding agent_step
//  - when an execution is present, its sibling runs' outputs fold into the
//    execution's streaming pane instead of forming a separate block
// Covering those branches keeps the live-execution UI coherent.
// -----------------------------------------------------------------------------

function agentStep(input: {
  id: string;
  createdAt?: string;
}): ChatTimelineAgentStep {
  return {
    kind: 'agent_step',
    id: input.id,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    actor: { kind: 'agent', agentType: 'opencode', agentId: 'a1' },
    label: 'Plan',
    brief: '',
    node: {} as never,
  };
}

function agentOutput(input: {
  id: string;
  agentRunId?: string;
  agentId?: string;
  text?: string;
  createdAt?: string;
}): ChatTimelineAgentOutput {
  return {
    kind: 'agent_output',
    id: input.id,
    createdAt: input.createdAt ?? '2026-04-07T10:00:01.000Z',
    actor: {
      kind: 'agent',
      agentType: 'opencode',
      agentId: input.agentId ?? 'a1',
    },
    agentRunId: input.agentRunId,
    text: input.text ?? '',
    stream: 'stdout',
    isStreaming: false,
    node: {} as never,
  };
}

function execution(input: {
  id: string;
  createdAt?: string;
  siblingRunIds: readonly string[];
  output?: string;
}): ChatTimelineExecution {
  return {
    kind: 'execution',
    id: input.id,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    actor: { kind: 'agent', agentType: 'opencode', agentId: 'a1' },
    agentType: 'opencode',
    status: 'running',
    isStreaming: true,
    output: input.output ?? '',
    siblings: input.siblingRunIds.map((runId, index) => ({
      runId,
      status: 'completed',
      isPrimary: index === 0,
    })),
    steps: [],
    fallbackEvents: [],
    currentRunId: input.siblingRunIds[0] ?? '',
  } as unknown as ChatTimelineExecution;
}

test('groupTimelineForRender folds outputs under the preceding agent_step', () => {
  const timeline: ChatTimelineItem[] = [
    agentStep({ id: 'step-1' }),
    agentOutput({ id: 'out-1', text: 'hello' }),
    agentOutput({ id: 'out-2', text: 'world' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.kind, 'agent_step_with_outputs');
  if (grouped[0]!.kind !== 'agent_step_with_outputs') return;
  assert.equal(grouped[0]!.outputs.length, 2);
});

test('groupTimelineForRender produces execution_with_stream and folds sibling outputs into it', () => {
  const exec = execution({
    id: 'exec-1',
    siblingRunIds: ['run-1', 'run-2'],
    output: 'seeded chunk',
  });
  const timeline: ChatTimelineItem[] = [
    exec,
    agentOutput({ id: 'out-1', agentRunId: 'run-1', text: 'first' }),
    agentOutput({ id: 'out-2', agentRunId: 'run-2', text: 'second' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  // Exactly one group is emitted: the two outputs were folded into the exec.
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.kind, 'execution_with_stream');
  if (grouped[0]!.kind !== 'execution_with_stream') return;
  assert.equal(grouped[0]!.outputs.length, 2);
  // The streamingOutput starts with the seed and appends each chunk on its own
  // line — this matches what the live panel renders to the user.
  assert.equal(grouped[0]!.streamingOutput, 'seeded chunk\nfirst\nsecond');
});

test('groupTimelineForRender ignores empty output chunks when composing streamingOutput', () => {
  const exec = execution({
    id: 'exec-1',
    siblingRunIds: ['run-1'],
  });
  const timeline: ChatTimelineItem[] = [
    exec,
    agentOutput({ id: 'out-1', agentRunId: 'run-1', text: '   ' }),
    agentOutput({ id: 'out-2', agentRunId: 'run-1', text: 'real chunk' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped[0]!.kind, 'execution_with_stream');
  if (grouped[0]!.kind !== 'execution_with_stream') return;
  // Whitespace-only chunks are dropped to avoid `"\n"` padding in the log.
  assert.equal(grouped[0]!.streamingOutput, 'real chunk');
  // But they are still counted as outputs (the raw chunks are preserved so
  // the streaming panel's counters stay accurate).
  assert.equal(grouped[0]!.outputs.length, 2);
});

test('groupTimelineForRender falls back to agent_step folding when output runId is not part of any execution', () => {
  // When grouping sees an execution for run-1 but an output for run-orphan,
  // the output must not be injected into the execution stream — it should
  // attach to the preceding step instead.
  const exec = execution({ id: 'exec-1', siblingRunIds: ['run-1'] });
  const step = agentStep({ id: 'step-1' });
  const timeline: ChatTimelineItem[] = [
    exec,
    step,
    agentOutput({ id: 'out-1', agentRunId: 'run-orphan', text: 'orphan' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]!.kind, 'execution_with_stream');
  assert.equal(grouped[1]!.kind, 'agent_step_with_outputs');
  if (grouped[0]!.kind !== 'execution_with_stream') return;
  if (grouped[1]!.kind !== 'agent_step_with_outputs') return;
  assert.equal(grouped[0]!.outputs.length, 0);
  assert.equal(grouped[1]!.outputs.length, 1);
});

test('groupTimelineForRender emits a standalone output when no container is available', () => {
  const timeline: ChatTimelineItem[] = [
    agentOutput({ id: 'out-1', text: 'solo' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.kind, 'standalone');
});

// ---------------------------------------------------------------------------
// Cursor-style checkpoint folding: a `copilot_checkpoint` whose
// `forUserMessageId` matches a preceding user `copilot_message` must collapse
// into that message group so the UI renders a single block with an inline
// Restore pill, instead of a separate strip between the user and assistant
// turns. Orphan checkpoints (no match) keep their standalone rendering so no
// information is lost.
// ---------------------------------------------------------------------------

function copilotUserMessage(input: {
  id: string;
  createdAt?: string;
}): ChatTimelineCopilotMessage {
  return {
    kind: 'copilot_message',
    id: `copilot:${input.id}`,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    role: 'user',
    status: 'completed',
    text: 'hello',
    summary: [],
    warnings: [],
    attachments: [],
    opCount: 0,
    message: {
      id: input.id,
      role: 'user',
      status: 'completed',
      content: 'hello',
      createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
      updatedAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    } as unknown as ChatTimelineCopilotMessage['message'],
  };
}

function copilotCheckpoint(input: {
  id: string;
  forUserMessageId?: string;
  createdAt?: string;
  restoredAt?: string;
}): ChatTimelineCopilotCheckpoint {
  const ckpt: ChatTimelineCopilotCheckpoint = {
    kind: 'copilot_checkpoint',
    id: `copilot:checkpoint:${input.id}`,
    createdAt: input.createdAt ?? '2026-04-07T10:00:05.000Z',
    summary: ['op-a', 'op-b'],
    checkpoint: {
      id: input.id,
      sessionId: 's1',
      threadId: 't1',
      messageId: 'asst-1',
      summary: ['op-a', 'op-b'],
      createdAt: input.createdAt ?? '2026-04-07T10:00:05.000Z',
    } as unknown as ChatTimelineCopilotCheckpoint['checkpoint'],
  };
  if (input.forUserMessageId) ckpt.forUserMessageId = input.forUserMessageId;
  if (input.restoredAt) ckpt.restoredAt = input.restoredAt;
  return ckpt;
}

test('groupTimelineForRender folds a checkpoint onto its user copilot_message', () => {
  const timeline: ChatTimelineItem[] = [
    copilotUserMessage({ id: 'm-user' }),
    copilotCheckpoint({ id: 'c-1', forUserMessageId: 'm-user' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 1, 'checkpoint should not form a separate group');
  assert.equal(grouped[0]!.kind, 'standalone');
  if (grouped[0]!.kind !== 'standalone') return;
  assert.equal(grouped[0]!.item.kind, 'copilot_message');
  assert.ok(grouped[0]!.checkpoint, 'checkpoint must be attached to the group');
  assert.equal(grouped[0]!.checkpoint!.checkpoint.id, 'c-1');
});

test('groupTimelineForRender keeps an orphan checkpoint as a standalone block', () => {
  // No matching user message: the selector still emits the checkpoint, and
  // the grouper must not drop it — we fall back to the legacy standalone
  // rendering so the user can still restore.
  const timeline: ChatTimelineItem[] = [
    copilotCheckpoint({ id: 'c-orphan', forUserMessageId: 'does-not-exist' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.kind, 'standalone');
  if (grouped[0]!.kind !== 'standalone') return;
  assert.equal(grouped[0]!.item.kind, 'copilot_checkpoint');
  // Orphan doesn't use the `checkpoint` companion field — it IS the item.
  assert.equal(grouped[0]!.checkpoint, undefined);
});

test('groupTimelineForRender only folds the first checkpoint per user message', () => {
  // Defensive: if ever two checkpoints land on the same message, the second
  // one must still render standalone — swallowing it would hide state.
  const timeline: ChatTimelineItem[] = [
    copilotUserMessage({ id: 'm-user' }),
    copilotCheckpoint({ id: 'c-1', forUserMessageId: 'm-user' }),
    copilotCheckpoint({ id: 'c-2', forUserMessageId: 'm-user' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]!.kind, 'standalone');
  assert.equal(grouped[1]!.kind, 'standalone');
  if (grouped[0]!.kind !== 'standalone' || grouped[1]!.kind !== 'standalone') return;
  assert.equal(grouped[0]!.checkpoint?.checkpoint.id, 'c-1');
  assert.equal(grouped[1]!.item.kind, 'copilot_checkpoint');
});

test('groupTimelineForRender does not fold a checkpoint onto a later user message', () => {
  // Ordering: the selector sorts by createdAt and places checkpoints right
  // after their user message. A checkpoint arriving *before* a user message
  // with the same id (should never happen, but belt-and-suspenders) must
  // fall through to the orphan path so we don't mis-associate.
  const timeline: ChatTimelineItem[] = [
    copilotCheckpoint({
      id: 'c-1',
      forUserMessageId: 'm-user',
      createdAt: '2026-04-07T09:59:59.000Z',
    }),
    copilotUserMessage({ id: 'm-user', createdAt: '2026-04-07T10:00:00.000Z' }),
  ];
  const grouped = groupTimelineForRender(timeline);
  assert.equal(grouped.length, 2);
  // First group is the orphan checkpoint (standalone item).
  if (grouped[0]!.kind !== 'standalone') return assert.fail('expected standalone');
  assert.equal(grouped[0]!.item.kind, 'copilot_checkpoint');
  // Second group is the user message, with no folded checkpoint.
  if (grouped[1]!.kind !== 'standalone') return assert.fail('expected standalone');
  assert.equal(grouped[1]!.item.kind, 'copilot_message');
  assert.equal(grouped[1]!.checkpoint, undefined);
});
