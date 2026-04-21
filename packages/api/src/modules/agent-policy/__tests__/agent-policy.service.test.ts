import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCatalog, AgentPolicyEntry } from '@cepage/shared-core';
import { AgentPolicyService } from '../agent-policy.service.js';

interface FakePolicyRow {
  id: string;
  level: 'agentType' | 'provider' | 'model';
  agentType: string | null;
  providerID: string | null;
  modelID: string | null;
  hint: string;
  tags: string[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeSettingsRow {
  id: string;
  defaultAgentType: string | null;
  defaultProviderID: string | null;
  defaultModelID: string | null;
  updatedAt: Date;
}

function makeFakePrisma(seed?: {
  policies?: FakePolicyRow[];
  settings?: FakeSettingsRow | null;
}) {
  const state = {
    policies: [...(seed?.policies ?? [])],
    settings: seed?.settings ?? null,
  };

  const agentPolicy = {
    async findMany(args?: {
      where?: { level?: string; agentType?: string };
      orderBy?: unknown;
    }): Promise<FakePolicyRow[]> {
      let rows = [...state.policies];
      if (args?.where?.level) rows = rows.filter((r) => r.level === args.where!.level);
      if (args?.where?.agentType) rows = rows.filter((r) => r.agentType === args.where!.agentType);
      const orderBy = args?.orderBy;
      const ordered = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
      if (ordered.length > 0) {
        rows.sort((a, b) => {
          for (const clause of ordered as Array<Record<string, 'asc' | 'desc'>>) {
            for (const [key, dir] of Object.entries(clause)) {
              const av = (a as unknown as Record<string, unknown>)[key];
              const bv = (b as unknown as Record<string, unknown>)[key];
              const sign = dir === 'desc' ? -1 : 1;
              if (typeof av === 'number' && typeof bv === 'number') {
                if (av !== bv) return (av - bv) * sign;
              } else if (typeof av === 'string' && typeof bv === 'string') {
                if (av !== bv) return av.localeCompare(bv) * sign;
              }
            }
          }
          return 0;
        });
      }
      return rows;
    },
    async count(): Promise<number> {
      return state.policies.length;
    },
    async deleteMany(): Promise<{ count: number }> {
      const count = state.policies.length;
      state.policies = [];
      return { count };
    },
    async createMany(args: {
      data: Array<{
        level: 'agentType' | 'provider' | 'model';
        agentType: string | null;
        providerID: string | null;
        modelID: string | null;
        hint: string;
        tags?: string[];
        priority?: number;
      }>;
    }): Promise<{ count: number }> {
      const now = new Date();
      for (const row of args.data) {
        state.policies.push({
          id: `p-${state.policies.length + 1}`,
          level: row.level,
          agentType: row.agentType,
          providerID: row.providerID,
          modelID: row.modelID,
          hint: row.hint,
          tags: row.tags ?? [],
          priority: row.priority ?? 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { count: args.data.length };
    },
  };

  const copilotSettings = {
    async findUnique(): Promise<FakeSettingsRow | null> {
      return state.settings ? { ...state.settings } : null;
    },
    async count(): Promise<number> {
      return state.settings ? 1 : 0;
    },
    async upsert(args: {
      where: { id: string };
      create: Partial<FakeSettingsRow>;
      update: Partial<FakeSettingsRow>;
    }): Promise<FakeSettingsRow> {
      const now = new Date();
      if (state.settings && state.settings.id === args.where.id) {
        state.settings = {
          ...state.settings,
          ...args.update,
          updatedAt: now,
        };
      } else {
        state.settings = {
          id: args.where.id,
          defaultAgentType: args.create.defaultAgentType ?? null,
          defaultProviderID: args.create.defaultProviderID ?? null,
          defaultModelID: args.create.defaultModelID ?? null,
          updatedAt: now,
        };
      }
      return { ...state.settings };
    },
  };

  const prisma: {
    agentPolicy: typeof agentPolicy;
    copilotSettings: typeof copilotSettings;
    $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T>;
  } = {
    agentPolicy,
    copilotSettings,
    async $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      return cb(prisma);
    },
  };

  return { prisma, state };
}

function sampleCatalog(): AgentCatalog {
  return {
    providers: [
      {
        agentType: 'opencode',
        providerID: 'opencode',
        label: 'OpenCode',
        availability: 'ready',
        models: [
          {
            providerID: 'minimax-coding-plan',
            modelID: 'MiniMax-M2.7-highspeed',
            label: 'minimax-coding-plan/MiniMax-M2.7-highspeed',
          },
        ],
      },
    ],
    fetchedAt: '2026-04-21T10:00:00.000Z',
  };
}

test('listAll merges policy rows and the copilot-settings singleton', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      {
        id: 'row-1',
        level: 'agentType',
        agentType: 'opencode',
        providerID: null,
        modelID: null,
        hint: 'main coder',
        tags: [],
        priority: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    settings: {
      id: 'singleton',
      defaultAgentType: 'opencode',
      defaultProviderID: 'minimax-coding-plan',
      defaultModelID: 'MiniMax-M2.7-highspeed',
      updatedAt: new Date(),
    },
  });
  const agents = { listCatalogForPrompt: async () => sampleCatalog() };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const result = await svc.listAll();

  assert.equal(result.policies.length, 1);
  assert.equal(result.policies[0].hint, 'main coder');
  assert.deepEqual(result.defaults, {
    defaultAgentType: 'opencode',
    defaultProviderID: 'minimax-coding-plan',
    defaultModelID: 'MiniMax-M2.7-highspeed',
  });
});

test('listAll returns empty defaults when the singleton has not been set yet', async () => {
  const { prisma } = makeFakePrisma({ policies: [], settings: null });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const result = await svc.listAll();

  assert.equal(result.policies.length, 0);
  assert.deepEqual(result.defaults, {
    defaultAgentType: null,
    defaultProviderID: null,
    defaultModelID: null,
  });
});

test('replacePolicies deletes existing rows and inserts the new batch in one transaction', async () => {
  const { prisma, state } = makeFakePrisma({
    policies: [
      {
        id: 'row-1',
        level: 'agentType',
        agentType: 'opencode',
        providerID: null,
        modelID: null,
        hint: 'old',
        tags: [],
        priority: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const input: AgentPolicyEntry[] = [
    {
      level: 'agentType',
      agentType: 'opencode',
      hint: 'fresh agent-level hint',
      tags: [],
      priority: 100,
    },
    {
      level: 'provider',
      agentType: 'opencode',
      providerID: 'minimax-coding-plan',
      hint: 'fresh provider-level hint',
      tags: ['fast'],
      priority: 90,
    },
    {
      level: 'model',
      agentType: 'opencode',
      providerID: 'minimax-coding-plan',
      modelID: 'MiniMax-M2.7-highspeed',
      hint: 'fresh model-level hint',
      tags: [],
      priority: 80,
    },
  ];

  const result = await svc.replacePolicies(input);

  assert.equal(result.policies.length, 3);
  assert.equal(state.policies.length, 3);
  assert.deepEqual(
    state.policies.map((p) => p.hint).sort(),
    [
      'fresh agent-level hint',
      'fresh model-level hint',
      'fresh provider-level hint',
    ].sort(),
  );
  assert.ok(!state.policies.some((p) => p.hint === 'old'));
});

test('setDefaults upserts the singleton', async () => {
  const { prisma, state } = makeFakePrisma({ policies: [], settings: null });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  await svc.setDefaults({
    defaultAgentType: 'opencode',
    defaultProviderID: 'anthropic',
    defaultModelID: 'claude-opus-4-7',
  });

  assert.deepEqual(
    {
      defaultAgentType: state.settings?.defaultAgentType,
      defaultProviderID: state.settings?.defaultProviderID,
      defaultModelID: state.settings?.defaultModelID,
    },
    {
      defaultAgentType: 'opencode',
      defaultProviderID: 'anthropic',
      defaultModelID: 'claude-opus-4-7',
    },
  );

  await svc.setDefaults({
    defaultAgentType: null,
    defaultProviderID: null,
    defaultModelID: null,
  });

  assert.deepEqual(
    {
      defaultAgentType: state.settings?.defaultAgentType,
      defaultProviderID: state.settings?.defaultProviderID,
      defaultModelID: state.settings?.defaultModelID,
    },
    {
      defaultAgentType: null,
      defaultProviderID: null,
      defaultModelID: null,
    },
  );
});

test('getCatalogForPrompt merges daemon catalog with policies + defaults', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      {
        id: 'row-1',
        level: 'model',
        agentType: 'opencode',
        providerID: 'minimax-coding-plan',
        modelID: 'MiniMax-M2.7-highspeed',
        hint: 'rapide',
        tags: ['fast'],
        priority: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    settings: {
      id: 'singleton',
      defaultAgentType: 'opencode',
      defaultProviderID: 'minimax-coding-plan',
      defaultModelID: 'MiniMax-M2.7-highspeed',
      updatedAt: new Date(),
    },
  });
  const agents = { listCatalogForPrompt: async () => sampleCatalog() };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const merged = await svc.getCatalogForPrompt();

  assert.ok(merged.catalog);
  assert.equal(merged.catalog?.providers.length, 1);
  assert.equal(merged.policies.length, 1);
  assert.equal(merged.policies[0].level, 'model');
  assert.equal(merged.defaults.defaultAgentType, 'opencode');
  assert.equal(merged.defaults.defaultProviderID, 'minimax-coding-plan');
  assert.equal(merged.defaults.defaultModelID, 'MiniMax-M2.7-highspeed');
});

test('getCatalogForPrompt keeps catalog null when the daemon has nothing to publish', async () => {
  const { prisma } = makeFakePrisma({ policies: [], settings: null });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const merged = await svc.getCatalogForPrompt();

  assert.equal(merged.catalog, null);
  assert.equal(merged.policies.length, 0);
});

function modelRow(over: Partial<FakePolicyRow>): FakePolicyRow {
  return {
    id: over.id ?? `p-${Math.random().toString(36).slice(2, 8)}`,
    level: 'model',
    agentType: over.agentType ?? 'opencode',
    providerID: over.providerID ?? null,
    modelID: over.modelID ?? null,
    hint: over.hint ?? 'hint',
    tags: over.tags ?? [],
    priority: over.priority ?? 0,
    createdAt: over.createdAt ?? new Date(),
    updatedAt: over.updatedAt ?? new Date(),
  };
}

test('resolveFallbackChain orders by priority desc and keeps the primary first when a tag is set', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      modelRow({ providerID: 'kimi-for-coding-oauth', modelID: 'K2.6', tags: ['complex'], priority: 100 }),
      modelRow({ providerID: 'zai-coding-plan', modelID: 'glm-5.1', tags: ['complex'], priority: 95 }),
      modelRow({ providerID: 'openai', modelID: 'gpt-5.4', tags: ['complex'], priority: 80 }),
      modelRow({ providerID: 'zai-coding-plan', modelID: 'glm-5v-turbo', tags: ['fast', 'visual'], priority: 98 }),
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    'complex',
  );

  assert.deepEqual(chain, [
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    { agentType: 'opencode', providerID: 'kimi-for-coding-oauth', modelID: 'K2.6' },
    { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
    { agentType: 'opencode', providerID: 'openai', modelID: 'gpt-5.4' },
  ]);
});

test('resolveFallbackChain ignores policies whose agentType differs from the primary', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      modelRow({ agentType: 'opencode', providerID: 'kimi-for-coding-oauth', modelID: 'K2.6', tags: ['complex'], priority: 100 }),
      modelRow({ agentType: 'cursor_agent', providerID: 'cursor', modelID: 'composer-2-fast', tags: ['complex'], priority: 110 }),
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    'complex',
  );

  assert.deepEqual(chain.map((e) => `${e.agentType}/${e.providerID}/${e.modelID}`), [
    'opencode/opencode-go/kimi-k2.6',
    'opencode/kimi-for-coding-oauth/K2.6',
  ]);
});

test('resolveFallbackChain dedups when a tagged policy equals the primary', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      modelRow({ providerID: 'opencode-go', modelID: 'kimi-k2.6', tags: ['complex'], priority: 100 }),
      modelRow({ providerID: 'zai-coding-plan', modelID: 'glm-5.1', tags: ['complex'], priority: 90 }),
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    'complex',
  );

