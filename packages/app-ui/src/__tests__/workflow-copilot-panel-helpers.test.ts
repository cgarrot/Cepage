import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRestoreCheckpointConfirm } from '../workflow-copilot-panel-helpers.js';

test('buildRestoreCheckpointConfirm uses the shortened checkpoint id', () => {
  const calls: Array<{ key: string; params?: Record<string, string | number> }> = [];
  const msg = buildRestoreCheckpointConfirm((key, params) => {
    calls.push({ key, params });
    return `${key}:${String(params?.id ?? '')}`;
  }, 'checkpoint-1234567890');

  assert.equal(msg, 'ui.sidebar.copilotRestoreConfirm:checkpoi');
  assert.deepEqual(calls, [
    {
      key: 'ui.sidebar.copilotRestoreConfirm',
      params: { id: 'checkpoi' },
    },
  ]);
});
