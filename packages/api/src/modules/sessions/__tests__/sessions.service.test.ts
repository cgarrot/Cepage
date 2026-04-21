import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowFromSnapshot, type GraphSnapshot } from '@cepage/shared-core';
import type { GraphService } from '../../graph/graph.service.js';
import type { PrismaService } from '../../../common/database/prisma.service.js';
import { SessionsService } from '../sessions.service.js';

function snap(): GraphSnapshot {
  return {
    version: 1,
    id: 'source-session',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('removeArchived rejects active session', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({
        id: 's1',
        name: 'A',
        status: 'active',
      }),
      delete: async () => {
        throw new Error('should not delete');
      },
    },
  };
  const graph = {} as GraphService;
  const svc = new SessionsService(prisma as unknown as PrismaService, graph);
  await assert.rejects(() => svc.removeArchived('s1'), BadRequestException);
});

test('openWorkspaceDirectory rejects sessions without a workspace', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({
        id: 's1',
        name: 'A',
        status: 'active',
        createdAt: new Date('2026-04-01T00:00:00Z'),
        updatedAt: new Date('2026-04-01T00:00:00Z'),
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
  };
  const graph = {} as GraphService;
  const svc = new SessionsService(prisma as unknown as PrismaService, graph);
  await assert.rejects(() => svc.openWorkspaceDirectory('s1'), BadRequestException);
});

test('duplicateSession creates a new session and imports rekeyed workflow', async () => {
  const flow: unknown[] = [];
  let createdId = '';
  const prisma = {
    session: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'src') {
          return {
            id: 'src',
            name: 'Alpha',
            status: 'active',
            createdAt: new Date('2026-04-01T00:00:00Z'),
            updatedAt: new Date('2026-04-02T00:00:00Z'),
            workspaceParentDirectory: null,
            workspaceDirectoryName: null,
          };
        }
        if (where.id === createdId) {
          return {
            id: createdId,
            name: 'Alpha (copy)',
            status: 'active',
            createdAt: new Date('2026-04-03T00:00:00Z'),
            updatedAt: new Date('2026-04-03T00:00:00Z'),
            workspaceParentDirectory: null,
            workspaceDirectoryName: null,
          };
        }
        return null;
      },
      create: async ({ data }: { data: { name: string; status: string } }) => {
        createdId = 'new-session-id';
        return {
          id: createdId,
          name: data.name,
          status: data.status,
          createdAt: new Date('2026-04-03T00:00:00Z'),
          updatedAt: new Date('2026-04-03T00:00:00Z'),
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        };
      },
    },
  };
  const graph = {
    loadSnapshot: async (id: string) => {
      assert.equal(id, 'src');
      return snap();
    },
    replaceWorkflow: async (targetId: string, body: unknown) => {
      flow.push({ targetId, body });
      return { eventId: 1, counts: { nodes: 0, edges: 0, branches: 0 } };
    },
  } as unknown as GraphService;

  const svc = new SessionsService(prisma as unknown as PrismaService, graph);
  const res = await svc.duplicateSession('src');
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.data.id, 'new-session-id');
  assert.equal(res.data.name, 'Alpha (copy)');
  assert.equal(flow.length, 1);
  const entry = flow[0] as { targetId: string; body: unknown };
  assert.equal(entry.targetId, 'new-session-id');
  const expected = workflowFromSnapshot(snap());
  const got = entry.body as { kind: string; graph: { nodes: unknown[] } };
  assert.equal(got.kind, expected.kind);
  assert.equal(got.graph.nodes.length, expected.graph.nodes.length);
});

