import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenCodePromptParts,
  extractStreamDelta,
  resolveOpenCodeAgent,
} from './opencode-run.js';
import { runAgentStream } from './registry.js';

test('buildOpenCodePromptParts preserves multimodal file parts', () => {
  const parts = buildOpenCodePromptParts(
    [
      { type: 'text', text: 'Describe this screenshot.' },
      {
        type: 'file',
        mime: 'image/png',
        url: 'data:image/png;base64,AAAA',
        filename: 'screen.png',
      },
    ],
    'fallback prompt',
  );

  assert.deepEqual(parts, [
    { type: 'text', text: 'Describe this screenshot.' },
    {
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
      filename: 'screen.png',
    },
  ]);
});

test('runAgentStream rejects multimodal cursor-agent runs', () => {
  assert.throws(
    () =>
      runAgentStream({
        sessionId: 'session-1',
        type: 'cursor_agent',
        runtime: { kind: 'local_process', cwd: '/tmp/demo' },
        role: 'builder',
        workingDirectory: '/tmp/demo',
        promptText: 'Describe this screenshot.',
        parts: [
          { type: 'text', text: 'Describe this screenshot.' },
          {
            type: 'file',
            mime: 'image/png',
            url: 'data:image/png;base64,AAAA',
            filename: 'screen.png',
          },
        ],
        wakeReason: 'manual',
        seedNodeIds: [],
      }),
    /AGENT_ADAPTER_MULTIMODAL_UNSUPPORTED:cursor_agent/,
  );
});

test('resolveOpenCodeAgent uses the built-in builder for workflow copilot', () => {
  assert.equal(resolveOpenCodeAgent('workflow_copilot'), '\u200b\u200b\u200bPrometheus - Plan Builder');
  assert.equal(resolveOpenCodeAgent('builder'), undefined);
});

test('extractStreamDelta routes message.part.delta reasoning parts to the thinking stream', () => {
  // Setting up a synthetic stream that mirrors what opencode emits when the
  // model surfaces a reasoning channel ahead of the final assistant text.
  const sessionId = 'session-1';
  const messageId = 'msg-1';
  const reasoningPartId = 'part-think';
  const textPartId = 'part-reply';
  const textByPartId = new Map<string, string>();
  const reasoningByPartId = new Map<string, string>();
  const partTypeById = new Map<string, string>([
    [reasoningPartId, 'reasoning'],
    [textPartId, 'text'],
  ]);
  const assistantMessageIds = new Set<string>([messageId]);

  const reasoningDelta = extractStreamDelta(
    {
      type: 'message.part.delta',
      properties: {
        sessionID: sessionId,
        field: 'text',
        delta: 'thinking…',
        partID: reasoningPartId,
        messageID: messageId,
      },
    },
    sessionId,
    textByPartId,
    reasoningByPartId,
    assistantMessageIds,
    partTypeById,
  );

  const textDelta = extractStreamDelta(
    {
      type: 'message.part.delta',
      properties: {
        sessionID: sessionId,
        field: 'text',
        delta: 'final answer',
        partID: textPartId,
        messageID: messageId,
      },
    },
    sessionId,
    textByPartId,
    reasoningByPartId,
    assistantMessageIds,
    partTypeById,
  );

  assert.deepEqual(reasoningDelta, { kind: 'reasoning', delta: 'thinking…' });
  assert.deepEqual(textDelta, { kind: 'text', delta: 'final answer' });
  assert.equal(reasoningByPartId.get(reasoningPartId), 'thinking…');
  assert.equal(textByPartId.get(textPartId), 'final answer');
});

test('extractStreamDelta walks reasoning snapshots from message.part.updated', () => {
  // The opencode SDK can also push the reasoning content as a full snapshot
  // on `message.part.updated` (no separate delta event). The extractor must
  // diff against the cache so the consumer only sees the new tail.
  const sessionId = 'session-2';
  const messageId = 'msg-2';
  const partId = 'part-reasoning';
  const textByPartId = new Map<string, string>();
  const reasoningByPartId = new Map<string, string>();
  const partTypeById = new Map<string, string>();
  const assistantMessageIds = new Set<string>([messageId]);

  const first = extractStreamDelta(
    {
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        part: {
          id: partId,
          sessionID: sessionId,
          messageID: messageId,
          type: 'reasoning',
          text: 'step 1',
        },
      },
    },
    sessionId,
    textByPartId,
    reasoningByPartId,
    assistantMessageIds,
    partTypeById,
  );

  const second = extractStreamDelta(
    {
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        part: {
          id: partId,
          sessionID: sessionId,
          messageID: messageId,
          type: 'reasoning',
          text: 'step 1 step 2',
        },
      },
    },
    sessionId,
    textByPartId,
    reasoningByPartId,
    assistantMessageIds,
    partTypeById,
  );

  assert.deepEqual(first, { kind: 'reasoning', delta: 'step 1' });
  assert.deepEqual(second, { kind: 'reasoning', delta: ' step 2' });
  assert.equal(reasoningByPartId.get(partId), 'step 1 step 2');
});
