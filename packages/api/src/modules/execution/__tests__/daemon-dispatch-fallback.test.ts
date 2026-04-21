import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRunJobPayload } from '../execution-job-payload.js';
import {
  buildFallbackActivityEvent,
  shouldRetryWithNextModel,
} from '../daemon/daemon-dispatch.service.js';

function buildPayload(over: Partial<AgentRunJobPayload> = {}): AgentRunJobPayload {
  return {
    mode: 'execution',
    sessionId: 'sess-1',
    runId: 'run-1',
    executionId: 'exec-1',
    rootNodeId: 'node-1',
    type: 'opencode',
    model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    seedNodeIds: ['node-1'],
    role: 'default',
    wakeReason: 'manual',
    startedAtIso: '2026-04-21T10:00:00.000Z',
    cwd: '/tmp/sess-1',
    promptText: '',
    parts: [],
    ...over,
  };
}

test('shouldRetryWithNextModel returns false when chain is missing', () => {
  const payload = buildPayload();
  assert.equal(shouldRetryWithNextModel(payload, 'upstream 503'), false);
});

test('shouldRetryWithNextModel returns false when the chain has no next entry', () => {
  const payload = buildPayload({
    fallbackChain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    ],
    fallbackIndex: 0,
  });
  assert.equal(shouldRetryWithNextModel(payload, 'upstream 503'), false);
});

test('shouldRetryWithNextModel returns true on a retryable error with a next entry', () => {
  const payload = buildPayload({
    fallbackChain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    fallbackIndex: 0,
  });
  assert.equal(shouldRetryWithNextModel(payload, 'HTTP 503 service unavailable'), true);
  assert.equal(shouldRetryWithNextModel(payload, 'ECONNRESET: socket hang up'), true);
  assert.equal(shouldRetryWithNextModel(payload, 'provider rate_limit_exceeded'), true);
});

test('shouldRetryWithNextModel is false for cancellation-like errors', () => {
  const payload = buildPayload({
    fallbackChain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    fallbackIndex: 0,
  });
  assert.equal(shouldRetryWithNextModel(payload, 'cancelled by user'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'AbortError'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'RUN_CANCELLED'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'the task was aborted'), false);
});

test('shouldRetryWithNextModel is false for auth-class errors (same creds will fail the next model too)', () => {
  const payload = buildPayload({
    fallbackChain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    fallbackIndex: 0,
  });
  assert.equal(shouldRetryWithNextModel(payload, 'HTTP 401 unauthorized'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'forbidden: 403'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'invalid_api_key supplied'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'authentication failed'), false);
});

test('shouldRetryWithNextModel is false for schema validation errors', () => {
  const payload = buildPayload({
    fallbackChain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    fallbackIndex: 0,
  });
  assert.equal(shouldRetryWithNextModel(payload, 'ZodError: expected object'), false);
  assert.equal(shouldRetryWithNextModel(payload, 'schema validation failed on input'), false);
});

test('shouldRetryWithNextModel advances along the chain as fallbackIndex grows', () => {
  const chain = [
    { agentType: 'opencode' as const, providerID: 'p-0', modelID: 'm-0' },
    { agentType: 'opencode' as const, providerID: 'p-1', modelID: 'm-1' },
    { agentType: 'opencode' as const, providerID: 'p-2', modelID: 'm-2' },
  ];
  assert.equal(shouldRetryWithNextModel(buildPayload({ fallbackChain: chain, fallbackIndex: 0 }), '503'), true);
  assert.equal(shouldRetryWithNextModel(buildPayload({ fallbackChain: chain, fallbackIndex: 1 }), '503'), true);
  assert.equal(shouldRetryWithNextModel(buildPayload({ fallbackChain: chain, fallbackIndex: 2 }), '503'), false);
});

// -----------------------------------------------------------------------------
// buildFallbackActivityEvent: the activity.log payload emitted when a sibling
// fallback run is spawned. The UI consumes `summaryKey` +
// `summaryParams` to render the i18n-localized fallback line, and
// `metadata.kind` + `runId` to link the event back to the failed run within
// the unified execution block. These tests lock that contract down.
// -----------------------------------------------------------------------------

