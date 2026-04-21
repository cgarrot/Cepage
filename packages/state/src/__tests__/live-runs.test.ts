import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRun, GraphNode, WorkflowExecution } from '@cepage/shared-core';
import { deriveLiveRuns } from '../live-runs.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function run(input: Partial<AgentRun> & Pick<AgentRun, 'id' | 'type' | 'status' | 'rootNodeId'>): AgentRun {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    executionId: input.executionId,
    requestId: input.requestId,
    type: input.type,
    role: input.role ?? 'builder',
    runtime: input.runtime ?? { kind: 'local_process', cwd: '/tmp/cepage-live' },
    wakeReason: input.wakeReason ?? 'human_prompt',
    status: input.status,
    startedAt: input.startedAt ?? '2026-04-03T10:00:00.000Z',
    endedAt: input.endedAt,
    updatedAt: input.updatedAt,
    seedNodeIds: input.seedNodeIds ?? ['human-1'],
    rootNodeId: input.rootNodeId,
    triggerNodeId: input.triggerNodeId,
    stepNodeId: input.stepNodeId,
    retryOfRunId: input.retryOfRunId,
    parentAgentId: input.parentAgentId,
    parentRunId: input.parentRunId,
    model: input.model,
    externalSessionId: input.externalSessionId,
    providerMetadata: input.providerMetadata,
    lastSeenEventId: input.lastSeenEventId,
    outputText: input.outputText,
    isStreaming: input.isStreaming,
  };
}

function execution(
  input: Partial<WorkflowExecution> & Pick<WorkflowExecution, 'id' | 'type' | 'status'>,
): WorkflowExecution {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    type: input.type,
    role: input.role ?? 'builder',
    runtime: input.runtime ?? { kind: 'local_process', cwd: '/tmp/cepage-live' },
    wakeReason: input.wakeReason ?? 'manual',
    status: input.status,
    startedAt: input.startedAt ?? '2026-04-03T10:00:00.000Z',
    endedAt: input.endedAt,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    seedNodeIds: input.seedNodeIds ?? ['human-1'],
    triggerNodeId: input.triggerNodeId,
    stepNodeId: input.stepNodeId,
    currentRunId: input.currentRunId,
    latestRunId: input.latestRunId,
    model: input.model,
  };
}

test('deriveLiveRuns keeps the active run context and output details', () => {
  const source = node({
    id: 'human-1',
    type: 'human_message',
    creator: { type: 'human', userId: 'u1' },
    content: { text: 'Fix the sidebar' },
  });
  const spawn = node({
    id: 'spawn-1',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
    content: {
      agentType: 'opencode',
      config: {
        workingDirectory: '/tmp/cepage-live',
        contextNodeIds: ['human-1'],
      },
    },
  });
  const output = node({
    id: 'output-1',
    type: 'agent_output',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
    updatedAt: '2026-04-03T10:01:00.000Z',
    content: {
      output: 'thinking...\nupdated sidebar',
      outputType: 'stdout',
      isStreaming: true,
    },
  });

  const runs = deriveLiveRuns(
    [source, spawn, output],
    [
      { source: 'human-1', target: 'spawn-1', relation: 'spawns' },
      { source: 'spawn-1', target: 'output-1', relation: 'produces' },
    ],
    {
      'run-1': run({
        id: 'run-1',
        type: 'opencode',
        status: 'running',
        rootNodeId: 'spawn-1',
      }),
    },
    {},
    null,
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, 'run-1');
  assert.equal(runs[0]?.sourceNodeId, 'human-1');
  assert.equal(runs[0]?.rootNodeId, 'spawn-1');
  assert.equal(runs[0]?.outputNodeId, 'output-1');
  assert.equal(runs[0]?.workspacePath, '/tmp/cepage-live');
  assert.equal(runs[0]?.status, 'running');
  assert.equal(runs[0]?.isActive, true);
  assert.equal(runs[0]?.output, 'thinking...\nupdated sidebar');
});

test('deriveLiveRuns rebuilds active state from graph snapshot without agent events', () => {
  const spawn = node({
    id: 'spawn-2',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'cursor_agent', agentId: 'run-2' },
    content: {
      agentType: 'cursor_agent',
      config: {
        workingDirectory: '/tmp/cepage-reload',
        contextNodeIds: ['note-1', 'note-2'],
      },
    },
  });
  const output = node({
    id: 'output-2',
    type: 'agent_output',
    creator: { type: 'agent', agentType: 'cursor_agent', agentId: 'run-2' },
    updatedAt: '2026-04-03T10:02:00.000Z',
    content: {
      output: '',
      outputType: 'stdout',
      isStreaming: true,
    },
  });

  const runs = deriveLiveRuns(
    [spawn, output],
    [{ source: 'spawn-2', target: 'output-2', relation: 'produces' }],
    {},
    {},
    null,
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, 'run-2');
  assert.equal(runs[0]?.status, 'running');
  assert.equal(runs[0]?.isActive, true);
  assert.equal(runs[0]?.workspacePath, '/tmp/cepage-reload');
  assert.deepEqual(runs[0]?.seedNodeIds, ['note-1', 'note-2']);
});

