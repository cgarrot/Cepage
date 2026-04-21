import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNodeContent } from '../workflow-copilot-normalize.js';

test('normalizeNodeContent preserves a top-level fallbackTag on a legacy agent_step payload', () => {
  const refs = new Map<string, string>();
  const out = normalizeNodeContent(
    'agent_step',
    {
      title: 'Plan',
      agentType: 'opencode',
      model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      fallbackTag: 'complex',
    },
    'opencode',
    refs,
    'session-1',
    new Map(),
  );
  const content = out.content as Record<string, unknown>;
  assert.equal(content.fallbackTag, 'complex');
  assert.equal(content.agentType, 'opencode');
  assert.deepEqual(content.model, { providerID: 'opencode-go', modelID: 'kimi-k2.6' });
});

test('normalizeNodeContent preserves a fallbackTag nested inside agentSelection.selection', () => {
  const refs = new Map<string, string>();
  const out = normalizeNodeContent(
    'agent_step',
    {
      title: 'Plan',
      agentSelection: {
        mode: 'locked',
        selection: {
          type: 'opencode',
          model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
          fallbackTag: 'visual',
        },
      },
    },
    'opencode',
    refs,
    'session-1',
    new Map(),
  );
  const content = out.content as Record<string, unknown>;
  assert.equal(content.fallbackTag, 'visual');
  assert.equal(content.agentType, 'opencode');
});

test('normalizeNodeContent drops fallbackTag when omitted', () => {
  const refs = new Map<string, string>();
  const out = normalizeNodeContent(
    'agent_step',
    {
      title: 'Plan',
      agentType: 'opencode',
      model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    },
    'opencode',
    refs,
    'session-1',
    new Map(),
  );
  const content = out.content as Record<string, unknown>;
  assert.equal(content.fallbackTag, undefined);
  assert.equal(content.agentType, 'opencode');
});
