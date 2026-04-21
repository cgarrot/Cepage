import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type {
  GraphNode,
  GraphSnapshot,
  WorkflowControllerState,
  WorkflowSubgraphContent,
} from '@cepage/shared-core';
import { WorkflowControllerService } from '../workflow-controller.service.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-07T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function controllerState(
  input: Partial<WorkflowControllerState> & Pick<WorkflowControllerState, 'id' | 'status'>,
): WorkflowControllerState {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    controllerNodeId: input.controllerNodeId ?? 'loop-1',
    parentExecutionId: input.parentExecutionId,
    executionId: input.executionId ?? 'exec-parent',
    currentChildExecutionId: input.currentChildExecutionId,
    currentChildRunId: input.currentChildRunId,
    status: input.status,
    mode: input.mode ?? 'for_each',
    sourceKind: input.sourceKind ?? 'inline_list',
    currentIndex: input.currentIndex ?? 0,
    totalItems: input.totalItems ?? 1,
    attemptsTotal: input.attemptsTotal ?? 1,
    lastDecision: input.lastDecision,
    lastDecisionDetail: input.lastDecisionDetail,
    completedSummaries: input.completedSummaries ?? [],
    items: input.items ?? [
      {
        index: 0,
        key: 'chunk-1',
        label: 'Chunk 1',
        status: 'running',
        attempts: 1,
      },
    ],
    data: input.data ?? {
      itemValues: {
        'chunk-1': {
          value: 'Bootstrap the app',
          text: 'Bootstrap the app',
        },
      },
    },
    startedAt: input.startedAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-07T10:00:00.000Z',
    endedAt: input.endedAt,
  };
}

function controllerRow(state: WorkflowControllerState): {
  id: string;
  sessionId: string;
  controllerNodeId: string;
  parentExecutionId: string | null;
  executionId: string | null;
  currentChildExecutionId: string | null;
  mode: WorkflowControllerState['mode'];
  sourceKind: WorkflowControllerState['sourceKind'];
  status: WorkflowControllerState['status'];
  state: unknown;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
} {
  return {
    id: state.id,
    sessionId: state.sessionId,
    controllerNodeId: state.controllerNodeId,
    parentExecutionId: state.parentExecutionId ?? null,
    executionId: state.executionId ?? null,
    currentChildExecutionId: state.currentChildExecutionId ?? null,
    mode: state.mode,
    sourceKind: state.sourceKind,
    status: state.status,
    state: {
      ...(state.currentIndex != null ? { currentIndex: state.currentIndex } : {}),
      ...(state.totalItems != null ? { totalItems: state.totalItems } : {}),
      attemptsTotal: state.attemptsTotal,
      ...(state.lastDecision ? { lastDecision: state.lastDecision } : {}),
      ...(state.lastDecisionDetail ? { lastDecisionDetail: state.lastDecisionDetail } : {}),
      ...(state.currentChildRunId ? { currentChildRunId: state.currentChildRunId } : {}),
      completedSummaries: state.completedSummaries,
      items: state.items,
      data: state.data,
    },
    startedAt: new Date(state.startedAt),
    endedAt: state.endedAt ? new Date(state.endedAt) : null,
    updatedAt: new Date(state.updatedAt),
  };
}

function loopContent() {
  return {
    mode: 'for_each' as const,
    source: {
      kind: 'inline_list' as const,
      items: ['chunk-1'],
    },
    bodyNodeId: 'subgraph-1',
    advancePolicy: 'only_on_pass' as const,
    sessionPolicy: {
      withinItem: 'reuse_execution' as const,
      betweenItems: 'new_execution' as const,
    },
    maxAttemptsPerItem: 3,
    blockedPolicy: 'pause_controller' as const,
    itemLabel: 'chunk',
  };
}

function session(root: string) {
  return {
    id: 'session-1',
    workspaceParentDirectory: root,
    workspaceDirectoryName: 'workspace',
  };
}

