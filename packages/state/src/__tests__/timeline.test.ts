import assert from 'node:assert/strict';
import test from 'node:test';
import type { TimelineEntry } from '@cepage/shared-core';
import { mergeTimelineHead, mergeTimelinePage } from '../timeline.js';

function row(id: string, ts: string): TimelineEntry {
  return {
    id,
    timestamp: ts,
    actorType: 'human',
    actorId: 'user-1',
    summary: id,
  };
}

test('mergeTimelineHead prepends and de-duplicates recent activity', () => {
  const rows = [row('a', '2026-04-06T10:00:00.000Z'), row('b', '2026-04-06T09:00:00.000Z')];
  const next = mergeTimelineHead(rows, row('b', '2026-04-06T11:00:00.000Z'), 3);
  assert.deepEqual(
    next.map((entry) => entry.id),
    ['b', 'a'],
  );
  assert.equal(next[0].timestamp, '2026-04-06T11:00:00.000Z');
});

test('mergeTimelinePage appends older pages without duplicates', () => {
  const rows = [row('a', '2026-04-06T10:00:00.000Z'), row('b', '2026-04-06T09:00:00.000Z')];
  const next = mergeTimelinePage(rows, [
    row('b', '2026-04-06T09:00:00.000Z'),
    row('c', '2026-04-06T08:00:00.000Z'),
  ]);
  assert.deepEqual(
    next.map((entry) => entry.id),
    ['a', 'b', 'c'],
  );
});
