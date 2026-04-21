import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type {
  AgentRun,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  WorkflowControllerState,
  WorkflowManagedFlowPhase,
  WorkflowManagedFlowState,
} from '@cepage/shared-core';
import { workflowFromSnapshot } from '@cepage/shared-core';
import { WorkflowManagedFlowService } from '../workflow-managed-flow.service.js';

type SessionRow = {
  id: string;
  workspaceParentDirectory: string | null;
  workspaceDirectoryName: string | null;
};

type FlowRow = {
  id: string;
  sessionId: string;
  entryNodeId: string;
  status: string;
  syncMode: string;
  revision: number;
  currentPhaseId: string | null;
  currentPhaseIndex: number | null;
  cancelRequested: boolean;
  wait: unknown;
  state: unknown;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ControllerRow = {
  id: string;
  sessionId: string;
  controllerNodeId: string;
  status: string;
  state: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ExecutionRow = {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
};

type RunRow = {
  id: string;
  executionId: string;
  status: string;
  outputText: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-08T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-08T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function edge(input: Pick<GraphEdge, 'id' | 'source' | 'target' | 'relation' | 'direction'>): GraphEdge {
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    relation: input.relation,
    direction: input.direction,
    strength: 1,
    createdAt: '2026-04-08T10:00:00.000Z',
    creator: { type: 'human', userId: 'u1' },
    metadata: {},
  };
}

function buildSnapshot(nodes: GraphNode[], edges: GraphEdge[]): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-08T10:00:00.000Z',
    lastEventId: 1,
    nodes,
    edges,
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function flush(service: WorkflowManagedFlowService): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const tasks = [...((service as unknown as { tasks: Map<string, Promise<void>> }).tasks.values())];
    if (tasks.length === 0) {
      return;
    }
    await Promise.allSettled(tasks);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('WorkflowManagedFlowService runs audit, derive, dev, and verify without manual graph edits', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-managed-flow-'));
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  const sessionDir = path.join(parent, 'session-1');
  await fs.mkdir(path.join(sessionDir, 'outputs'), { recursive: true });

  const session: SessionRow = {
    id: 'session-1',
    workspaceParentDirectory: parent,
    workspaceDirectoryName: 'session-1',
  };

  const nodes: GraphNode[] = [
    node({
      id: 'flow-node',
      type: 'managed_flow',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 160, y: 80 },
      content: {
        title: 'Main automation flow',
        syncMode: 'managed',
        entryPhaseId: 'audit',
        phases: [
          {
            id: 'audit',
            kind: 'agent_phase',
            nodeId: 'audit-step',
            expectedOutputs: ['outputs/gap-report.json'],
            validatorNodeId: 'audit-validator',
            newExecution: true,
          },
          {
            id: 'derive',
            kind: 'derive_input_phase',
            sourceNodeId: 'gap-file',
            targetTemplateNodeId: 'chunks-template',
            jsonPath: 'missing',
            summaryPath: 'summary',
            restartPhaseId: 'dev',
          },
          {
            id: 'dev',
            kind: 'loop_phase',
            nodeId: 'dev-loop',
          },
          {
            id: 'verify',
            kind: 'runtime_verify_phase',
            nodeId: 'verify-step',
            expectedOutputs: ['outputs/verify.txt'],
            newExecution: true,
          },
        ],
      },
    }),
    node({
      id: 'audit-step',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 480, y: 80 },
      content: { agentType: 'opencode' },
    }),
    node({
      id: 'gap-file',
      type: 'workspace_file',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 800, y: 80 },
      content: {
        title: 'Gap report',
        relativePath: 'outputs/gap-report.json',
        pathMode: 'static',
        role: 'output',
        origin: 'agent_output',
        kind: 'text',
        transferMode: 'reference',
        status: 'declared',
      },
    }),
    node({
      id: 'audit-validator',
      type: 'decision',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 800, y: 200 },
      content: {
        mode: 'workspace_validator',
        requirements: ['The gap report must expose at least one missing item.'],
        evidenceFrom: ['outputs/gap-report.json'],
        checks: [
          {
            kind: 'json_path_array_nonempty',
            path: 'outputs/gap-report.json',
            jsonPath: 'missing',
          },
        ],
        passAction: 'pass',
        failAction: 'retry_new_execution',
        blockAction: 'block',
      },
    }),
    node({
      id: 'chunks-template',
      type: 'input',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 1120, y: 80 },
      content: {
        mode: 'template',
        key: 'work_chunks',
        label: 'Work chunks',
        accepts: ['text'],
        multiple: true,
        required: true,
      },
    }),
    node({
      id: 'dev-loop',
      type: 'loop',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 480, y: 320 },
      content: {
        mode: 'for_each',
        source: {
          kind: 'input_parts',
          templateNodeId: 'chunks-template',
        },
        bodyNodeId: 'worker-subgraph',
        advancePolicy: 'only_on_pass',
        sessionPolicy: {
          withinItem: 'reuse_execution',
          betweenItems: 'new_execution',
        },
        blockedPolicy: 'pause_controller',
      },
    }),
    node({
      id: 'worker-subgraph',
      type: 'sub_graph',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 800, y: 320 },
      content: {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        entryNodeId: 'worker-step',
      },
    }),
    node({
      id: 'worker-step',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 1120, y: 320 },
      content: { agentType: 'opencode' },
    }),
    node({
      id: 'verify-step',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
      position: { x: 480, y: 560 },
      content: { agentType: 'opencode' },
    }),
  ];

  const edges: GraphEdge[] = [
    edge({
      id: 'edge-audit-output',
      source: 'audit-step',
      target: 'gap-file',
      relation: 'references',
      direction: 'source_to_target',
    }),
    edge({
      id: 'edge-audit-validator',
      source: 'audit-validator',
      target: 'audit-step',
      relation: 'validates',
      direction: 'source_to_target',
    }),
  ];

  const flowRows = new Map<string, FlowRow>();
  const controllerRows = new Map<string, ControllerRow>();
  const executionRows = new Map<string, ExecutionRow>();
  const runRows = new Map<string, RunRow>();
  const events: Array<{ type: string; payload: unknown }> = [];

  let nextNode = 1;
  let nextEdge = 1;
  let nextController = 1;

  const prisma = {
    session: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === session.id ? session : null),
    },
    workflowManagedFlow: {
      findFirst: async ({ where }: { where: { sessionId: string; entryNodeId: string } }) =>
        [...flowRows.values()]
          .filter((row) => row.sessionId === where.sessionId && row.entryNodeId === where.entryNodeId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0]
          ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => flowRows.get(where.id) ?? null,
      findMany: async ({ where }: { where: { sessionId: string; status: { in: string[] } } }) =>
        [...flowRows.values()]
          .filter((row) => row.sessionId === where.sessionId && where.status.in.includes(row.status))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime()),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: FlowRow = {
          id: data.id as string,
          sessionId: data.sessionId as string,
          entryNodeId: data.entryNodeId as string,
          status: data.status as string,
          syncMode: data.syncMode as string,
          revision: data.revision as number,
          currentPhaseId: (data.currentPhaseId as string | null) ?? null,
          currentPhaseIndex: (data.currentPhaseIndex as number | null) ?? null,
          cancelRequested: data.cancelRequested as boolean,
          wait: data.wait && typeof data.wait === 'object' && 'kind' in (data.wait as object) ? data.wait : null,
          state: data.state,
          startedAt: (data.startedAt as Date) ?? now,
          endedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        flowRows.set(row.id, row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; revision: number };
        data: Record<string, unknown>;
      }) => {
        const current = flowRows.get(where.id);
        if (!current || current.revision !== where.revision) {
          return { count: 0 };
        }
        flowRows.set(where.id, {
          ...current,
          status: data.status as string,
          syncMode: data.syncMode as string,
          revision: current.revision + 1,
          currentPhaseId: (data.currentPhaseId as string | null) ?? null,
          currentPhaseIndex: (data.currentPhaseIndex as number | null) ?? null,
          cancelRequested: data.cancelRequested as boolean,
          wait: data.wait && typeof data.wait === 'object' && 'kind' in (data.wait as object) ? data.wait : null,
          state: data.state,
          endedAt: (data.endedAt as Date | null) ?? null,
          updatedAt: new Date(),
        });
        return { count: 1 };
      },
    },
    workflowControllerState: {
      findUnique: async ({ where }: { where: { id: string } }) => controllerRows.get(where.id) ?? null,
    },
    workflowExecution: {
      findUnique: async ({ where }: { where: { id: string } }) => executionRows.get(where.id) ?? null,
    },
    agentRun: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = runRows.get(where.id);
        if (!row) return null;
        if (!select) return row;
        return {
          ...(select.id ? { id: row.id } : {}),
          ...(select.executionId ? { executionId: row.executionId } : {}),
          ...(select.outputText ? { outputText: row.outputText } : {}),
          ...(select.status ? { status: row.status } : {}),
          ...(select.startedAt ? { startedAt: row.startedAt } : {}),
          ...(select.endedAt ? { endedAt: row.endedAt } : {}),
        };
      },
    },
  };

  const graph = {
    loadSnapshot: async () => buildSnapshot(nodes, edges),
    patchNode: async (
      _sessionId: string,
      nodeId: string,
      patch: Partial<GraphNode>,
    ) => {
      const index = nodes.findIndex((entry) => entry.id === nodeId);
      if (index < 0) {
        throw new Error(`missing node ${nodeId}`);
      }
      const current = nodes[index]!;
      nodes[index] = {
        ...current,
        ...patch,
        metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata,
        updatedAt: new Date().toISOString(),
      };
      return {
        eventId: 100 + nextNode,
        sessionId: 'session-1',
        actor: { type: 'system', id: 'workflow_managed_flow' } as const,
        timestamp: new Date().toISOString(),
        payload: {
          type: 'node_updated' as const,
          nodeId,
          patch,
        },
      };
    },
    addNode: async (
      _sessionId: string,
      input: { type: GraphNode['type']; content: GraphNode['content']; position: { x: number; y: number }; metadata?: Record<string, unknown> },
    ) => {
      nextNode += 1;
      const id = `node-${nextNode}`;
      const created = node({
        id,
        type: input.type,
        creator: { type: 'system', reason: 'workflow_managed_flow' },
        content: input.content,
        position: input.position,
        metadata: input.metadata ?? {},
      });
      nodes.push(created);
      return {
        eventId: 200 + nextNode,
        sessionId: 'session-1',
        actor: { type: 'system', id: 'workflow_managed_flow' } as const,
        timestamp: created.updatedAt,
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: created,
        },
      };
    },
    addEdge: async (
      _sessionId: string,
      input: {
        source: string;
        target: string;
        relation: GraphEdge['relation'];
        direction: GraphEdge['direction'];
        metadata?: Record<string, unknown>;
      },
    ) => {
      nextEdge += 1;
      const created = edge({
        id: `edge-${nextEdge}`,
        source: input.source,
        target: input.target,
        relation: input.relation,
        direction: input.direction,
      });
      created.metadata = input.metadata ?? {};
      edges.push(created);
      return {
        eventId: 300 + nextEdge,
        sessionId: 'session-1',
        actor: { type: 'system', id: 'workflow_managed_flow' } as const,
        timestamp: created.createdAt,
        payload: {
          type: 'edge_added' as const,
          edgeId: created.id,
          edge: created,
        },
      };
    },
  };

  const spawns: Array<{ triggerNodeId?: string; allowLoopChildRun?: boolean }> = [];
  const agents = {
    spawn: async (
      _sessionId: string,
      body: { triggerNodeId?: string },
      input?: { allowLoopChildRun?: boolean },
    ) => {
      spawns.push({
        triggerNodeId: body.triggerNodeId,
        allowLoopChildRun: input?.allowLoopChildRun,
      });
      const suffix = body.triggerNodeId === 'verify-step' ? 'verify' : 'audit';
      const executionId = `execution-${suffix}`;
      const runId = `run-${suffix}`;
      const startedAt = new Date(Date.now() - 1000);
      executionRows.set(executionId, {
        id: executionId,
        status: 'running',
        startedAt,
        endedAt: null,
      });
      runRows.set(runId, {
        id: runId,
        executionId,
        status: 'running',
        outputText: null,
        startedAt,
        endedAt: null,
      });
      return {
        data: {
          agentRunId: runId,
          rootNodeId: body.triggerNodeId ?? runId,
        },
      };
    },
  };

  const controllers = {
    run: async (_sessionId: string, nodeId: string) => {
      const controllerId = `controller-${nextController}`;
      nextController += 1;
      controllerRows.set(controllerId, {
        id: controllerId,
        sessionId: 'session-1',
        controllerNodeId: nodeId,
        status: 'running',
        state: { lastDetail: 'loop running' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return {
        controllerId,
        controllerNodeId: nodeId,
        status: 'running',
        launchMode: 'run',
      };
    },
  };

  const service = new WorkflowManagedFlowService(
    prisma as never,
    graph as never,
    { emitSession: (_sessionId: string, event: { type: string; payload: unknown }) => events.push(event) } as never,
    agents as never,
    controllers as never,
  );

  const started = await service.run('session-1', 'flow-node', {});
  assert.equal(started.launchMode, 'run');

  await flush(service);

  let flow = [...flowRows.values()][0];
  assert.ok(flow);
  assert.equal(flow.status, 'waiting');
  assert.equal(flow.currentPhaseId, 'audit');
  assert.deepEqual((flow.wait as { kind?: string } | null)?.kind, 'execution');

  await fs.writeFile(
    path.join(sessionDir, 'outputs', 'gap-report.json'),
    JSON.stringify({
      summary: 'Gap audit',
      missing: ['Add boss wave', 'Tune progression'],
    }),
  );
  executionRows.set('execution-audit', {
    id: 'execution-audit',
    status: 'completed',
    startedAt: executionRows.get('execution-audit')?.startedAt ?? new Date(Date.now() - 1000),
    endedAt: new Date(),
  });
  runRows.set('run-audit', {
    id: 'run-audit',
    executionId: 'execution-audit',
    status: 'completed',
    outputText: 'gap audit complete',
    startedAt: runRows.get('run-audit')?.startedAt ?? new Date(Date.now() - 1000),
    endedAt: new Date(),
  });

  await service.notifyAgentStatus('session-1', {
    id: 'run-audit',
    executionId: 'execution-audit',
    status: 'completed',
  } as unknown as AgentRun);
  await flush(service);

  flow = [...flowRows.values()][0]!;
  assert.equal(flow.status, 'waiting');
  assert.equal(flow.currentPhaseId, 'dev');
  assert.deepEqual((flow.wait as { kind?: string } | null)?.kind, 'controller');

  const derived = nodes.find(
    (entry) =>
      entry.type === 'input'
      && entry.id !== 'chunks-template'
      && typeof (entry.content as { mode?: unknown }).mode === 'string'
      && (entry.content as { mode?: string }).mode === 'bound',
  );
  assert.ok(derived);
  assert.deepEqual((derived.content as { templateNodeId?: unknown }).templateNodeId, 'chunks-template');
  assert.deepEqual(
    ((derived.content as { parts?: Array<{ text?: string }> }).parts ?? []).map((part) => part.text),
    ['Add boss wave', 'Tune progression'],
  );
  assert.ok(
    edges.some(
      (entry) =>
        entry.source === 'chunks-template'
        && entry.target === derived.id
        && entry.relation === 'derived_from',
    ),
  );

  controllerRows.set('controller-1', {
    id: 'controller-1',
    sessionId: 'session-1',
    controllerNodeId: 'dev-loop',
    status: 'completed',
    state: { lastDetail: 'loop completed' },
    createdAt: controllerRows.get('controller-1')?.createdAt ?? new Date(),
    updatedAt: new Date(),
  });

  await service.notifyControllerState({
    id: 'controller-1',
    sessionId: 'session-1',
    controllerNodeId: 'dev-loop',
    status: 'completed',
  } as unknown as WorkflowControllerState);
  await flush(service);

  flow = [...flowRows.values()][0]!;
  assert.equal(flow.status, 'waiting');
  assert.equal(flow.currentPhaseId, 'verify');
  assert.deepEqual((flow.wait as { kind?: string } | null)?.kind, 'execution');

  await fs.writeFile(path.join(sessionDir, 'outputs', 'verify.txt'), 'runtime ok');
  executionRows.set('execution-verify', {
    id: 'execution-verify',
    status: 'completed',
    startedAt: executionRows.get('execution-verify')?.startedAt ?? new Date(Date.now() - 1000),
    endedAt: new Date(),
  });
  runRows.set('run-verify', {
    id: 'run-verify',
    executionId: 'execution-verify',
    status: 'completed',
    outputText: 'verify complete',
    startedAt: runRows.get('run-verify')?.startedAt ?? new Date(Date.now() - 1000),
    endedAt: new Date(),
  });

  await service.notifyAgentStatus('session-1', {
    id: 'run-verify',
    executionId: 'execution-verify',
    status: 'completed',
  } as unknown as AgentRun);
  await flush(service);

  flow = [...flowRows.values()][0]!;
  const state = flow.state as {
    phaseRecords?: Record<string, { status?: string }>;
  };
  assert.equal(flow.status, 'completed');
  assert.ok(flow.endedAt);
  assert.equal(state.phaseRecords?.audit?.status, 'completed');
  assert.equal(state.phaseRecords?.derive?.status, 'completed');
  assert.equal(state.phaseRecords?.dev?.status, 'completed');
  assert.equal(state.phaseRecords?.verify?.status, 'completed');
  assert.equal(
    spawns.some((entry) => entry.triggerNodeId === 'audit-step' && entry.allowLoopChildRun === true),
    true,
  );
  assert.equal(
    spawns.some((entry) => entry.triggerNodeId === 'verify-step' && entry.allowLoopChildRun === true),
    true,
  );
  assert.equal(
    ((nodes.find((entry) => entry.id === 'flow-node')?.metadata as { flow?: { status?: string } })?.flow?.status),
    'completed',
  );
  assert.ok(events.some((event) => event.type === 'workflow.flow_updated'));
});

test('workflow_transfer_valid blocks simplified workflow-transfer files until they parse cleanly', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-workflow-transfer-'));
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  const dir = path.join(parent, 'session-1');
  await fs.mkdir(path.join(dir, 'outputs'), { recursive: true });

  const session: SessionRow = {
    id: 'session-1',
    workspaceParentDirectory: parent,
    workspaceDirectoryName: 'session-1',
  };

  const snap = buildSnapshot([
    node({
      id: 'validator',
      type: 'decision',
      creator: { type: 'human', userId: 'u1' },
      content: {
        mode: 'workspace_validator',
        requirements: ['The workflow transfer must be importable.'],
        evidenceFrom: ['outputs/workflow-transfer.json'],
        checks: [
          {
            kind: 'workflow_transfer_valid',
            path: 'outputs/workflow-transfer.json',
          },
        ],
        passAction: 'pass',
        failAction: 'retry_new_execution',
        blockAction: 'block',
      },
    }),
  ], []);

  const run = {
    id: 'run-1',
    outputText: 'assembled',
    status: 'completed',
    startedAt: new Date(Date.now() - 1000),
    endedAt: new Date(),
  };

  await fs.writeFile(
    path.join(dir, 'outputs', 'workflow-transfer.json'),
    JSON.stringify({
      kind: 'cepage.workflow',
      version: 2,
      graph: {
        nodes: [],
        edges: [],
      },
    }),
  );

  const service = new WorkflowManagedFlowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const fail = await (
    service as unknown as {
      evaluateExecution: (input: {
        session: SessionRow;
        snapshot: GraphSnapshot;
        childStatus: string;
        run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
        validatorNodeId?: string;
        expectedOutputs: string[];
        passDetail?: string;
      }) => Promise<{ outcome: string; detail: string }>;
    }
  ).evaluateExecution({
    session,
    snapshot: snap,
    childStatus: 'completed',
    run,
    validatorNodeId: 'validator',
    expectedOutputs: ['outputs/workflow-transfer.json'],
  });

  assert.equal(fail.outcome, 'retry_new_execution');
  assert.match(fail.detail, /workflow transfer valid/);

  const flow = workflowFromSnapshot(buildSnapshot([
    node({
      id: 'root',
      type: 'note',
      creator: { type: 'human', userId: 'u1' },
      content: { text: 'root', format: 'markdown' },
    }),
  ], []));
  await fs.writeFile(path.join(dir, 'outputs', 'workflow-transfer.json'), JSON.stringify(flow, null, 2));

  const pass = await (
    service as unknown as {
      evaluateExecution: (input: {
        session: SessionRow;
        snapshot: GraphSnapshot;
        childStatus: string;
        run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
        validatorNodeId?: string;
        expectedOutputs: string[];
        passDetail?: string;
      }) => Promise<{ outcome: string; detail: string }>;
    }
  ).evaluateExecution({
    session,
    snapshot: snap,
    childStatus: 'completed',
    run,
    validatorNodeId: 'validator',
    expectedOutputs: ['outputs/workflow-transfer.json'],
  });

  assert.equal(pass.outcome, 'pass');
});