test('getGraphBundle serializes agent runs and workflow executions', async () => {
  const prisma = {
    session: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'session-1'
          ? {
              id: 'session-1',
              name: 'Session One',
              status: 'active',
              createdAt: new Date('2026-04-01T00:00:00Z'),
              updatedAt: new Date('2026-04-02T00:00:00Z'),
              lastEventId: 7,
              workspaceParentDirectory: '/tmp',
              workspaceDirectoryName: 'session-one',
            }
          : null,
    },
    activityEntry: {
      findMany: async () => [],
    },
    agentRun: {
      findMany: async () => [
        {
          id: 'run-1',
          sessionId: 'session-1',
          executionId: 'exec-1',
          requestId: 'req-1',
          agentType: 'opencode',
          role: 'builder',
          status: 'running',
          wakeReason: 'manual',
          runtime: { kind: 'local_process', cwd: '/tmp/session-one' },
          startedAt: new Date('2026-04-03T10:00:00Z'),
          endedAt: null,
          updatedAt: new Date('2026-04-03T10:01:00Z'),
          seedNodeIds: ['input-1'],
          rootNodeId: 'step-1',
          triggerNodeId: 'input-1',
          stepNodeId: 'step-1',
          retryOfRunId: null,
          parentAgentId: null,
          parentRunId: null,
          lastSeenEventId: 12,
          modelProviderId: 'openai',
          modelId: 'gpt-5.4',
          externalSessionId: 'ext-1',
          providerMetadata: { artifacts: { summary: true } },
          outputText: 'streaming output',
          isStreaming: true,
        },
      ],
    },
    workflowExecution: {
      findMany: async () => [
        {
          id: 'exec-1',
          sessionId: 'session-1',
          triggerNodeId: 'input-1',
          stepNodeId: 'step-1',
          currentRunId: 'run-1',
          latestRunId: 'run-1',
          agentType: 'opencode',
          role: 'builder',
          status: 'running',
          wakeReason: 'manual',
          runtime: { kind: 'local_process', cwd: '/tmp/session-one' },
          seedNodeIds: ['input-1'],
          modelProviderId: 'openai',
          modelId: 'gpt-5.4',
          startedAt: new Date('2026-04-03T10:00:00Z'),
          endedAt: null,
          createdAt: new Date('2026-04-03T10:00:00Z'),
          updatedAt: new Date('2026-04-03T10:01:00Z'),
        },
      ],
    },
    workflowControllerState: {
      findMany: async () => [],
    },
    workflowManagedFlow: {
      findMany: async () => [],
    },
  };
  const graph = {
    loadSnapshot: async () => snap(),
  } as unknown as GraphService;
  const approvals = {
    listPending: async () => [
      {
        id: 'approval-1',
        sessionId: 'session-1',
        runId: 'run-1',
        executionId: 'exec-1',
        requestId: 'req-1',
        kind: 'runtime_start',
        status: 'pending',
        title: 'Approve runtime start',
        detail: 'Needs review',
        risk: 'high',
        payload: { action: 'runtime_start' },
        resolution: null,
        requestedByType: 'system',
        requestedById: 'runtime_service',
        resolvedByType: null,
        resolvedById: null,
        createdAt: new Date('2026-04-03T09:59:00Z'),
        updatedAt: new Date('2026-04-03T10:00:00Z'),
        resolvedAt: null,
      },
    ],
  };
  const leases = {
    listActive: async () => [
      {
        id: 'lease-1',
        sessionId: 'session-1',
        resourceKind: 'worktree',
        resourceKey: 'main',
        scopeKey: null,
        holderKind: 'run',
        holderId: 'run-1',
        workerId: 'worker-1',
        runId: 'run-1',
        executionId: 'exec-1',
        requestId: 'req-1',
        status: 'active',
        leaseToken: 'token-1',
        metadata: { branch: 'main' },
        expiresAt: new Date('2026-04-03T10:30:00Z'),
        createdAt: new Date('2026-04-03T10:00:00Z'),
        updatedAt: new Date('2026-04-03T10:05:00Z'),
        releasedAt: null,
      },
    ],
  };

  const svc = new SessionsService(prisma as unknown as PrismaService, graph, approvals as never, leases as never);
  const res = await svc.getGraphBundle('session-1');

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.data.agentRuns.length, 1);
  assert.equal(res.data.workflowExecutions.length, 1);
  assert.equal(res.data.agentRuns[0]?.executionId, 'exec-1');
  assert.equal(res.data.agentRuns[0]?.triggerNodeId, 'input-1');
  assert.equal(res.data.agentRuns[0]?.stepNodeId, 'step-1');
  assert.equal(res.data.agentRuns[0]?.outputText, 'streaming output');
  assert.equal(res.data.agentRuns[0]?.isStreaming, true);
  assert.deepEqual(res.data.agentRuns[0]?.model, { providerID: 'openai', modelID: 'gpt-5.4' });
  assert.equal(res.data.workflowExecutions[0]?.currentRunId, 'run-1');
  assert.equal(res.data.workflowExecutions[0]?.latestRunId, 'run-1');
  assert.equal(res.data.workflowExecutions[0]?.triggerNodeId, 'input-1');
  assert.equal(res.data.workflowExecutions[0]?.stepNodeId, 'step-1');
  assert.equal(res.data.pendingApprovals.length, 1);
  assert.equal(res.data.pendingApprovals[0]?.id, 'approval-1');
  assert.equal(res.data.pendingApprovals[0]?.risk, 'high');
  assert.equal(res.data.activeLeases.length, 1);
  assert.equal(res.data.activeLeases[0]?.id, 'lease-1');
  assert.equal(res.data.activeLeases[0]?.holderId, 'run-1');
});