function emptySnapshot(): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-07T10:00:00.000Z',
    lastEventId: 1,
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('materializeItems exposes the resolved bound input and suspicious single-part chunk list', async () => {
  const service = new WorkflowControllerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await (
    service as unknown as {
      materializeItems: (
        sessionId: string,
        snapshot: GraphSnapshot,
        loop: {
          mode: 'for_each';
          source: { kind: 'input_parts'; templateNodeId: string };
          bodyNodeId: string;
          advancePolicy: 'only_on_pass';
          sessionPolicy: {
            withinItem: 'reuse_execution';
            betweenItems: 'new_execution';
          };
          blockedPolicy: 'pause_controller';
          itemLabel: string;
        },
        cwd: string,
      ) => Promise<{
        items: Array<{ text: string }>;
        source?: {
          resolvedBoundNodeId?: string;
          itemCount: number;
          partCount: number;
          itemHintCount?: number;
          warning?: string;
        };
      }>;
    }
  ).materializeItems(
    'session-1',
    {
      ...emptySnapshot(),
      nodes: [
        node({
          id: 'chunks-template',
          type: 'input',
          creator: { type: 'human', userId: 'u1' },
          content: {
            mode: 'template',
            key: 'chunks',
            label: 'Chunks',
            accepts: ['text'],
            multiple: true,
            required: true,
          },
        }),
        node({
          id: 'bound-1',
          type: 'input',
          creator: { type: 'human', userId: 'u1' },
          content: {
            mode: 'bound',
            templateNodeId: 'chunks-template',
            parts: [
              {
                id: 'part-1',
                type: 'text',
                text: '1. Bootstrap a runnable scaffold\n2. Build the first playable loop\n3. Polish the runtime smoke',
              },
            ],
          },
        }),
      ],
    },
    {
      ...loopContent(),
      source: {
        kind: 'input_parts',
        templateNodeId: 'chunks-template',
      },
    },
    process.cwd(),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.source?.resolvedBoundNodeId, 'bound-1');
  assert.equal(result.source?.partCount, 1);
  assert.equal(result.source?.itemCount, 1);
  assert.equal(result.source?.itemHintCount, 3);
  assert.match(result.source?.warning ?? '', /looks like 3 list items/);
});