test('evaluateExecution supports negative workspace validator checks', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-validator-negative-'));
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  const dir = path.join(parent, 'session-1');
  await fs.mkdir(path.join(dir, 'outputs', 'products'), { recursive: true });

  const session: SessionRow = {
    id: 'session-1',
    workspaceParentDirectory: parent,
    workspaceDirectoryName: 'session-1',
  };

  const snap = buildSnapshot([
    node({
      id: 'validator',
      type: 'decision',
      creator: { type: 'human', userId: 'u1' },
      content: {
        mode: 'workspace_validator',
        requirements: ['Stable catalog outputs must stay sanitized.'],
        evidenceFrom: ['outputs/catalog.json'],
        checks: [
          {
            kind: 'path_not_exists',
            path: 'outputs/products/listing.json',
          },
          {
            kind: 'file_not_contains',
            path: 'outputs/catalog.json',
            text: 'manualFieldsToConfirm',
          },
        ],
        passAction: 'pass',
        failAction: 'retry_new_execution',
        blockAction: 'block',
      },
    }),
  ], []);

  const run = {
    id: 'run-1',
    outputText: 'publish complete',
    status: 'completed',
    startedAt: new Date(Date.now() - 1000),
    endedAt: new Date(),
  };

  await fs.writeFile(
    path.join(dir, 'outputs', 'catalog.json'),
    JSON.stringify({ items: [{ slug: 'clean-piece' }] }, null, 2),
  );

  const service = new WorkflowManagedFlowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const pass = await (
    service as unknown as {
      evaluateExecution: (input: {
        session: SessionRow;
        snapshot: GraphSnapshot;
        childStatus: string;
        run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
        validatorNodeId?: string;
        expectedOutputs: string[];
        passDetail?: string;
      }) => Promise<{ outcome: string; detail: string }>;
    }
  ).evaluateExecution({
    session,
    snapshot: snap,
    childStatus: 'completed',
    run,
    validatorNodeId: 'validator',
    expectedOutputs: ['outputs/catalog.json'],
  });

  assert.equal(pass.outcome, 'pass');

  await fs.writeFile(path.join(dir, 'outputs', 'products', 'listing.json'), '{}');
  await fs.writeFile(
    path.join(dir, 'outputs', 'catalog.json'),
    JSON.stringify({ items: [], manualFieldsToConfirm: ['still leaked'] }, null, 2),
  );

  const fail = await (
    service as unknown as {
      evaluateExecution: (input: {
        session: SessionRow;
        snapshot: GraphSnapshot;
        childStatus: string;
        run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
        validatorNodeId?: string;
        expectedOutputs: string[];
        passDetail?: string;
      }) => Promise<{ outcome: string; detail: string }>;
    }
  ).evaluateExecution({
    session,
    snapshot: snap,
    childStatus: 'completed',
    run,
    validatorNodeId: 'validator',
    expectedOutputs: ['outputs/catalog.json'],
  });

  assert.equal(fail.outcome, 'retry_new_execution');
  assert.match(fail.detail, /path not exists|file not contains/);
});

