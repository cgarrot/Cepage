import type {
  AgentModelRef,
  AgentRun,
  GraphEdge,
  GraphNode,
  SessionWorkspace,
  WorkflowExecution,
} from '@cepage/shared-core';
import { formatAgentSelectionLabel } from '@cepage/shared-core';
import type { LiveRunDescriptor } from './workspace-types';

type GraphEdgeLink = Pick<GraphEdge, 'source' | 'target' | 'relation'>;

const ACTIVE_RUN_STATUSES = new Set<AgentRun['status']>([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNodeRunId(node: GraphNode | undefined): string | undefined {
  if (!node || node.creator.type !== 'agent') return undefined;
  return node.creator.agentId;
}

function readNodeAgentType(node: GraphNode | undefined): AgentRun['type'] | undefined {
  if (!node) return undefined;
  const agentType = readString((node.content as { agentType?: unknown }).agentType);
  if (agentType) {
    return agentType as AgentRun['type'];
  }
  if (node.creator.type === 'agent') {
    return node.creator.agentType as AgentRun['type'];
  }
  return undefined;
}

function readNodeModel(node: GraphNode | undefined): AgentModelRef | undefined {
  const model = (node?.content as { model?: unknown } | undefined)?.model;
  if (!model || typeof model !== 'object') return undefined;
  const providerID = readString((model as { providerID?: unknown }).providerID);
  const modelID = readString((model as { modelID?: unknown }).modelID);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function readSeedNodeIds(run: AgentRun | undefined, rootNode: GraphNode | undefined): string[] {
  if (run) return run.seedNodeIds.filter(Boolean);
  const ids = (rootNode?.content as { config?: { contextNodeIds?: unknown } } | undefined)?.config?.contextNodeIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function resolveRunUpdateAt(run: AgentRun | undefined): string | undefined {
  return run?.updatedAt ?? run?.endedAt ?? run?.startedAt;
}

function isActiveStatus(status: AgentRun['status']): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

function pickCurrentRun(
  runs: readonly AgentRun[],
  execution: WorkflowExecution | undefined,
): AgentRun | undefined {
  const byId = new Map(runs.map((run) => [run.id, run]));
  if (execution?.currentRunId && byId.has(execution.currentRunId)) {
    return byId.get(execution.currentRunId);
  }
  if (execution?.latestRunId && byId.has(execution.latestRunId)) {
    return byId.get(execution.latestRunId);
  }
  const active = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active) {
    return active;
  }
  return [...runs].sort((a, b) => (resolveRunUpdateAt(b) ?? '').localeCompare(resolveRunUpdateAt(a) ?? ''))[0];
}

function buildExecutionLabel(
  execution: WorkflowExecution | undefined,
  run: AgentRun | undefined,
): string {
  const type = run?.type ?? execution?.type ?? 'opencode';
  return formatAgentSelectionLabel(type, run?.model ?? execution?.model);
}

function resolveExecutionLastUpdate(
  execution: WorkflowExecution | undefined,
  run: AgentRun | undefined,
): string {
  return (
    resolveRunUpdateAt(run) ??
    execution?.updatedAt ??
    execution?.endedAt ??
    execution?.startedAt ??
    new Date(0).toISOString()
  );
}

function deriveExecutionRuns(
  runIndex: Readonly<Record<string, AgentRun>>,
  executionIndex: Readonly<Record<string, WorkflowExecution>>,
  sessionWorkspace: SessionWorkspace | null,
): LiveRunDescriptor[] {
  const runsByExecution = new Map<string, AgentRun[]>();
  for (const run of Object.values(runIndex)) {
    if (!run.executionId) continue;
    const queue = runsByExecution.get(run.executionId) ?? [];
    queue.push(run);
    runsByExecution.set(run.executionId, queue);
  }

  const executionIds = new Set([
    ...Object.keys(executionIndex),
    ...runsByExecution.keys(),
  ]);
  const liveRuns: LiveRunDescriptor[] = [];

  for (const executionId of executionIds) {
    const execution = executionIndex[executionId];
    const runs = runsByExecution.get(executionId) ?? [];
    const run = pickCurrentRun(runs, execution);
    if (!execution && !run) continue;
    const type = run?.type ?? execution?.type ?? 'opencode';
    const status = run?.status ?? execution?.status ?? 'pending';
    const workspacePath =
      readWorkspacePath(run, undefined, sessionWorkspace) ??
      readString((execution?.runtime as { cwd?: unknown } | undefined)?.cwd) ??
      sessionWorkspace?.workingDirectory;
    const output = run?.outputText ?? '';
    const isStreaming = run?.isStreaming === true;
    const isActive = isActiveStatus(status);
    liveRuns.push({
      id: run?.id ?? executionId,
      executionId,
      type,
      status,
      agentLabel: buildExecutionLabel(execution, run),
      ...(run?.model ?? execution?.model ? { model: run?.model ?? execution?.model } : {}),
      ...(workspacePath ? { workspacePath } : {}),
      ...(run?.rootNodeId ? { rootNodeId: run.rootNodeId } : execution?.stepNodeId ? { rootNodeId: execution.stepNodeId } : execution?.triggerNodeId ? { rootNodeId: execution.triggerNodeId } : {}),
      ...(run?.triggerNodeId ?? execution?.triggerNodeId
        ? {
            triggerNodeId: run?.triggerNodeId ?? execution?.triggerNodeId,
            sourceNodeId: run?.triggerNodeId ?? execution?.triggerNodeId,
          }
        : {}),
      ...(run?.stepNodeId ?? execution?.stepNodeId ? { stepNodeId: run?.stepNodeId ?? execution?.stepNodeId } : {}),
      seedNodeIds: run?.seedNodeIds ?? execution?.seedNodeIds ?? [],
      output,
      isStreaming,
      isActive,
      ...(run?.startedAt ?? execution?.startedAt ? { startedAt: run?.startedAt ?? execution?.startedAt } : {}),
      ...(run?.endedAt ?? execution?.endedAt ? { endedAt: run?.endedAt ?? execution?.endedAt } : {}),
      lastUpdateAt: resolveExecutionLastUpdate(execution, run),
    });
  }

  liveRuns.sort((a, b) => {
    if (a.isActive !== b.isActive) return Number(b.isActive) - Number(a.isActive);
    return b.lastUpdateAt.localeCompare(a.lastUpdateAt);
  });
  return liveRuns;
}

function readWorkspacePath(
  run: AgentRun | undefined,
  rootNode: GraphNode | undefined,
  sessionWorkspace: SessionWorkspace | null,
): string | undefined {
  const cwd = readString((run?.runtime as { cwd?: unknown } | undefined)?.cwd);
  if (cwd) return cwd;
  const rootPath = readString(
    (rootNode?.content as { config?: { workingDirectory?: unknown } } | undefined)?.config?.workingDirectory,
  );
  if (rootPath) return rootPath;
  return sessionWorkspace?.workingDirectory;
}

function readOutput(node: GraphNode | undefined): string {
  if (!node) return '';
  return (
    readString((node.content as { output?: unknown }).output) ??
    readString((node.content as { text?: unknown }).text) ??
    ''
  );
}

function readOutputStreaming(node: GraphNode | undefined): boolean {
  return readBoolean((node?.content as { isStreaming?: unknown } | undefined)?.isStreaming) === true;
}

function fallbackStatus(rootNode: GraphNode | undefined, outputNode: GraphNode | undefined): AgentRun['status'] {
  if (readOutputStreaming(outputNode)) return 'running';
  if (outputNode) return 'completed';
  if (rootNode) return 'booting';
  return 'pending';
}

function resolveLastUpdateAt(
  run: AgentRun | undefined,
  rootNode: GraphNode | undefined,
  outputNode: GraphNode | undefined,
): string {
  const values = [
    run?.endedAt,
    outputNode?.updatedAt,
    rootNode?.updatedAt,
    run?.startedAt,
    outputNode?.createdAt,
    rootNode?.createdAt,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return values.sort((a, b) => b.localeCompare(a))[0] ?? new Date(0).toISOString();
}

function buildRunAgentLabel(agentType: AgentRun['type'], model: AgentModelRef | undefined): string {
  return formatAgentSelectionLabel(agentType, model);
}

export function deriveLiveRuns(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdgeLink[],
  runIndex: Readonly<Record<string, AgentRun>>,
  executionIndex: Readonly<Record<string, WorkflowExecution>>,
  sessionWorkspace: SessionWorkspace | null,
): LiveRunDescriptor[] {
  const executionRuns = deriveExecutionRuns(runIndex, executionIndex, sessionWorkspace);
  const handledRunIds = new Set(
    executionRuns
      .map((run) => run.id)
      .filter((id) => Object.prototype.hasOwnProperty.call(runIndex, id)),
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootByRunId = new Map<string, GraphNode>();
  const outputByRunId = new Map<string, GraphNode>();
  const outputByRootId = new Map<string, string>();
  const rootByOutputId = new Map<string, string>();
  const sourceByRootId = new Map<string, string>();
  const runIds = new Set(Object.keys(runIndex).filter((runId) => !handledRunIds.has(runId)));

  for (const edge of edges) {
    if (edge.relation === 'produces') {
      outputByRootId.set(edge.source, edge.target);
      rootByOutputId.set(edge.target, edge.source);
    }
    if (edge.relation === 'spawns') {
      sourceByRootId.set(edge.target, edge.source);
    }
  }

  for (const node of nodes) {
    const runId = readNodeRunId(node);
    if (!runId) continue;
    runIds.add(runId);
    if (node.type === 'agent_spawn') rootByRunId.set(runId, node);
    if (node.type === 'agent_output') outputByRunId.set(runId, node);
  }

  const runs: LiveRunDescriptor[] = [];

  for (const runId of runIds) {
    const run = runIndex[runId];
    let rootNode = rootByRunId.get(runId);
    let outputNode = outputByRunId.get(runId);
    let rootNodeId: string | undefined = run?.rootNodeId ?? rootNode?.id;

    if (!rootNodeId && outputNode) {
      rootNodeId = rootByOutputId.get(outputNode.id);
    }
    if (!rootNode && rootNodeId) {
      rootNode = nodeById.get(rootNodeId);
    }

    let outputNodeId: string | undefined = outputNode?.id;
    if (!outputNodeId && rootNodeId) {
      outputNodeId = outputByRootId.get(rootNodeId);
    }
    if (!outputNode && outputNodeId) {
      outputNode = nodeById.get(outputNodeId);
    }

    if (!rootNode && !outputNode && !run) {
      continue;
    }

    const model = run?.model ?? readNodeModel(rootNode) ?? readNodeModel(outputNode);
    const type =
      run?.type ??
      readNodeAgentType(rootNode) ??
      readNodeAgentType(outputNode) ??
      'opencode';
    const status = run?.status ?? fallbackStatus(rootNode, outputNode);
    const isStreaming = readOutputStreaming(outputNode);
    const isActive = isActiveStatus(status);
    const next: LiveRunDescriptor = {
      id: runId,
      type,
      status,
      agentLabel: buildRunAgentLabel(type, model),
      workspacePath: readWorkspacePath(run, rootNode, sessionWorkspace),
      seedNodeIds: readSeedNodeIds(run, rootNode),
      output: readOutput(outputNode),
      isStreaming,
      isActive,
      lastUpdateAt: resolveLastUpdateAt(run, rootNode, outputNode),
    };

    if (model) next.model = model;
    if (rootNodeId) next.rootNodeId = rootNodeId;
    if (outputNodeId) next.outputNodeId = outputNodeId;
    const sourceNodeId = rootNodeId ? sourceByRootId.get(rootNodeId) : undefined;
    if (sourceNodeId) next.sourceNodeId = sourceNodeId;
    const startedAt = run?.startedAt ?? rootNode?.createdAt ?? outputNode?.createdAt;
    if (startedAt) next.startedAt = startedAt;
    if (run?.endedAt) next.endedAt = run.endedAt;

    runs.push(next);
  }

  runs.sort((a, b) => {
    if (a.isActive !== b.isActive) return Number(b.isActive) - Number(a.isActive);
    return b.lastUpdateAt.localeCompare(a.lastUpdateAt);
  });

  return [...executionRuns, ...runs].sort((a, b) => {
    if (a.isActive !== b.isActive) return Number(b.isActive) - Number(a.isActive);
    return b.lastUpdateAt.localeCompare(a.lastUpdateAt);
  });
}
