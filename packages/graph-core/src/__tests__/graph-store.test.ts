import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphSnapshot } from '@cepage/shared-core';
import { createGraphStore } from '../graph-store';

function emptySnapshot(sessionId: string): GraphSnapshot {
  return {
    version: 1,
    id: sessionId,
    createdAt: new Date().toISOString(),
    lastEventId: 0,
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('addNode and addEdge enforce duplicate edge rule', () => {
  const store = createGraphStore({ sessionId: 's1' });
  const human = { type: 'human' as const, userId: 'u1' };
  const a = store.addNode({
    type: 'human_message',
    content: { text: 'hi', format: 'plaintext' },
    creator: human,
    position: { x: 0, y: 0 },
  });
  const b = store.addNode({
    type: 'human_message',
    content: { text: 'ho', format: 'plaintext' },
    creator: human,
    position: { x: 100, y: 0 },
  });
  const idA = a.payload.type === 'node_added' ? a.payload.nodeId : '';
  const idB = b.payload.type === 'node_added' ? b.payload.nodeId : '';
  store.addEdge(
    { source: idA, target: idB, relation: 'references', creator: human },
    {},
  );
  assert.throws(() =>
    store.addEdge(
      { source: idA, target: idB, relation: 'references', creator: human },
      {},
    ),
  );
});

test('removeNode cascades edges', () => {
  const store = createGraphStore({ sessionId: 's2' });
  const human = { type: 'human' as const, userId: 'u1' };
  const a = store.addNode({
    type: 'note',
    content: { text: 'a', format: 'plaintext' },
    creator: human,
    position: { x: 0, y: 0 },
  });
  const b = store.addNode({
    type: 'note',
    content: { text: 'b', format: 'plaintext' },
    creator: human,
    position: { x: 10, y: 10 },
  });
  const idA = a.payload.type === 'node_added' ? a.payload.nodeId : '';
  const idB = b.payload.type === 'node_added' ? b.payload.nodeId : '';
  store.addEdge({ source: idA, target: idB, relation: 'references', creator: human }, {});
  store.removeNode(idA, human);
  assert.equal(store.listEdges().length, 0);
  assert.equal(store.getNode(idB) != null, true);
});

test('replay envelopes from empty snapshot matches sequential mutations', () => {
  const human = { type: 'human' as const, userId: 'u1' };
  const live = createGraphStore({ sessionId: 'replay-1' });

  const e1 = live.addNode({
    type: 'human_message',
    content: { text: 'a', format: 'plaintext' },
    creator: human,
    position: { x: 0, y: 0 },
  });
  const e2 = live.addNode({
    type: 'human_message',
    content: { text: 'b', format: 'plaintext' },
    creator: human,
    position: { x: 40, y: 40 },
  });
  const idA = e1.payload.type === 'node_added' ? e1.payload.nodeId : '';
  const idB = e2.payload.type === 'node_added' ? e2.payload.nodeId : '';
  const e3 = live.addEdge(
    { source: idA, target: idB, relation: 'references', creator: human },
    {},
  );

  const replayed = createGraphStore({ sessionId: 'replay-1' });
  replayed.hydrateFromSnapshot(emptySnapshot('replay-1'));
  replayed.applyEnvelope(e1);
  replayed.applyEnvelope(e2);
  replayed.applyEnvelope(e3);

  assert.equal(replayed.getLastEventId(), live.getLastEventId());
  assert.equal(replayed.listNodes().length, live.listNodes().length);
  assert.equal(replayed.listEdges().length, live.listEdges().length);
  for (const id of [idA, idB]) {
    assert.deepEqual(replayed.getNode(id)?.content, live.getNode(id)?.content);
  }
});

test('hydrate partial snapshot + replay remaining events matches full store', () => {
  const human = { type: 'human' as const, userId: 'u1' };
  const live = createGraphStore({ sessionId: 'replay-2' });
  live.addNode({
    type: 'note',
    content: { text: 'partial', format: 'plaintext' },
    creator: human,
    position: { x: 5, y: 5 },
  });
  const partial = live.toSnapshot();
  const e2 = live.addNode({
    type: 'note',
    content: { text: 'after', format: 'plaintext' },
    creator: human,
    position: { x: 50, y: 50 },
  });

  const catchUp = createGraphStore({ sessionId: 'replay-2' });
  catchUp.hydrateFromSnapshot(partial);
  catchUp.applyEnvelope(e2);

  assert.equal(catchUp.listNodes().length, live.listNodes().length);
  assert.equal(catchUp.getLastEventId(), live.getLastEventId());
});