test('run forceRestart rebuilds a queued flow instead of resuming stale state', async () => {
  const now = '2026-04-08T10:00:00.000Z';
  const phases: WorkflowManagedFlowPhase[] = [
    {
      id: 'audit',
      kind: 'agent_phase',
      nodeId: 'audit-step',
      expectedOutputs: ['outputs/audit.txt'],
      newExecution: true,
    },
    {
      id: 'verify',
      kind: 'runtime_verify_phase',
      nodeId: 'verify-step',
      expectedOutputs: ['outputs/verify.txt'],
      newExecution: true,
    },
  ];
  const state: WorkflowManagedFlowState = {
    id: 'flow-1',
    sessionId: 'session-1',
    entryNodeId: 'flow-node',
    syncMode: 'managed',
    status: 'queued',
    revision: 2,
    currentPhaseId: 'verify',
    currentPhaseIndex: 1,
    phases,
    phaseRecords: {
      audit: {
        phaseId: 'audit',
        kind: 'agent_phase',
        status: 'completed',
        attempts: 1,
        nodeId: 'audit-step',
        executionId: 'execution-audit',
        runId: 'run-audit',
        detail: 'audit complete',
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
      verify: {
        phaseId: 'verify',
        kind: 'runtime_verify_phase',
        status: 'waiting',
        attempts: 2,
        nodeId: 'verify-step',
        executionId: 'execution-verify',
        runId: 'run-verify',
        detail: 'waiting for verify',
        startedAt: now,
        updatedAt: now,
      },
    },
    state: {
      phaseRequestKeys: {
        audit: 'audit-old',
        verify: 'verify-old',
      },
    },
    wait: {
      kind: 'execution',
      phaseId: 'verify',
      executionId: 'execution-verify',
      runId: 'run-verify',
      nodeId: 'verify-step',
    },
    cancelRequested: false,
    startedAt: now,
    updatedAt: now,
  };
  let saved: WorkflowManagedFlowState | undefined;
  const queued: string[] = [];
  const service = new WorkflowManagedFlowService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
      workflowManagedFlow: {
        findFirst: async () => ({
          id: 'flow-1',
        }),
      },
    } as never,
    {
      loadSnapshot: async () =>
        buildSnapshot([
          node({
            id: 'flow-node',
            type: 'managed_flow',
            creator: { type: 'human', userId: 'u1' },
            content: {
              title: 'Queued flow',
              syncMode: 'managed',
              entryPhaseId: 'audit',
              phases,
            },
          }),
          node({
            id: 'audit-step',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: { agentType: 'opencode' },
          }),
          node({
            id: 'verify-step',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: { agentType: 'opencode' },
          }),
        ], []),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { serializeFlowState: () => WorkflowManagedFlowState }).serializeFlowState = () => state;
  (service as unknown as { writeFlowState: (next: WorkflowManagedFlowState) => Promise<WorkflowManagedFlowState> }).writeFlowState =
    async (next) => {
      saved = next;
      return next;
    };
  (service as unknown as { ensureTask: (flowId: string) => void }).ensureTask = (flowId) => {
    queued.push(flowId);
  };

  const started = await service.run('session-1', 'flow-node', { forceRestart: true });

  assert.equal(started.launchMode, 'restart');
  assert.equal(started.status, 'queued');
  assert.deepEqual(queued, ['flow-1']);
  assert.equal(saved?.currentPhaseId, 'audit');
  assert.equal(saved?.currentPhaseIndex, 0);
  assert.equal(saved?.wait, undefined);
  assert.equal(saved?.phaseRecords.audit?.attempts, 0);
  assert.equal(saved?.phaseRecords.verify?.attempts, 0);
  assert.equal(saved?.phaseRecords.audit?.status, 'pending');
  assert.equal(saved?.phaseRecords.verify?.status, 'pending');
  assert.notEqual(
    (saved?.state as { phaseRequestKeys?: Record<string, string> } | undefined)?.phaseRequestKeys?.audit,
    'audit-old',
  );
  assert.notEqual(
    (saved?.state as { phaseRequestKeys?: Record<string, string> } | undefined)?.phaseRequestKeys?.verify,
    'verify-old',
  );
  assert.deepEqual(
    ((saved?.state as { forceRestartPhaseIds?: string[] } | undefined)?.forceRestartPhaseIds ?? []).sort(),
    ['audit', 'verify'],
  );
});

