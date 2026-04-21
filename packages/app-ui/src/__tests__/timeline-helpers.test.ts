import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityLine } from '@cepage/state';
import { filterTimeline, readTimelineNode, readTimelineRuns } from '../timeline-helpers.js';

const rows: ActivityLine[] = [
  {
    id: 'a',
    timestamp: '2026-04-06T10:00:00.000Z',
    actorType: 'human',
    actorId: 'user-1',
    summary: 'Created node',
    relatedNodeIds: ['node-a'],
  },
  {
    id: 'b',
    timestamp: '2026-04-06T09:00:00.000Z',
    actorType: 'agent',
    actorId: 'agent-1',
    runId: 'run-1',
    summary: 'Run completed',
  },
];

test('filterTimeline narrows by actor and run id', () => {
  assert.deepEqual(
    filterTimeline(rows, 'agent', 'run-1').map((row) => row.id),
    ['b'],
  );
});

test('readTimelineRuns returns unique run ids', () => {
  assert.deepEqual(readTimelineRuns(rows), ['run-1']);
});

test('readTimelineNode picks the first related node id', () => {
  assert.equal(readTimelineNode(rows[0]), 'node-a');
  assert.equal(readTimelineNode(rows[1]), null);
});
