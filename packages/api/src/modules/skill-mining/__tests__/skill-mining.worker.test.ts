import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillMiningWorker } from '../skill-mining.worker.js';
import { SkillMiningService } from '../skill-mining.service.js';

const mockMiningService = {
  createProposal: async () => void 0,
} as unknown as SkillMiningService;

function createMockPrisma(
  overrides?: {
    sessions?: Array<{
      id: string;
      updatedAt: Date;
      metadata: Record<string, unknown>;
      nodes: Array<{ type: string; content: Record<string, unknown> }>;
      edges: Array<Record<string, unknown>>;
    }>;
    userSkillCount?: number;
  },
) {
  const store = new Map<
    string,
    {
      metadata: Record<string, unknown>;
    }
  >();

  for (const s of overrides?.sessions ?? []) {
    store.set(s.id, { metadata: s.metadata });
  }

  return {
    session: {
      findUnique: async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
        const base = overrides?.sessions?.find((s) => s.id === args.where.id);
        if (!base) return null;
        const result = {
          ...base,
          metadata: store.get(base.id)?.metadata ?? base.metadata,
          nodes: base.nodes,
          edges: base.edges,
        };
        if (args.select) {
          const selected: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            selected[key] = (result as Record<string, unknown>)[key];
          }
          return selected as unknown as typeof result;
        }
        return result;
      },
      findMany: async (args?: { where?: Record<string, unknown>; take?: number; orderBy?: Record<string, unknown> }) => {
        let list =
          overrides?.sessions?.map((s) => ({
            ...s,
            metadata: store.get(s.id)?.metadata ?? s.metadata,
            nodes: s.nodes,
            edges: s.edges,
          })) ?? [];
        if (args?.where?.updatedAt && typeof args.where.updatedAt === 'object' && args.where.updatedAt !== null) {
          const gte = (args.where.updatedAt as Record<string, unknown>).gte as Date | undefined;
          if (gte) {
            list = list.filter((s) => s.updatedAt >= gte);
          }
        }
        if (args?.take) {
          list = list.slice(0, args.take);
        }
        if (args?.orderBy && (args.orderBy as Record<string, string>).updatedAt === 'desc') {
          list = [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        }
        return list;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { metadata: Record<string, unknown> };
      }) => {
        const existing = store.get(where.id);
        if (existing) {
          existing.metadata = { ...existing.metadata, ...data.metadata };
        }
        return { id: where.id, metadata: data.metadata };
      },
      count: async () => overrides?.sessions?.length ?? 0,
    },
    userSkill: {
      count: async () => overrides?.userSkillCount ?? 0,
    },
  };
}

function buildSession(id: string, options?: { nodes?: number; edges?: number; text?: string; meta?: Record<string, unknown>; updatedAt?: Date }) {
  const nodeCount = options?.nodes ?? 10;
  const edgeCount = options?.edges ?? 8;
  const text = options?.text ?? 'sk_test_123 stripe api_key design build test deploy';
  const updatedAt = options?.updatedAt ?? new Date();
  const nodes: Array<{ type: string; content: Record<string, unknown> }> = [];
  for (let i = 0; i < nodeCount; i++) {
    const type = i % 2 === 0 ? 'agent_step' : 'runtime_run';
    nodes.push({
      type,
      content: { text, command: `cmd-${i}` },
    });
  }
  const edges: Array<Record<string, unknown>> = [];
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ source: `n${i}`, target: `n${i + 1}` });
  }
  return {
    id,
    updatedAt,
    metadata: options?.meta ?? {},
    nodes,
    edges,
  };
}

test('detectCompilable returns empty when session not found', async () => {
  const prisma = createMockPrisma();
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('missing-id');
  assert.deepEqual(result, []);
});