test('run resumes a queued flow when forceRestart is not requested', async () => {
  const phases: WorkflowManagedFlowPhase[] = [
    {
      id: 'audit',
      kind: 'agent_phase',
      nodeId: 'audit-step',
      expectedOutputs: ['outputs/audit.txt'],
      newExecution: true,
    },
  ];
  const state: WorkflowManagedFlowState = {
    id: 'flow-1',
    sessionId: 'session-1',
    entryNodeId: 'flow-node',
    syncMode: 'managed',
    status: 'queued',
    revision: 0,
    currentPhaseId: 'audit',
    currentPhaseIndex: 0,
    phases,
    phaseRecords: {
      audit: {
        phaseId: 'audit',
        kind: 'agent_phase',
        status: 'pending',
        attempts: 0,
        nodeId: 'audit-step',
        updatedAt: '2026-04-08T10:00:00.000Z',
      },
    },
    state: { phaseRequestKeys: { audit: 'audit-1' } },
    cancelRequested: false,
    startedAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z',
  };
  let wrote = false;
  const queued: string[] = [];
  const service = new WorkflowManagedFlowService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
      workflowManagedFlow: {
        findFirst: async () => ({
          id: 'flow-1',
        }),
      },
    } as never,
    {
      loadSnapshot: async () =>
        buildSnapshot([
          node({
            id: 'flow-node',
            type: 'managed_flow',
            creator: { type: 'human', userId: 'u1' },
            content: {
              title: 'Queued flow',
              syncMode: 'managed',
              entryPhaseId: 'audit',
              phases,
            },
          }),
          node({
            id: 'audit-step',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: { agentType: 'opencode' },
          }),
        ], []),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { serializeFlowState: () => WorkflowManagedFlowState }).serializeFlowState = () => state;
  (service as unknown as { writeFlowState: (next: WorkflowManagedFlowState) => Promise<WorkflowManagedFlowState> }).writeFlowState =
    async (next) => {
      wrote = true;
      return next;
    };
  (service as unknown as { ensureTask: (flowId: string) => void }).ensureTask = (flowId) => {
    queued.push(flowId);
  };

  const started = await service.run('session-1', 'flow-node', {});

  assert.equal(started.launchMode, 'resume');
  assert.deepEqual(queued, ['flow-1']);
  assert.equal(wrote, false);
});

