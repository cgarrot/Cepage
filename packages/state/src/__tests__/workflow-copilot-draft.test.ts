import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkflowCopilotDraftKey,
  readWorkflowCopilotDraft,
  writeWorkflowCopilotDraft,
} from '../workflow-copilot-draft.js';

test('buildWorkflowCopilotDraftKey scopes drafts by session and target surface', () => {
  assert.equal(
    buildWorkflowCopilotDraftKey({
      sessionId: 'session-1',
      surface: 'sidebar',
    }),
    'session-1:sidebar',
  );
  assert.equal(
    buildWorkflowCopilotDraftKey({
      sessionId: 'session-1',
      surface: 'node',
      ownerNodeId: 'node-42',
    }),
    'session-1:node:node-42',
  );
  assert.equal(
    buildWorkflowCopilotDraftKey({
      sessionId: 'session-1',
      surface: 'node',
    }),
    null,
  );
});

test('writeWorkflowCopilotDraft stores, reads, and clears a draft immutably', () => {
  const key = 'session-1:sidebar';
  const first = writeWorkflowCopilotDraft({}, key, 'Draft en cours');

  assert.deepEqual(first, { [key]: 'Draft en cours' });
  assert.equal(readWorkflowCopilotDraft(first, key), 'Draft en cours');

  const second = writeWorkflowCopilotDraft(first, key, '');
  assert.deepEqual(second, {});
  assert.equal(readWorkflowCopilotDraft(second, key), '');
});
