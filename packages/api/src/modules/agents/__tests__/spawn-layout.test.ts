import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnEdgeSpecs, getSpawnPositions } from '../spawn-layout';

test('buildSpawnEdgeSpecs adds source to spawn and spawn to output edges', () => {
  assert.deepEqual(
    buildSpawnEdgeSpecs({
      triggerNodeId: 'node-a',
      rootNodeId: 'spawn-1',
      outputNodeId: 'output-1',
    }),
    [
      {
        source: 'node-a',
        target: 'spawn-1',
        relation: 'spawns',
        direction: 'source_to_target',
      },
      {
        source: 'spawn-1',
        target: 'output-1',
        relation: 'produces',
        direction: 'source_to_target',
      },
    ],
  );
});

test('getSpawnPositions anchors new run nodes near the trigger node', () => {
  assert.deepEqual(getSpawnPositions({ x: 120, y: 220 }), {
    spawn: { x: 380, y: 180 },
    output: { x: 580, y: 180 },
    error: { x: 380, y: 380 },
  });
});