test('connectedOutputPaths follows managed_flow refs before canvas edges are materialized', () => {
  const snap = buildSnapshot([
    node({
      id: 'flow-node',
      type: 'managed_flow',
      creator: { type: 'human', userId: 'u1' },
      content: {
        title: 'Audit flow',
        syncMode: 'managed',
        entryPhaseId: 'audit',
        phases: [
          {
            id: 'audit',
            kind: 'agent_phase',
            nodeId: 'audit-step',
            expectedOutputs: [],
          },
        ],
      },
    }),
    node({
      id: 'audit-step',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
      content: { agentType: 'opencode' },
    }),
    node({
      id: 'audit-file',
      type: 'workspace_file',
      creator: { type: 'human', userId: 'u1' },
      content: {
        title: 'Audit report',
        relativePath: 'outputs/audit.txt',
        pathMode: 'static',
        role: 'output',
        origin: 'derived',
        kind: 'text',
        transferMode: 'reference',
        status: 'declared',
      },
    }),
  ], [
    edge({
      id: 'edge-1',
      source: 'audit-step',
      target: 'audit-file',
      relation: 'produces',
      direction: 'source_to_target',
    }),
  ]);

  const service = new WorkflowManagedFlowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const outputs = (
    service as unknown as {
      connectedOutputPaths: (snapshot: GraphSnapshot, nodeId: string) => string[];
    }
  ).connectedOutputPaths(snap, 'flow-node');

  assert.deepEqual(outputs, ['outputs/audit.txt']);
});

