import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode } from '@cepage/shared-core';
import { canRenderManagedFlowForm } from '../managed-flow-helpers.js';

function node(content: GraphNode['content']): GraphNode {
  return {
    id: 'managed-flow-1',
    type: 'managed_flow',
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z',
    content,
    creator: { type: 'human', userId: 'u1' },
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 240 },
    metadata: {},
    status: 'active',
    branches: [],
  };
}

test('canRenderManagedFlowForm accepts managed flows with legacy copilot aliases', () => {
  assert.equal(
    canRenderManagedFlowForm(
      node({
        label: 'Main flow',
        steps: [
          {
            id: 'dev',
            kind: 'loop',
            loopNodeId: 'dev-loop',
          },
        ],
      }),
    ),
    true,
  );
});