test('evaluateChildRun uses stored resolved per-run outputs when the reference snapshot lacks output nodes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-eval-'));
  const filepath = path.join(root, 'workspace', 'outputs', 'run-550e8400', 'chunk-result.md');
  try {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, 'Summary\nCHUNK_COMPLETE');

    const service = new WorkflowControllerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const evaluation = await (
      service as unknown as {
        evaluateChildRun: (input: {
          session: {
            id: string;
            workspaceParentDirectory: string | null;
            workspaceDirectoryName: string | null;
          };
          refSnapshot: GraphSnapshot;
          loop: ReturnType<typeof loopContent>;
          subgraph: WorkflowSubgraphContent;
          validatorNode: { id: string; type: string; content: Record<string, unknown> } | null;
          childStatus: string;
          run: {
            id: string;
            outputText: string | null;
            status: string;
            startedAt: Date;
            endedAt: Date | null;
          } | null;
          outputDefs: Array<{
            nodeId: string;
            relativePath: string;
            resolvedRelativePath: string;
            pathMode: 'per_run';
          }>;
        }) => Promise<{ outcome: string; detail: string }>;
      }
    ).evaluateChildRun({
      session: session(root),
      refSnapshot: emptySnapshot(),
      loop: loopContent(),
      subgraph: {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        expectedOutputs: ['outputs/chunk-result.md'],
      },
      validatorNode: {
        id: 'validator-1',
        type: 'decision',
        content: {
          mode: 'workspace_validator',
          requirements: ['Chunk output must be complete.'],
          evidenceFrom: ['outputs/chunk-result.md'],
          checks: [
            {
              kind: 'file_last_line_equals',
              path: 'outputs/chunk-result.md',
              text: 'CHUNK_COMPLETE',
            },
          ],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      childStatus: 'completed',
      run: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        outputText: 'Chunk completed',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000),
        endedAt: new Date(),
      },
      outputDefs: [
        {
          nodeId: 'output-1',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-550e8400/chunk-result.md',
          pathMode: 'per_run',
        },
      ],
    });

    assert.equal(evaluation.outcome, 'pass');
    assert.equal(evaluation.detail, 'Chunk completed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('evaluateChildRun supports negative workspace validator checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-negative-'));
  try {
    const runId = '550e8400-e29b-41d4-a716-446655440000';
    await fs.mkdir(path.join(root, 'workspace', 'outputs', 'run-550e8400'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'workspace', 'outputs', 'run-550e8400', 'chunk-result.md'),
      'Chunk completed\nCHUNK_COMPLETE\n',
    );

    const service = new WorkflowControllerService(
      {
        agentRun: {
          findUnique: async () => null,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const pass = await (
      service as unknown as {
        evaluateChildRun: (input: {
          session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null };
          refSnapshot: GraphSnapshot;
          loop: ReturnType<typeof loopContent>;
          subgraph: WorkflowSubgraphContent & {
            expectedOutputs?: string[];
          };
          validatorNode: { id: string; type: string; content: Record<string, unknown> };
          childStatus: string;
          run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
          outputDefs: Array<{
            nodeId: string;
            relativePath: string;
            resolvedRelativePath: string;
            pathMode: 'per_run';
          }>;
        }) => Promise<{ outcome: string; detail: string }>;
      }
    ).evaluateChildRun({
      session: session(root),
      refSnapshot: { version: 1, id: 'session-1', createdAt: '2026-04-07T10:00:00.000Z', lastEventId: 1, nodes: [], edges: [], branches: [], viewport: { x: 0, y: 0, zoom: 1 } },
      loop: loopContent(),
      subgraph: {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        expectedOutputs: ['outputs/chunk-result.md'],
      },
      validatorNode: {
        id: 'validator-1',
        type: 'decision',
        content: {
          mode: 'workspace_validator',
          requirements: ['Chunk output must stay clean.'],
          evidenceFrom: ['outputs/chunk-result.md'],
          checks: [
            {
              kind: 'path_not_exists',
              path: 'outputs/listing.json',
            },
            {
              kind: 'file_not_contains',
              path: 'outputs/chunk-result.md',
              text: 'manualFieldsToConfirm',
            },
          ],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      childStatus: 'completed',
      run: {
        id: runId,
        outputText: 'Chunk completed',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000),
        endedAt: new Date(),
      },
      outputDefs: [
        {
          nodeId: 'output-1',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-550e8400/chunk-result.md',
          pathMode: 'per_run',
        },
      ],
    });

    assert.equal(pass.outcome, 'pass');

    await fs.writeFile(path.join(root, 'workspace', 'outputs', 'listing.json'), '{}');
    await fs.writeFile(
      path.join(root, 'workspace', 'outputs', 'run-550e8400', 'chunk-result.md'),
      'Chunk completed\nmanualFieldsToConfirm\nCHUNK_COMPLETE\n',
    );

    const fail = await (
      service as unknown as {
        evaluateChildRun: (input: {
          session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null };
          refSnapshot: GraphSnapshot;
          loop: ReturnType<typeof loopContent>;
          subgraph: WorkflowSubgraphContent & {
            expectedOutputs?: string[];
          };
          validatorNode: { id: string; type: string; content: Record<string, unknown> };
          childStatus: string;
          run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
          outputDefs: Array<{
            nodeId: string;
            relativePath: string;
            resolvedRelativePath: string;
            pathMode: 'per_run';
          }>;
        }) => Promise<{ outcome: string; detail: string }>;
      }
    ).evaluateChildRun({
      session: session(root),
      refSnapshot: { version: 1, id: 'session-1', createdAt: '2026-04-07T10:00:00.000Z', lastEventId: 1, nodes: [], edges: [], branches: [], viewport: { x: 0, y: 0, zoom: 1 } },
      loop: loopContent(),
      subgraph: {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        expectedOutputs: ['outputs/chunk-result.md'],
      },
      validatorNode: {
        id: 'validator-1',
        type: 'decision',
        content: {
          mode: 'workspace_validator',
          requirements: ['Chunk output must stay clean.'],
          evidenceFrom: ['outputs/chunk-result.md'],
          checks: [
            {
              kind: 'path_not_exists',
              path: 'outputs/listing.json',
            },
            {
              kind: 'file_not_contains',
              path: 'outputs/chunk-result.md',
              text: 'manualFieldsToConfirm',
            },
          ],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      childStatus: 'completed',
      run: {
        id: runId,
        outputText: 'Chunk completed',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000),
        endedAt: new Date(),
      },
      outputDefs: [
        {
          nodeId: 'output-1',
          relativePath: 'outputs/chunk-result.md',
          resolvedRelativePath: 'outputs/run-550e8400/chunk-result.md',
          pathMode: 'per_run',
        },
      ],
    });

    assert.equal(fail.outcome, 'retry_same_item');
    assert.match(fail.detail, /path not exists|file not contains/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('handleChildCompletion marks a single-item loop as completed', async () => {
  let saved: WorkflowControllerState | undefined;
  const service = new WorkflowControllerService(
    {
      agentRun: {
        findUnique: async () => null,
      },
    } as never,
    {
      loadSnapshot: async () => emptySnapshot(),
      patchNode: async () => ({ eventId: 11 }),
    } as never,
    {
      log: async () => {},
    } as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { writeControllerState: (state: WorkflowControllerState) => Promise<WorkflowControllerState> }).writeControllerState =
    async (state) => {
      saved = state;
      return state;
    };

  await (
    service as unknown as {
      handleChildCompletion: (
        state: WorkflowControllerState,
        loop: ReturnType<typeof loopContent>,
        subgraph: WorkflowSubgraphContent,
        validatorNode: null,
        session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null },
        refSnapshot: GraphSnapshot,
        bodyNode: { id: string },
        child: { id: string; status: string; latestRunId: string | null; currentRunId: string | null },
      ) => Promise<void>;
    }
  ).handleChildCompletion(
    controllerState({
      id: 'ctl-1',
      status: 'running',
      currentChildExecutionId: 'exec-child',
      totalItems: 1,
    }),
    loopContent(),
    {
      workflowRef: { kind: 'session', sessionId: 'session-1' },
      inputMap: {},
      execution: {},
    },
    null,
    session(process.cwd()),
    emptySnapshot(),
    { id: 'subgraph-1' },
    { id: 'child-1', status: 'completed', latestRunId: null, currentRunId: null },
  );

  assert.equal(saved?.status, 'completed');
  assert.equal(saved?.currentIndex, undefined);
  assert.equal(saved?.items[0]?.status, 'completed');
});

test('handleChildCompletion keeps the current item in retrying when validation asks for another attempt', async () => {
  let saved: WorkflowControllerState | undefined;
  const service = new WorkflowControllerService(
    {
      agentRun: {
        findUnique: async () => null,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { writeControllerState: (state: WorkflowControllerState) => Promise<WorkflowControllerState> }).writeControllerState =
    async (state) => {
      saved = state;
      return state;
    };

  await (
    service as unknown as {
      handleChildCompletion: (
        state: WorkflowControllerState,
        loop: ReturnType<typeof loopContent>,
        subgraph: WorkflowSubgraphContent,
        validatorNode: null,
        session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null },
        refSnapshot: GraphSnapshot,
        bodyNode: { id: string },
        child: { id: string; status: string; latestRunId: string | null; currentRunId: string | null },
      ) => Promise<void>;
    }
  ).handleChildCompletion(
    controllerState({
      id: 'ctl-2',
      status: 'running',
      totalItems: 2,
    }),
    loopContent(),
    {
      workflowRef: { kind: 'session', sessionId: 'session-1' },
      inputMap: {},
      execution: {},
    },
    null,
    session(process.cwd()),
    emptySnapshot(),
    { id: 'subgraph-1' },
    { id: 'child-1', status: 'failed', latestRunId: null, currentRunId: null },
  );

  assert.equal(saved?.status, 'retrying');
  assert.equal(saved?.items[0]?.status, 'retrying');
  assert.equal(
    (saved?.data as { retryFeedback?: string } | undefined)?.retryFeedback,
    'child run failed',
  );
});

test('handleChildCompletion blocks the controller when the validator requests human help', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-blocked-'));
  let saved: WorkflowControllerState | undefined;
  try {
    const service = new WorkflowControllerService(
      {
        agentRun: {
          findUnique: async () => null,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { writeControllerState: (state: WorkflowControllerState) => Promise<WorkflowControllerState> }).writeControllerState =
      async (state) => {
        saved = state;
        return state;
      };

    await (
      service as unknown as {
        handleChildCompletion: (
          state: WorkflowControllerState,
          loop: ReturnType<typeof loopContent>,
          subgraph: WorkflowSubgraphContent,
          validatorNode: { id: string; type: string; content: Record<string, unknown> },
          session: { id: string; workspaceParentDirectory: string | null; workspaceDirectoryName: string | null },
          refSnapshot: GraphSnapshot,
          bodyNode: { id: string },
          child: { id: string; status: string; latestRunId: string | null; currentRunId: string | null },
        ) => Promise<void>;
      }
    ).handleChildCompletion(
      controllerState({
        id: 'ctl-3',
        status: 'running',
      }),
      loopContent(),
      {
        workflowRef: { kind: 'session', sessionId: 'session-1' },
        inputMap: {},
        execution: {},
        expectedOutputs: ['outputs/chunk-result.md'],
      },
      {
        id: 'validator-1',
        type: 'decision',
        content: {
          mode: 'workspace_validator',
          requirements: ['Chunk output must exist.'],
          evidenceFrom: ['outputs/chunk-result.md'],
          checks: [
            {
              kind: 'path_exists',
              path: 'outputs/chunk-result.md',
            },
          ],
          passAction: 'pass',
          failAction: 'request_human',
          blockAction: 'block',
        },
      },
      session(root),
      emptySnapshot(),
      { id: 'subgraph-1' },
      { id: 'child-1', status: 'completed', latestRunId: null, currentRunId: null },
    );

    assert.equal(saved?.status, 'blocked');
    assert.equal(saved?.items[0]?.status, 'blocked');
    assert.equal(saved?.lastDecision, 'request_human');
    assert.match(saved?.lastDecisionDetail ?? '', /expected output outputs\/chunk-result\.md/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('run restarts a completed loop when forceRestart is true', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-restart-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const snapshot = {
    ...emptySnapshot(),
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: loopContent(),
      }),
      node({
        id: 'subgraph-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
        },
      }),
    ],
  };
  const rows = new Map<string, ReturnType<typeof controllerRow>>();
  const old = controllerState({
    id: 'ctl-old',
    status: 'completed',
    executionId: 'exec-old',
    currentIndex: undefined,
    attemptsTotal: 1,
    totalItems: 1,
    items: [
      {
        index: 0,
        key: 'chunk-1',
        label: 'Chunk 1',
        status: 'completed',
        attempts: 1,
      },
    ],
    endedAt: '2026-04-07T10:05:00.000Z',
    updatedAt: '2026-04-07T10:05:00.000Z',
  });
  rows.set(old.id, controllerRow(old));

  const createdExecutions: string[] = [];
  const service = new WorkflowControllerService(
    {
      session: {
        findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'session-1' ? session(root) : null),
      },
      workflowControllerState: {
        findFirst: async () => rows.get(old.id) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row: ReturnType<typeof controllerRow> = {
            id: data.id as string,
            sessionId: data.sessionId as string,
            controllerNodeId: data.controllerNodeId as string,
            parentExecutionId: (data.parentExecutionId as string | null) ?? null,
            executionId: (data.executionId as string | null) ?? null,
            currentChildExecutionId: (data.currentChildExecutionId as string | null) ?? null,
            mode: data.mode as WorkflowControllerState['mode'],
            sourceKind: data.sourceKind as WorkflowControllerState['sourceKind'],
            status: data.status as WorkflowControllerState['status'],
            state: data.state,
            startedAt: data.startedAt as Date,
            endedAt: null,
            updatedAt: new Date(),
          };
          rows.set(row.id, row);
          return row;
        },
      },
      workflowExecution: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdExecutions.push(data.id as string);
          return { id: data.id as string };
        },
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
      patchNode: async () => ({ eventId: 1 }),
    } as never,
    {} as never,
    { emitSession: () => {} } as never,
    {} as never,
  );
  (service as unknown as { ensureTask: (id: string) => void }).ensureTask = () => {};

  const result = await service.run('session-1', 'loop-1', { forceRestart: true });

  assert.equal(result.launchMode, 'restart');
  assert.notEqual(result.controllerId, old.id);
  assert.equal(createdExecutions.length, 1);
  assert.ok(rows.has(result.controllerId));
  assert.equal(rows.get(result.controllerId)?.status, 'running');
});

test('executeQueuedController yields waiting while the child execution is still active', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-loop-wait-'));
  const state = controllerState({
    id: 'ctl-1',
    status: 'running',
    currentChildExecutionId: 'exec-child',
    currentChildRunId: 'run-child',
  });
  const rows = new Map([[state.id, controllerRow(state)]]);
  const snapshot = {
    ...emptySnapshot(),
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: loopContent(),
      }),
      node({
        id: 'subgraph-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
        },
      }),
    ],
  };
  const service = new WorkflowControllerService(
    {
      session: {
        findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'session-1' ? session(root) : null),
      },
      workflowControllerState: {
        findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      },
      workflowExecution: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'exec-child'
            ? {
                id: 'exec-child',
                status: 'running',
                latestRunId: 'run-child',
                currentRunId: 'run-child',
              }
            : null,
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
    } as never,
    {} as never,
    { emitSession: () => {} } as never,
    {} as never,
  );

  const result = await service.executeQueuedController('ctl-1');

  assert.deepEqual(result, { controllerId: 'ctl-1', status: 'waiting' });
  await fs.rm(root, { recursive: true, force: true });
});