test('restartPhaseId revisits a completed loop phase with a forced fresh controller', async () => {
  const calls: Array<{ nodeId: string; forceRestart?: boolean }> = [];
  let saved: WorkflowManagedFlowState | undefined;
  const phases: WorkflowManagedFlowPhase[] = [
    {
      id: 'dev',
      kind: 'loop_phase',
      nodeId: 'dev-loop',
    },
    {
      id: 'audit',
      kind: 'agent_phase',
      nodeId: 'audit-step',
      expectedOutputs: ['outputs/gap-report.json'],
      newExecution: true,
    },
    {
      id: 'derive',
      kind: 'derive_input_phase',
      sourceNodeId: 'gap-file',
      targetTemplateNodeId: 'chunks-template',
      jsonPath: 'items',
      summaryPath: 'summary',
      restartPhaseId: 'dev',
    },
    {
      id: 'verify',
      kind: 'runtime_verify_phase',
      nodeId: 'verify-step',
      expectedOutputs: ['outputs/runtime-verify.md'],
      newExecution: true,
    },
  ];
  const now = '2026-04-08T10:00:00.000Z';
  const state: WorkflowManagedFlowState = {
    id: 'flow-1',
    sessionId: 'session-1',
    entryNodeId: 'flow-node',
    syncMode: 'managed',
    status: 'running',
    revision: 0,
    currentPhaseId: 'derive',
    currentPhaseIndex: 2,
    phases,
    phaseRecords: {
      dev: {
        phaseId: 'dev',
        kind: 'loop_phase',
        status: 'completed',
        attempts: 1,
        nodeId: 'dev-loop',
        controllerId: 'controller-old',
        detail: 'loop completed',
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
      audit: {
        phaseId: 'audit',
        kind: 'agent_phase',
        status: 'completed',
        attempts: 1,
        nodeId: 'audit-step',
        executionId: 'execution-audit',
        runId: 'run-audit',
        detail: 'gap audit complete',
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
      derive: {
        phaseId: 'derive',
        kind: 'derive_input_phase',
        status: 'pending',
        attempts: 0,
        nodeId: 'gap-file',
        updatedAt: now,
      },
      verify: {
        phaseId: 'verify',
        kind: 'runtime_verify_phase',
        status: 'completed',
        attempts: 1,
        nodeId: 'verify-step',
        executionId: 'execution-verify',
        runId: 'run-verify',
        detail: 'verify complete',
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
    },
    state: {
      phaseRequestKeys: {
        audit: 'audit-old',
        derive: 'derive-old',
        dev: 'dev-old',
        verify: 'verify-old',
      },
    },
    cancelRequested: false,
    startedAt: now,
    updatedAt: now,
  };
  const service = new WorkflowManagedFlowService(
    {
      workflowControllerState: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'controller-old'
            ? {
                id: 'controller-old',
                sessionId: 'session-1',
                controllerNodeId: 'dev-loop',
                status: 'completed',
                state: { lastDetail: 'loop completed' },
                createdAt: new Date(now),
                updatedAt: new Date(now),
              }
            : null,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      run: async (_sessionId: string, nodeId: string, body: { forceRestart?: boolean }) => {
        calls.push({ nodeId, forceRestart: body.forceRestart });
        return {
          controllerId: 'controller-new',
          controllerNodeId: nodeId,
          status: 'running',
          launchMode: 'restart',
        };
      },
    } as never,
  );
  (service as unknown as { writeFlowState: (next: WorkflowManagedFlowState) => Promise<WorkflowManagedFlowState> }).writeFlowState =
    async (next) => {
      saved = next;
      return next;
    };

  const revisited = (
    service as unknown as {
      completedState: (
        state: WorkflowManagedFlowState,
        phase: WorkflowManagedFlowPhase,
        record: WorkflowManagedFlowState['phaseRecords'][string],
        detail: string,
        nextPhaseId?: string,
      ) => WorkflowManagedFlowState;
    }
  ).completedState(state, phases[2]!, state.phaseRecords.derive!, 'derived 2 work item(s)', 'dev');

  assert.equal(revisited.currentPhaseId, 'dev');
  assert.equal(revisited.phaseRecords.dev?.status, 'pending');
  assert.equal(revisited.phaseRecords.audit?.status, 'pending');
  assert.equal(revisited.phaseRecords.verify?.status, 'pending');
  assert.notEqual((revisited.state as { phaseRequestKeys?: Record<string, string> }).phaseRequestKeys?.dev, 'dev-old');
  assert.notEqual((revisited.state as { phaseRequestKeys?: Record<string, string> }).phaseRequestKeys?.audit, 'audit-old');
  assert.notEqual((revisited.state as { phaseRequestKeys?: Record<string, string> }).phaseRequestKeys?.verify, 'verify-old');
  assert.equal((revisited.state as { phaseRequestKeys?: Record<string, string> }).phaseRequestKeys?.derive, 'derive-old');

  await (
    service as unknown as {
      advanceLoopPhase: (
        state: WorkflowManagedFlowState,
        phase: Extract<WorkflowManagedFlowPhase, { kind: 'loop_phase' }>,
        session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null },
      ) => Promise<'continue' | 'yield' | 'stop'>;
    }
  ).advanceLoopPhase(revisited, phases[0] as Extract<WorkflowManagedFlowPhase, { kind: 'loop_phase' }>, {
    id: 'session-1',
    workspaceParentDirectory: null,
    workspaceDirectoryName: null,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    nodeId: 'dev-loop',
    forceRestart: true,
  });
  assert.equal(saved?.phaseRecords.dev?.controllerId, 'controller-new');
  assert.equal(saved?.wait?.kind, 'controller');
});

test('forceRestart on an execution phase spawns a fresh run instead of reusing stale execution state', async () => {
  const spawns: Array<{
    newExecution?: boolean;
    requestId?: string;
    managedContract?: {
      phaseKind: 'agent_phase' | 'runtime_verify_phase';
      expectedOutputs: string[];
      validatorNodeId?: string;
    };
  }> = [];
  let saved: WorkflowManagedFlowState | undefined;
  const now = '2026-04-08T10:00:00.000Z';
  const phase: Extract<WorkflowManagedFlowPhase, { kind: 'runtime_verify_phase' }> = {
    id: 'verify',
    kind: 'runtime_verify_phase',
    nodeId: 'verify-step',
    validatorNodeId: 'verify-validator',
    expectedOutputs: ['outputs/verify.txt'],
    newExecution: false,
  };
  const state: WorkflowManagedFlowState = {
    id: 'flow-1',
    sessionId: 'session-1',
    entryNodeId: 'flow-node',
    syncMode: 'managed',
    status: 'running',
    revision: 0,
    currentPhaseId: 'verify',
    currentPhaseIndex: 0,
    phases: [phase],
    phaseRecords: {
      verify: {
        phaseId: 'verify',
        kind: 'runtime_verify_phase',
        status: 'failed',
        attempts: 1,
        nodeId: 'verify-step',
        executionId: 'execution-old',
        runId: 'run-old',
        detail: 'stale execution',
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
    },
    state: {
      forceRestartPhaseIds: ['verify'],
      phaseRequestKeys: {
        verify: 'verify-restart',
      },
    },
    cancelRequested: false,
    startedAt: now,
    updatedAt: now,
  };
  const service = new WorkflowManagedFlowService(
    {
      workflowExecution: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'execution-new'
            ? {
                id: 'execution-new',
                status: 'running',
                startedAt: new Date(now),
                endedAt: null,
              }
            : {
                id: 'execution-old',
                status: 'running',
                startedAt: new Date(now),
                endedAt: null,
              },
      },
      agentRun: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'run-new'
            ? {
                executionId: 'execution-new',
              }
            : {
                id: 'run-old',
                executionId: 'execution-old',
                status: 'completed',
                outputText: 'stale output',
                startedAt: new Date(now),
                endedAt: new Date(now),
              },
      },
    } as never,
    {} as never,
    {} as never,
    {
      spawn: async (_sessionId: string, body: { newExecution?: boolean; requestId?: string }) => {
        spawns.push(body);
        return {
          data: {
            agentRunId: 'run-new',
          },
        };
      },
    } as never,
    {} as never,
  );
  (service as unknown as { phaseSelection: () => { type: 'cursor_agent'; role: 'builder' } }).phaseSelection = () => ({
    type: 'cursor_agent',
    role: 'builder',
  });
  (service as unknown as { phaseSeedNodeIds: () => string[] }).phaseSeedNodeIds = () => ['verify-step'];
  (service as unknown as { writeFlowState: (next: WorkflowManagedFlowState) => Promise<WorkflowManagedFlowState> }).writeFlowState =
    async (next) => {
      saved = next;
      return next;
    };

  const result = await (
    service as unknown as {
      advanceExecutionPhase: (
        state: WorkflowManagedFlowState,
        snapshot: GraphSnapshot,
        phase: Extract<WorkflowManagedFlowPhase, { kind: 'runtime_verify_phase' }>,
        session: SessionRow,
      ) => Promise<'continue' | 'yield' | 'stop'>;
    }
  ).advanceExecutionPhase(state, { nodes: [], edges: [] } as unknown as GraphSnapshot, phase, {
    id: 'session-1',
    workspaceParentDirectory: null,
    workspaceDirectoryName: null,
  });

  assert.equal(result, 'yield');
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]?.newExecution, true);
  assert.equal(spawns[0]?.requestId, 'workflow-flow:flow-1:verify-restart:verify:2');
  assert.deepEqual(spawns[0]?.managedContract, {
    phaseKind: 'runtime_verify_phase',
    expectedOutputs: ['outputs/verify.txt'],
    validatorNodeId: 'verify-validator',
  });
  assert.equal(saved?.phaseRecords.verify?.executionId, 'execution-new');
  assert.equal(saved?.phaseRecords.verify?.runId, 'run-new');
  assert.deepEqual(
    (saved?.state as { forceRestartPhaseIds?: string[] } | undefined)?.forceRestartPhaseIds,
    undefined,
  );
});