test('list applies status filter and returns totals', async () => {
  const calls: unknown[] = [];
  const prisma = {
    session: {
      findMany: async (args: { where: { status?: string }; skip: number; take: number }) => {
        calls.push(args);
        return [
          {
            id: 'a',
            name: 'One',
            status: 'active',
            createdAt: new Date('2026-04-01T00:00:00Z'),
            updatedAt: new Date('2026-04-03T00:00:00Z'),
            lastEventId: 3,
            workspaceParentDirectory: null,
            workspaceDirectoryName: null,
            _count: { nodes: 2, edges: 1, agentRuns: 0 },
          },
        ];
      },
      count: async (args: { where: { status?: string } }) => {
        calls.push(args);
        return 9;
      },
    },
  };
  const graph = {} as GraphService;
  const svc = new SessionsService(prisma as unknown as PrismaService, graph);
  const res = await svc.list(undefined, 'active', 10, 0);
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.data.total, 9);
  assert.equal(res.data.items.length, 1);
  assert.equal(res.data.items[0].counts.nodes, 2);
  assert.equal(calls.length, 2);
});

test('create() stamps a default workspace so agent runs are host-dispatchable', async () => {
  const prev = process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT;
  process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT = '/tmp/test-cepage';
  try {
    let captured: { data: Record<string, unknown> } | null = null;
    const prisma = {
      session: {
        create: async (args: { data: Record<string, unknown> }) => {
          captured = args;
          return {
            id: args.data.id,
            name: args.data.name,
            status: args.data.status,
            createdAt: new Date('2026-04-03T10:00:00Z'),
            updatedAt: new Date('2026-04-03T10:00:00Z'),
            workspaceParentDirectory: args.data.workspaceParentDirectory ?? null,
            workspaceDirectoryName: args.data.workspaceDirectoryName ?? null,
          };
        },
      },
    };
    const graph = {} as GraphService;
    const svc = new SessionsService(prisma as unknown as PrismaService, graph);
    const res = await svc.create('Smoke');
    assert.equal(res.success, true);
    assert.ok(captured, 'prisma.session.create was called');
    const data = (captured as unknown as { data: Record<string, unknown> }).data;
    assert.equal(data.name, 'Smoke');
    assert.equal(data.status, 'active');
    assert.equal(data.workspaceParentDirectory, '/tmp/test-cepage');
    const id = data.id as string;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(data.workspaceDirectoryName, `session-${id.slice(0, 8)}`);
  } finally {
    if (prev === undefined) delete process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT;
    else process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT = prev;
  }
});

test('create() falls back to $HOME/cepage_workspaces when env is unset', async () => {
  const prev = process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT;
  delete process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT;
  try {
    let captured: { data: Record<string, unknown> } | null = null;
    const prisma = {
      session: {
        create: async (args: { data: Record<string, unknown> }) => {
          captured = args;
          return {
            id: args.data.id,
            name: args.data.name,
            status: args.data.status,
            createdAt: new Date('2026-04-03T10:00:00Z'),
            updatedAt: new Date('2026-04-03T10:00:00Z'),
            workspaceParentDirectory: args.data.workspaceParentDirectory ?? null,
            workspaceDirectoryName: args.data.workspaceDirectoryName ?? null,
          };
        },
      },
    };
    const graph = {} as GraphService;
    const svc = new SessionsService(prisma as unknown as PrismaService, graph);
    await svc.create('Smoke');
    assert.ok(captured, 'prisma.session.create was called');
    const data = (captured as unknown as { data: Record<string, unknown> }).data;
    const parent = data.workspaceParentDirectory as string;
    assert.ok(
      parent.endsWith('cepage_workspaces'),
      `expected parent to end with cepage_workspaces, got ${parent}`,
    );
  } finally {
    if (prev !== undefined) process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT = prev;
  }
});