test('deriveLiveRuns prefers the spawn content agent type after an in-place rerun', () => {
  const spawn = node({
    id: 'spawn-3',
    type: 'agent_spawn',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-3' },
    content: {
      agentType: 'cursor_agent',
      config: {
        workingDirectory: '/tmp/cepage-rerun',
        contextNodeIds: ['human-1'],
      },
    },
  });
  const output = node({
    id: 'output-3',
    type: 'agent_output',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'run-3' },
    content: {
      output: 'rerun output',
      outputType: 'stdout',
      isStreaming: false,
    },
  });

  const runs = deriveLiveRuns(
    [spawn, output],
    [{ source: 'spawn-3', target: 'output-3', relation: 'produces' }],
    {},
    {},
    null,
  );

  assert.equal(runs[0]?.type, 'cursor_agent');
});

test('deriveLiveRuns rebuilds execution-backed runs without runtime graph nodes', () => {
  const runs = deriveLiveRuns(
    [],
    [],
    {
      'run-4': run({
        id: 'run-4',
        executionId: 'exec-1',
        type: 'cursor_agent',
        status: 'running',
        rootNodeId: 'step-1',
        triggerNodeId: 'input-1',
        stepNodeId: 'step-1',
        seedNodeIds: ['input-1'],
        runtime: { kind: 'local_process', cwd: '/tmp/cepage-exec' },
        outputText: 'streaming output',
        isStreaming: true,
        startedAt: '2026-04-03T10:05:00.000Z',
        updatedAt: '2026-04-03T10:06:00.000Z',
      }),
    },
    {
      'exec-1': execution({
        id: 'exec-1',
        type: 'cursor_agent',
        status: 'running',
        triggerNodeId: 'input-1',
        stepNodeId: 'step-1',
        currentRunId: 'run-4',
        latestRunId: 'run-4',
        runtime: { kind: 'local_process', cwd: '/tmp/cepage-exec' },
        seedNodeIds: ['input-1'],
        startedAt: '2026-04-03T10:05:00.000Z',
        updatedAt: '2026-04-03T10:06:00.000Z',
      }),
    },
    null,
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, 'run-4');
  assert.equal(runs[0]?.executionId, 'exec-1');
  assert.equal(runs[0]?.rootNodeId, 'step-1');
  assert.equal(runs[0]?.triggerNodeId, 'input-1');
  assert.equal(runs[0]?.stepNodeId, 'step-1');
  assert.equal(runs[0]?.workspacePath, '/tmp/cepage-exec');
  assert.equal(runs[0]?.output, 'streaming output');
  assert.equal(runs[0]?.isStreaming, true);
  assert.equal(runs[0]?.isActive, true);
});

test('deriveLiveRuns does not keep terminal execution runs active when isStreaming is stale', () => {
  const runs = deriveLiveRuns(
    [],
    [],
    {
      'run-5': run({
        id: 'run-5',
        executionId: 'exec-5',
        type: 'cursor_agent',
        status: 'failed',
        rootNodeId: 'step-5',
        triggerNodeId: 'input-5',
        stepNodeId: 'step-5',
        runtime: { kind: 'local_process', cwd: '/tmp/cepage-stale-stream' },
        isStreaming: true,
        startedAt: '2026-04-03T10:05:00.000Z',
        updatedAt: '2026-04-03T10:06:00.000Z',
        endedAt: '2026-04-03T10:06:00.000Z',
      }),
    },
    {
      'exec-5': execution({
        id: 'exec-5',
        type: 'cursor_agent',
        status: 'failed',
        triggerNodeId: 'input-5',
        stepNodeId: 'step-5',
        currentRunId: 'run-5',
        latestRunId: 'run-5',
        runtime: { kind: 'local_process', cwd: '/tmp/cepage-stale-stream' },
        seedNodeIds: ['input-5'],
        startedAt: '2026-04-03T10:05:00.000Z',
        updatedAt: '2026-04-03T10:06:00.000Z',
        endedAt: '2026-04-03T10:06:00.000Z',
      }),
    },
    null,
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, 'failed');
  assert.equal(runs[0]?.isStreaming, true);
  assert.equal(runs[0]?.isActive, false);
});

test('deriveLiveRuns keeps orchestrator executions visible for loop controllers', () => {
  const loop = node({
    id: 'loop-1',
    type: 'loop',
    creator: { type: 'human', userId: 'u1' },
    content: {
      mode: 'for_each',
      source: {
        kind: 'inline_list',
        items: ['chunk-1', 'chunk-2'],
      },
      bodyNodeId: 'step-1',
      advancePolicy: 'only_on_pass',
      sessionPolicy: {
        withinItem: 'reuse_execution',
        betweenItems: 'new_execution',
      },
      blockedPolicy: 'pause_controller',
    },
    metadata: {
      controller: {
        id: 'ctl-1',
        status: 'running',
        currentIndex: 0,
        totalItems: 2,
        currentItemLabel: 'chunk-1',
      },
    },
  });

  const runs = deriveLiveRuns(
    [loop],
    [],
    {},
    {
      'exec-loop': execution({
        id: 'exec-loop',
        type: 'orchestrator',
        status: 'running',
        triggerNodeId: 'loop-1',
        stepNodeId: 'loop-1',
        runtime: { kind: 'local_process', cwd: '/tmp/cepage-controller' },
        seedNodeIds: ['loop-1'],
        startedAt: '2026-04-03T10:07:00.000Z',
        updatedAt: '2026-04-03T10:08:00.000Z',
      }),
    },
    null,
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.executionId, 'exec-loop');
  assert.equal(runs[0]?.rootNodeId, 'loop-1');
  assert.equal(runs[0]?.triggerNodeId, 'loop-1');
  assert.equal(runs[0]?.type, 'orchestrator');
  assert.equal(runs[0]?.workspacePath, '/tmp/cepage-controller');
  assert.equal(runs[0]?.isActive, true);
});