test('phaseSeedNodeIds keeps execution prompts local to the current phase', () => {
  const service = new WorkflowManagedFlowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const snapshot = buildSnapshot(
    [
      node({
        id: 'flow-node',
        type: 'managed_flow',
        creator: { type: 'human', userId: 'u1' },
        content: {
          phases: [
            { id: 'prep', kind: 'agent_phase', nodeId: 'prep-step' },
            { id: 'publish', kind: 'agent_phase', nodeId: 'publish-step' },
          ],
        },
      }),
      node({
        id: 'prep-step',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        metadata: { brief: 'Prepare the image catalog.' },
      }),
      node({
        id: 'publish-step',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        metadata: { brief: 'Publish the final listing.' },
      }),
      node({
        id: 'brand-file',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Brand brief',
          relativePath: 'inputs/brand-brief.md',
          pathMode: 'static',
          role: 'input',
          origin: 'user_upload',
          kind: 'text',
          transferMode: 'reference',
          status: 'ready',
        },
      }),
      node({
        id: 'task-file',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Task brief',
          relativePath: 'inputs/task-brief.md',
          pathMode: 'static',
          role: 'input',
          origin: 'user_upload',
          kind: 'text',
          transferMode: 'reference',
          status: 'ready',
        },
      }),
      node({
        id: 'source-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'image_source_dir',
          label: 'Source image directory',
          accepts: ['text'],
          required: true,
        },
      }),
      node({
        id: 'source-bound',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'bound',
          templateNodeId: 'source-template',
          key: 'image_source_dir',
          label: 'Source image directory',
          accepts: ['text'],
          required: true,
          parts: [{ type: 'text', text: '/Users/test/downloads/sample-images' }],
        },
      }),
      node({
        id: 'prep-validator',
        type: 'decision',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'workspace_validator',
          checks: [],
          requirements: [],
          evidenceFrom: [],
          passAction: 'pass',
          failAction: 'retry_new_execution',
          blockAction: 'block',
        },
      }),
      node({
        id: 'product-manifest',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Product manifest',
          relativePath: 'outputs/product-manifest.json',
          pathMode: 'static',
          role: 'intermediate',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'product-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'product_item',
          label: 'Product item',
          accepts: ['text'],
          required: true,
        },
      }),
      node({
        id: 'publish-loop',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: {
            kind: 'input_parts',
            templateNodeId: 'product-template',
          },
          bodyNodeId: 'publish-subgraph',
          advancePolicy: 'only_on_pass',
          sessionPolicy: {
            withinItem: 'reuse_execution',
            betweenItems: 'new_execution',
          },
          blockedPolicy: 'pause_controller',
        },
      }),
      node({
        id: 'publish-subgraph',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
          entryNodeId: 'chunk-step',
        },
      }),
      node({
        id: 'chunk-step',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        metadata: { brief: 'Create listing assets.' },
      }),
      node({
        id: 'listing-md',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Listing markdown',
          relativePath: 'outputs/listing.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'listing-json',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Listing JSON',
          relativePath: 'outputs/listing.json',
          pathMode: 'per_run',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
    ],
    [
      edge({
        id: 'edge-flow-prep',
        source: 'flow-node',
        target: 'prep-step',
        relation: 'contains',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-flow-publish',
        source: 'flow-node',
        target: 'publish-step',
        relation: 'contains',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-brand-prep',
        source: 'brand-file',
        target: 'prep-step',
        relation: 'references',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-brand-publish',
        source: 'brand-file',
        target: 'publish-step',
        relation: 'references',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-task-prep',
        source: 'task-file',
        target: 'prep-step',
        relation: 'references',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-source-prep',
        source: 'source-template',
        target: 'prep-step',
        relation: 'feeds_into',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-source-bound',
        source: 'source-bound',
        target: 'source-template',
        relation: 'derived_from',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-validator-prep',
        source: 'prep-validator',
        target: 'prep-step',
        relation: 'validates',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-prep-manifest',
        source: 'prep-step',
        target: 'product-manifest',
        relation: 'produces',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-manifest-template',
        source: 'product-manifest',
        target: 'product-template',
        relation: 'feeds_into',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-template-loop',
        source: 'product-template',
        target: 'publish-loop',
        relation: 'feeds_into',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-loop-subgraph',
        source: 'publish-loop',
        target: 'publish-subgraph',
        relation: 'contains',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-subgraph-step',
        source: 'publish-subgraph',
        target: 'chunk-step',
        relation: 'contains',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-chunk-md',
        source: 'chunk-step',
        target: 'listing-md',
        relation: 'produces',
        direction: 'source_to_target',
      }),
      edge({
        id: 'edge-chunk-json',
        source: 'chunk-step',
        target: 'listing-json',
        relation: 'produces',
        direction: 'source_to_target',
      }),
    ],
  );

  const seedNodeIds = (
    service as unknown as {
      phaseSeedNodeIds: (graph: GraphSnapshot, nodeId: string) => string[];
    }
  ).phaseSeedNodeIds(snapshot, 'prep-step');

  assert.deepEqual([...seedNodeIds].sort(), [
    'brand-file',
    'prep-step',
    'prep-validator',
    'product-manifest',
    'source-bound',
    'source-template',
    'task-file',
  ].sort());
});