test('notifyAgentStatus requeues the matching controller when a child run finishes', async () => {
  const state = controllerState({
    id: 'ctl-1',
    status: 'running',
    currentChildExecutionId: 'exec-child',
    currentChildRunId: 'run-child',
  });
  const queued: string[] = [];
  const service = new WorkflowControllerService(
    {
      workflowControllerState: {
        findMany: async () => [controllerRow(state)],
      },
    } as never,
    {} as never,
    {} as never,
    { emitSession: () => {} } as never,
    {} as never,
  );
  (service as unknown as { ensureTask: (id: string) => void }).ensureTask = (id: string) => {
    queued.push(id);
  };

  await service.notifyAgentStatus('session-1', {
    id: 'run-child',
    sessionId: 'session-1',
    executionId: 'exec-child',
    type: 'cursor_agent',
    role: 'builder',
    runtime: { kind: 'local_process', cwd: process.cwd() },
    wakeReason: 'manual',
    status: 'completed',
    startedAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:01:00.000Z',
    seedNodeIds: [],
    isStreaming: false,
  } as never);

  assert.deepEqual(queued, ['ctl-1']);
});

test('notifyAgentStatus falls back to the single running controller when child ids drift', async () => {
  const state = controllerState({
    id: 'ctl-1',
    status: 'running',
    currentChildExecutionId: 'exec-expected',
    currentChildRunId: 'run-expected',
  });
  const queued: string[] = [];
  const service = new WorkflowControllerService(
    {
      workflowControllerState: {
        findMany: async () => [controllerRow(state)],
      },
    } as never,
    {} as never,
    {} as never,
    { emitSession: () => {} } as never,
    {} as never,
  );
  (service as unknown as { ensureTask: (id: string) => void }).ensureTask = (id: string) => {
    queued.push(id);
  };

  await service.notifyAgentStatus('session-1', {
    id: 'run-actual',
    sessionId: 'session-1',
    executionId: 'exec-actual',
    type: 'cursor_agent',
    role: 'builder',
    runtime: { kind: 'local_process', cwd: process.cwd() },
    wakeReason: 'manual',
    status: 'completed',
    startedAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:01:00.000Z',
    seedNodeIds: [],
    isStreaming: false,
  } as never);

  assert.deepEqual(queued, ['ctl-1']);
});
