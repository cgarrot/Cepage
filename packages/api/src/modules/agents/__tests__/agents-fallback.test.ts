import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCatalog } from '@cepage/shared-core';
import { AgentsService } from '../agents.service.js';
import type { AgentRunFallbackEntry } from '../../execution/execution-job-payload.js';

type FallbackEntry = AgentRunFallbackEntry;

function sampleCatalog(input: {
  primaryReady?: boolean;
  secondaryReady?: boolean;
  secondaryModels?: Array<{ providerID: string; modelID: string; label: string }>;
}): AgentCatalog {
  const { primaryReady = true, secondaryReady = true, secondaryModels } = input;
  return {
    providers: [
      {
        agentType: 'opencode',
        providerID: 'opencode-go',
        label: 'OpenCode go',
        availability: primaryReady ? 'ready' : 'unavailable',
        models: [{ providerID: 'opencode-go', modelID: 'kimi-k2.6', label: 'kimi' }],
      },
      {
        agentType: 'opencode',
        providerID: 'zai-coding-plan',
        label: 'ZAI',
        availability: secondaryReady ? 'ready' : 'unavailable',
        models: secondaryModels ?? [
          { providerID: 'zai-coding-plan', modelID: 'glm-5.1', label: 'glm' },
        ],
      },
    ],
    fetchedAt: '2026-04-21T10:00:00.000Z',
  };
}

function buildService(input: {
  chain: FallbackEntry[];
  catalog: AgentCatalog | null;
}): AgentsService {
  const policy = {
    async resolveFallbackChain(): Promise<FallbackEntry[]> {
      return input.chain;
    },
  };
  const daemonRegistry = {
    async getMergedCatalog(): Promise<AgentCatalog | null> {
      return input.catalog;
    },
  };
  const svc = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    daemonRegistry as never,
    policy as never,
  );
  return svc;
}

test('resolveRunFallback returns empty chain and no model when the caller has no primary model', async () => {
  const svc = buildService({
    chain: [],
    catalog: sampleCatalog({ primaryReady: true }),
  });
  const result = await svc.resolveRunFallback({ agentType: 'opencode' });
  assert.deepEqual(result, { selected: undefined, chain: [], index: 0 });
});

test('resolveRunFallback keeps the primary when the merged catalog says it is ready', async () => {
  const svc = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    catalog: sampleCatalog({ primaryReady: true, secondaryReady: true }),
  });
  const result = await svc.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    fallbackTag: 'complex',
  });
  assert.equal(result.index, 0);
  assert.deepEqual(result.selected, { providerID: 'opencode-go', modelID: 'kimi-k2.6' });
  assert.equal(result.chain.length, 2);
});

test('resolveRunFallback swaps to the next live binding when the primary provider is unavailable', async () => {
  const svc = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    catalog: sampleCatalog({ primaryReady: false, secondaryReady: true }),
  });
  const result = await svc.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    fallbackTag: 'complex',
  });
  assert.equal(result.index, 1);
  assert.deepEqual(result.selected, { providerID: 'zai-coding-plan', modelID: 'glm-5.1' });
});

test('resolveRunFallback falls back when the primary modelID is missing from an otherwise-ready provider', async () => {
  const svc = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    ],
    catalog: sampleCatalog({
      primaryReady: true,
      secondaryReady: true,
      // ZAI advertises a different model than the one we asked for — treat as unavailable.
      secondaryModels: [{ providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo', label: 'glm visual' }],
    }),
  });
  const result = await svc.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    fallbackTag: 'complex',
  });
  assert.equal(result.index, 1);
  assert.deepEqual(result.selected, { providerID: 'opencode-go', modelID: 'kimi-k2.6' });
});

test('resolveRunFallback keeps the primary when nothing in the chain is live', async () => {
  const svc = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    catalog: sampleCatalog({ primaryReady: false, secondaryReady: false }),
  });
  const result = await svc.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    fallbackTag: 'complex',
  });
  assert.equal(result.index, 0);
  assert.deepEqual(result.selected, { providerID: 'opencode-go', modelID: 'kimi-k2.6' });
  assert.equal(result.chain.length, 2);
});

test('resolveRunFallback handles the aggregated catalog shape (one provider per agentType, mixed models)', async () => {
  // Real daemon shape: a single top-level provider per agentType aggregates
  // upstream-provider models via per-model providerID. Before the isBindingLive
  // fix, primary==binding.providerID was compared against provider.providerID
  // ('opencode'), so every binding looked "unavailable" and preflight never
  // swapped even when the upstream model was advertised.
  const aggregatedCatalog: AgentCatalog = {
    providers: [
      {
        agentType: 'opencode',
        providerID: 'opencode',
        label: 'OpenCode',
        availability: 'ready',
        models: [
          { providerID: 'google', modelID: 'gemini-1.5-flash', label: 'g15f' },
          { providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo', label: 'glm-v' },
          { providerID: 'ollama-cloud', modelID: 'gemini-3-flash-preview', label: 'g3fp' },
        ],
      },
    ],
    fetchedAt: '2026-04-21T10:00:00.000Z',
  };
  const svcWithLivePrimary = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'google', modelID: 'gemini-1.5-flash' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' },
      { agentType: 'opencode', providerID: 'ollama-cloud', modelID: 'gemini-3-flash-preview' },
    ],
    catalog: aggregatedCatalog,
  });
  const livePrimary = await svcWithLivePrimary.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
    fallbackTag: 'visual',
  });
  assert.equal(livePrimary.index, 0);
  assert.deepEqual(livePrimary.selected, { providerID: 'google', modelID: 'gemini-1.5-flash' });

  // Primary is NOT advertised inside the aggregator (different modelID). The
  // aggregated-shape lookup must still detect it's missing and swap to the
  // first live chain entry instead of keeping the absent primary.
  const svcWithMissingPrimary = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'google', modelID: 'gemini-9001-ultra' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' },
    ],
    catalog: aggregatedCatalog,
  });
  const missingPrimary = await svcWithMissingPrimary.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'google', modelID: 'gemini-9001-ultra' },
    fallbackTag: 'visual',
  });
  assert.equal(missingPrimary.index, 1);
  assert.deepEqual(missingPrimary.selected, { providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo' });
});

test('resolveRunFallback keeps the primary when the daemon has published no catalog yet', async () => {
  const svc = buildService({
    chain: [
      { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
      { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    ],
    catalog: null,
  });
  const result = await svc.resolveRunFallback({
    agentType: 'opencode',
    model: { providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    fallbackTag: 'complex',
  });
  assert.equal(result.index, 0);
  assert.deepEqual(result.selected, { providerID: 'opencode-go', modelID: 'kimi-k2.6' });
});