test('detectCompilable skips already processed sessions', async () => {
  const session = buildSession('s1', { meta: { miningMinedAt: new Date().toISOString() } });
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('detectCompilable skips sessions with existing compiled skill', async () => {
  const session = buildSession('s1');
  const prisma = createMockPrisma({ sessions: [session], userSkillCount: 1 });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('detectCompilable returns session id when all heuristics pass', async () => {
  const session = buildSession('s1');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, ['s1']);
});

test('detectCompilable rejects trivial sessions with too few nodes', async () => {
  const session = buildSession('s1', { nodes: 2, edges: 1 });
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('detectCompilable rejects sessions without enough meaningful nodes', async () => {
  const session = buildSession('s1', {
    nodes: 6,
    edges: 4,
    text: 'sk_test_123 design build test deploy',
  });
  session.nodes = session.nodes.map((n, i) => ({
    ...n,
    type: i < 4 ? ('human_message' as const) : 'agent_step',
  }));
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('detectCompilable rejects sessions without sensitive keyword matches', async () => {
  const session = buildSession('s1', {
    text: 'design build test deploy refactor review implement',
  });
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('detectCompilable rejects sessions with fewer than two detected phases', async () => {
  const session = buildSession('s1', {
    text: 'sk_live_123 paypal design',
  });
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable('s1');
  assert.deepEqual(result, []);
});

test('tick scans recent sessions and returns compilable ids', async () => {
  const session = buildSession('s2');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable();
  assert.deepEqual(result, ['s2']);
});

test('tick deduplicates across repeated calls using in-memory set', async () => {
  const session = buildSession('s3');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  await worker.detectCompilable();
  const second = await worker.detectCompilable();
  assert.deepEqual(second, []);
  assert.equal(worker.getQueue().length, 1);
});

test('tick deduplicates using persisted metadata marker', async () => {
  const session = buildSession('s4', { meta: { miningMinedAt: '2025-01-01T00:00:00Z' } });
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable();
  assert.deepEqual(result, []);
});

test('markProcessed updates metadata and in-memory set', async () => {
  const session = buildSession('s5');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  await worker.detectCompilable('s5');
  const updated = await prisma.session.findUnique({ where: { id: 's5' }, select: { metadata: true } });
  const meta = updated?.metadata as Record<string, unknown> | undefined;
  assert.ok(meta?.miningMinedAt);
  assert.equal(worker.getQueue().length, 1);
});

test('onModuleInit starts interval and calls tick immediately', async () => {
  const session = buildSession('s6');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  await worker.onModuleInit();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(worker.getQueue().length, 1);
  await worker.onModuleDestroy();
});

test('onModuleInit is a no-op when pollMs is <= 0', async () => {
  const originalPollMs = process.env.SKILL_MINING_POLL_MS;
  process.env.SKILL_MINING_POLL_MS = '0';
  try {
    const prisma = createMockPrisma();
    const worker = new SkillMiningWorker(prisma as never, mockMiningService);
    await worker.onModuleInit();
    assert.equal(worker.getQueue().length, 0);
  } finally {
    if (originalPollMs === undefined) {
      delete process.env.SKILL_MINING_POLL_MS;
    } else {
      process.env.SKILL_MINING_POLL_MS = originalPollMs;
    }
  }
});

test('onModuleDestroy clears interval safely', async () => {
  const session = buildSession('s7');
  const prisma = createMockPrisma({ sessions: [session] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  await worker.onModuleInit();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await worker.onModuleDestroy();
  assert.equal(worker.getQueue().length, 1);
});

test('tick limits scan to 50 sessions and respects ordering', async () => {
  const sessions = [];
  for (let i = 0; i < 60; i++) {
    sessions.push(
      buildSession(`batch-${i}`, {
        text: 'sk_test stripe design build test deploy api_key pk_test',
      }),
    );
  }
  const prisma = createMockPrisma({ sessions });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable();
  assert.equal(result.length, 50);
});

test('tick respects lookback window and ignores stale sessions', async () => {
  const fresh = buildSession('fresh');
  const stale = buildSession('stale', { updatedAt: new Date(Date.now() - 65 * 60 * 1000) });
  const prisma = createMockPrisma({ sessions: [fresh, stale] });
  const worker = new SkillMiningWorker(prisma as never, mockMiningService);
  const result = await worker.detectCompilable();
  assert.deepEqual(result, ['fresh']);
});
