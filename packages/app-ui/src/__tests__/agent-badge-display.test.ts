import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatModelRef } from '@cepage/state';
import { selectAgentBadgeModelDisplay } from '../chat/agent-badge-display.js';

// -----------------------------------------------------------------------------
// `selectAgentBadgeModelDisplay` is the pure decision table behind
// `<AgentBadge>`. The component itself is rendered by React and therefore
// impractical to exercise with node:test; so we lift the branching here.
// Four branches to cover:
//   1. neither model provided         → { kind: 'none' }
//   2. only configured                 → { kind: 'single', model: configured }
//   3. only called                     → { kind: 'single', model: called }
//   4a. both, equal                    → { kind: 'single', model: configured }
//   4b. both, different (fallback)     → { kind: 'mismatch', configured, called }
// -----------------------------------------------------------------------------

const configured: ChatModelRef = { providerId: 'google', modelId: 'gemini-1.5-flash' };
const called: ChatModelRef = { providerId: 'zai-coding-plan', modelId: 'glm-5v-turbo' };

test('selectAgentBadgeModelDisplay returns none when neither is provided', () => {
  assert.deepEqual(selectAgentBadgeModelDisplay(undefined, undefined), { kind: 'none' });
});

test('selectAgentBadgeModelDisplay returns the configured model when it is the only one', () => {
  assert.deepEqual(selectAgentBadgeModelDisplay(configured, undefined), {
    kind: 'single',
    model: configured,
  });
});

test('selectAgentBadgeModelDisplay returns the called model when configured is missing', () => {
  assert.deepEqual(selectAgentBadgeModelDisplay(undefined, called), {
    kind: 'single',
    model: called,
  });
});

test('selectAgentBadgeModelDisplay flattens equal configured+called into a single render', () => {
  // Most common case at the happy path: runtime honored the configured model
  // so we render a single pill. Prevents the UI from flickering into the
  // "fallback" mismatch state when nothing actually fell back.
  assert.deepEqual(selectAgentBadgeModelDisplay(configured, { ...configured }), {
    kind: 'single',
    model: configured,
  });
});

test('selectAgentBadgeModelDisplay flags mismatch when configured and called differ', () => {
  // This is the signal used by the badge to strike-through the configured
  // model and draw the arrow pointing at the effective one.
  const display = selectAgentBadgeModelDisplay(configured, called);
  assert.equal(display.kind, 'mismatch');
  if (display.kind !== 'mismatch') return;
  assert.deepEqual(display.configured, configured);
  assert.deepEqual(display.called, called);
});

test('selectAgentBadgeModelDisplay treats provider-only mismatch as mismatch', () => {
  // A model can stay the same modelId but be served by a different upstream
  // provider (e.g. Kimi migrating between routers); that still counts.
  const a: ChatModelRef = { providerId: 'providerA', modelId: 'same-model' };
  const b: ChatModelRef = { providerId: 'providerB', modelId: 'same-model' };
  const display = selectAgentBadgeModelDisplay(a, b);
  assert.equal(display.kind, 'mismatch');
});
