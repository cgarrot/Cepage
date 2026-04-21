import assert from 'node:assert/strict';
import test from 'node:test';
import type { Branch } from '@cepage/shared-core';
import { readMergeTargets, readSelectedBranch } from '../branch-helpers.js';

const rows: Branch[] = [
  {
    id: 'main',
    name: 'Main',
    color: '#fff',
    createdAt: '2026-04-06T10:00:00.000Z',
    createdBy: { type: 'human', userId: 'user-1' },
    headNodeId: 'node-a',
    nodeIds: ['node-a'],
    status: 'active',
  },
  {
    id: 'feat',
    name: 'Feature',
    color: '#000',
    createdAt: '2026-04-06T11:00:00.000Z',
    createdBy: { type: 'human', userId: 'user-1' },
    headNodeId: 'node-b',
    nodeIds: ['node-a', 'node-b'],
    status: 'active',
  },
  {
    id: 'old',
    name: 'Old',
    color: '#111',
    createdAt: '2026-04-06T12:00:00.000Z',
    createdBy: { type: 'human', userId: 'user-1' },
    headNodeId: 'node-c',
    nodeIds: ['node-c'],
    status: 'abandoned',
  },
];

test('readSelectedBranch returns the chosen branch', () => {
  assert.equal(readSelectedBranch(rows, 'feat')?.name, 'Feature');
  assert.equal(readSelectedBranch(rows, 'missing'), null);
});

test('readMergeTargets excludes the selected and inactive branches', () => {
  assert.deepEqual(
    readMergeTargets(rows, 'feat').map((row) => row.id),
    ['main'],
  );
});