test('buildFallbackActivityEvent tags the activity log with summaryKey=agent_fallback_switch', () => {
  const failedPayload = buildPayload({
    model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
    ownerNodeId: 'node-123',
  });
  const event = buildFallbackActivityEvent({
    failedPayload,
    error: 'HTTP 503 service unavailable',
    nextEntry: { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' },
    nextIndex: 1,
    chainLength: 3,
    newRunId: 'new-run-42',
  });
  assert.equal(event.summaryKey, 'activity.agent_fallback_switch');
  assert.equal(event.actorType, 'agent');
  // The event is anchored on the FAILED run so siblings group correctly in
  // the UI execution block.
  assert.equal(event.runId, failedPayload.runId);
  assert.equal(event.actorId, failedPayload.runId);
  assert.equal(event.sessionId, failedPayload.sessionId);
});

test('buildFallbackActivityEvent packs from/to/reason into summaryParams', () => {
  const failedPayload = buildPayload({
    model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
  });
  const event = buildFallbackActivityEvent({
    failedPayload,
    error: 'HTTP 503 service unavailable',
    nextEntry: { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' },
    nextIndex: 1,
    chainLength: 3,
    newRunId: 'new-run-42',
  });
  assert.deepEqual(event.summaryParams, {
    fromProvider: 'google',
    fromModel: 'gemini-1.5-flash',
    toProvider: 'zai-coding-plan',
    toModel: 'glm-5v-turbo',
    reason: 'HTTP 503 service unavailable',
  });
  // Human-readable summary still includes both ends + reason for legacy
  // timelines that can't consume summaryKey.
  assert.ok(event.summary.includes('google/gemini-1.5-flash'));
  assert.ok(event.summary.includes('zai-coding-plan/glm-5v-turbo'));
  assert.ok(event.summary.includes('HTTP 503 service unavailable'));
});

test('buildFallbackActivityEvent carries metadata.kind + nextRunId + chain position', () => {
  const event = buildFallbackActivityEvent({
    failedPayload: buildPayload(),
    error: '503',
    nextEntry: { agentType: 'opencode', providerID: 'p', modelID: 'm' },
    nextIndex: 1,
    chainLength: 3,
    newRunId: 'new-run-42',
  });
  assert.deepEqual(event.metadata, {
    kind: 'agent_fallback_switch',
    nextRunId: 'new-run-42',
    fallbackIndex: 1,
    fallbackChainLength: 3,
  });
});

test('buildFallbackActivityEvent falls back to "?" markers when the failed payload has no model', () => {
  // Preflight swap paths can submit a job without an explicit `model` (the
  // daemon derives it from fallbackChain[0]). If such a job still somehow
  // needs a fallback log we don't want the UI to render `undefined/undefined`.
  const failedPayload = buildPayload();
  delete failedPayload.model;
  const event = buildFallbackActivityEvent({
    failedPayload,
    error: '503',
    nextEntry: { agentType: 'opencode', providerID: 'p', modelID: 'm' },
    nextIndex: 1,
    chainLength: 2,
    newRunId: 'new-run-42',
  });
  assert.equal(event.summaryParams.fromProvider, '?');
  assert.equal(event.summaryParams.fromModel, '?');
});

test('buildFallbackActivityEvent threads ownerNodeId into relatedNodeIds', () => {
  const withNode = buildFallbackActivityEvent({
    failedPayload: buildPayload({ ownerNodeId: 'spawn-1' }),
    error: '503',
    nextEntry: { agentType: 'opencode', providerID: 'p', modelID: 'm' },
    nextIndex: 1,
    chainLength: 2,
    newRunId: 'new-run-42',
  });
  assert.deepEqual(withNode.relatedNodeIds, ['spawn-1']);
  const withoutNode = buildFallbackActivityEvent({
    failedPayload: buildPayload(),
    error: '503',
    nextEntry: { agentType: 'opencode', providerID: 'p', modelID: 'm' },
    nextIndex: 1,
    chainLength: 2,
    newRunId: 'new-run-42',
  });
  assert.deepEqual(withoutNode.relatedNodeIds, []);
});