  assert.deepEqual(chain, [
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    { agentType: 'opencode', providerID: 'zai-coding-plan', modelID: 'glm-5.1' },
  ]);
});

test('resolveFallbackChain caps the total chain length at 5', async () => {
  const { prisma } = makeFakePrisma({
    policies: Array.from({ length: 10 }, (_, i) =>
      modelRow({
        id: `p-${i}`,
        providerID: `provider-${i}`,
        modelID: `model-${i}`,
        tags: ['complex'],
        priority: 100 - i,
      }),
    ),
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    'complex',
  );

  assert.equal(chain.length, 5);
  assert.deepEqual(chain[0], { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' });
});

test('resolveFallbackChain with no tag returns every same-agentType model-level policy by priority', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      modelRow({ providerID: 'tagless-a', modelID: 'a', tags: [], priority: 60 }),
      modelRow({ providerID: 'tagless-b', modelID: 'b', tags: ['foo'], priority: 80 }),
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    undefined,
  );

  assert.deepEqual(chain.slice(1).map((e) => e.providerID), ['tagless-b', 'tagless-a']);
});

test('resolveFallbackChain returns only the primary when no tagged siblings exist', async () => {
  const { prisma } = makeFakePrisma({
    policies: [
      modelRow({ providerID: 'other-a', modelID: 'x', tags: ['visual'], priority: 80 }),
    ],
    settings: null,
  });
  const agents = { listCatalogForPrompt: async () => null };
  const svc = new AgentPolicyService(prisma as never, agents as never);

  const chain = await svc.resolveFallbackChain(
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
    'complex',
  );

  assert.deepEqual(chain, [
    { agentType: 'opencode', providerID: 'opencode-go', modelID: 'kimi-k2.6' },
  ]);
});
