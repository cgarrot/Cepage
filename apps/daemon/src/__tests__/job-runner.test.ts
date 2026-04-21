import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentAdapterEvent } from '@cepage/agent-core';
import type { DaemonMessage } from '@cepage/shared-core';
import { EventBatcher } from '../event-batcher.js';
import { adapterEventToMessage } from '../job-runner.js';

test('adapterEventToMessage maps thinking events into DaemonMessage thinking payloads', () => {
  const event: AgentAdapterEvent = { type: 'thinking', chunk: 'reasoning chunk' };

  const message = adapterEventToMessage(event);

  assert.ok(message, 'thinking events must round-trip into a DaemonMessage');
  assert.equal(message?.type, 'thinking');
  assert.deepEqual(message?.payload, { chunk: 'reasoning chunk' });
  assert.match(
    message?.eventAt ?? '',
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    'eventAt should be an ISO timestamp',
  );
});

test('EventBatcher buffers thinking and stdout messages together within the same flush window', async () => {
  // We exercise the batcher with the same 500ms-style throttling the daemon
  // uses for `agent_run`. Mixing thinking + stdout proves the new event type
  // shares the existing flush pipeline rather than falling through cracks.
  const flushed: DaemonMessage[][] = [];
  const batcher = new EventBatcher({
    flushIntervalMs: 20,
    maxBatchSize: 16,
    flush: async (messages) => {
      flushed.push(messages);
    },
  });

  const stdoutEvent: AgentAdapterEvent = { type: 'stdout', chunk: 'out-1' };
  const thinkingEvent: AgentAdapterEvent = { type: 'thinking', chunk: 'think-1' };
  const moreThinking: AgentAdapterEvent = { type: 'thinking', chunk: 'think-2' };

  for (const event of [stdoutEvent, thinkingEvent, moreThinking]) {
    const message = adapterEventToMessage(event);
    if (message) batcher.push(message);
  }

  await batcher.close();

  const all = flushed.flat();
  assert.equal(all.length, 3, 'every event should be flushed');
  assert.deepEqual(
    all.map((message) => message.type),
    ['stdout', 'thinking', 'thinking'],
    'order should be preserved across thinking + stdout',
  );
  assert.deepEqual(
    all.map((message) => message.payload),
    [{ chunk: 'out-1' }, { chunk: 'think-1' }, { chunk: 'think-2' }],
  );
});
