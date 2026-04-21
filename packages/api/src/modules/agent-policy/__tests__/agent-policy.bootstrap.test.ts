import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { AgentPolicyBootstrapService } from '../agent-policy.bootstrap.service.js';

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
    async count(): Promise<number> {
      return state.policies.length;
    },
    async createMany(args: {
      data: Array<{
        level: 'agentType' | 'provider' | 'model';
        agentType: string;
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
        state.settings = { ...state.settings, ...args.update, updatedAt: now };
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

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('bootstrapIfEmpty is a no-op when neither AGENT_POLICY_BOOTSTRAP_ENABLED nor AGENT_POLICY_BOOTSTRAP_PATH is set', async () => {
  const { prisma, state } = makeFakePrisma();

  await withEnv(
    {
      AGENT_POLICY_BOOTSTRAP_PATH: undefined,
      AGENT_POLICY_BOOTSTRAP_ENABLED: undefined,
    },
    async () => {
      const svc = new AgentPolicyBootstrapService(prisma as never);
      await svc.bootstrapIfEmpty();
    },
  );

  assert.equal(state.policies.length, 0);
  assert.equal(state.settings, null);
});

test('bootstrapIfEmpty seeds from the shipped defaults when AGENT_POLICY_BOOTSTRAP_ENABLED=true', async () => {
  const { prisma, state } = makeFakePrisma();

  await withEnv(
    {
      AGENT_POLICY_BOOTSTRAP_PATH: undefined,
      AGENT_POLICY_BOOTSTRAP_ENABLED: 'true',
    },
    async () => {
      const svc = new AgentPolicyBootstrapService(prisma as never);
      await svc.bootstrapIfEmpty();
    },
  );

  assert.ok(state.policies.length > 0, 'expected policies to be seeded');
  assert.ok(
    state.policies.some((p) => p.agentType === 'opencode' && p.level === 'agentType'),
    'expected at least one agentType-level hint for opencode',
  );
  assert.ok(state.settings, 'expected singleton settings to be created');
  assert.equal(state.settings?.defaultAgentType, 'opencode');
  assert.equal(state.settings?.defaultProviderID, 'opencode-go');
  assert.equal(state.settings?.defaultModelID, 'kimi-k2.6');
});

test('bootstrapIfEmpty honours AGENT_POLICY_BOOTSTRAP_PATH and overrides the shipped defaults', async () => {
  const { prisma, state } = makeFakePrisma();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-policy-bootstrap-'));
  try {
    const customPath = path.join(tmp, 'policy.json');
    await fs.writeFile(
      customPath,
      JSON.stringify({
        default: {
          agentType: 'cursor_agent',
          providerID: 'openai',
          modelID: 'gpt-5.4',
        },
        policies: [
          {
            level: 'agentType',
            agentType: 'cursor_agent',
            hint: 'custom hint',
            priority: 10,
          },
        ],
      }),
      'utf-8',
    );

    await withEnv({ AGENT_POLICY_BOOTSTRAP_PATH: customPath }, async () => {
      const svc = new AgentPolicyBootstrapService(prisma as never);
      await svc.bootstrapIfEmpty();
    });

    assert.equal(state.policies.length, 1);
    assert.equal(state.policies[0].agentType, 'cursor_agent');
    assert.equal(state.policies[0].hint, 'custom hint');
    assert.equal(state.settings?.defaultAgentType, 'cursor_agent');
    assert.equal(state.settings?.defaultProviderID, 'openai');
    assert.equal(state.settings?.defaultModelID, 'gpt-5.4');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('bootstrapIfEmpty is a no-op when the policy table already has rows', async () => {
  const preExisting: FakePolicyRow = {
    id: 'row-1',
    level: 'agentType',
    agentType: 'opencode',
    providerID: null,
    modelID: null,
    hint: 'existing',
    tags: [],
    priority: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { prisma, state } = makeFakePrisma({ policies: [preExisting], settings: null });

  const svc = new AgentPolicyBootstrapService(prisma as never);
  await svc.bootstrapIfEmpty();

  assert.equal(state.policies.length, 1);
  assert.equal(state.policies[0].hint, 'existing');
  assert.equal(state.settings, null);
});

test('bootstrapIfEmpty is a no-op when the singleton row already exists', async () => {
  const preExisting: FakeSettingsRow = {
    id: 'singleton',
    defaultAgentType: 'cursor_agent',
    defaultProviderID: 'openai',
    defaultModelID: 'gpt-5.4',
    updatedAt: new Date(),
  };
  const { prisma, state } = makeFakePrisma({ policies: [], settings: preExisting });

  const svc = new AgentPolicyBootstrapService(prisma as never);
  await svc.bootstrapIfEmpty();

  assert.equal(state.policies.length, 0);
  assert.equal(state.settings?.defaultAgentType, 'cursor_agent');
});

test('bootstrapIfEmpty throws when the env-pointed JSON is malformed', async () => {
  const { prisma } = makeFakePrisma();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-policy-bootstrap-'));
  try {
    const customPath = path.join(tmp, 'policy.json');
    await fs.writeFile(customPath, 'not valid json at all', 'utf-8');

    await withEnv({ AGENT_POLICY_BOOTSTRAP_PATH: customPath }, async () => {
      const svc = new AgentPolicyBootstrapService(prisma as never);
      await assert.rejects(() => svc.bootstrapIfEmpty(), /is not valid JSON/);
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
