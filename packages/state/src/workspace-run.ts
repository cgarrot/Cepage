import {
  readGraphNodeLockedSelection,
  readWorkflowControllerSummary,
  readWorkflowManagedFlowSummary,
  resolveGraphNodeSelection,
  type AgentSelection,
  type GraphEdge,
  type GraphNode,
} from '@cepage/shared-core';
import type { LiveRunDescriptor } from './workspace-types';

export type NodeRunPlan =
  | { mode: 'spawn'; selection?: NodeRunSelection }
  | { mode: 'open'; runId: string; selection: NodeRunSelection }
  | { mode: 'rerun'; runId: string; selection: NodeRunSelection };

export type NodeRunSelection = AgentSelection;
type EdgeLink = Pick<GraphEdge, 'source' | 'target' | 'relation'>;
export type LoopRunPlan =
  | { mode: 'controller'; nodeId: string }
  | { mode: 'ambiguous'; nodeIds: string[] };

export type WorkflowLaunchPlan = 'run' | 'resume' | 'restart';

function selectionFromRun(run: LiveRunDescriptor): NodeRunSelection {
  return run.model
    ? { type: run.type, model: run.model }
    : { type: run.type };
}

function collectComponent(nodeId: string, edges: readonly EdgeLink[]): Set<string> {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = graph.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    graph.set(edge.source, source);
    const target = graph.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    graph.set(edge.target, target);
  }

  const ids = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    for (const next of graph.get(id) ?? []) {
      if (!ids.has(next)) queue.push(next);
    }
  }
  return ids;
}

function findRun(nodeId: string, runs: readonly LiveRunDescriptor[], edges: readonly EdgeLink[]): LiveRunDescriptor | null {
  const component = collectComponent(nodeId, edges);
  const direct = runs.filter(
    (run) =>
      run.triggerNodeId === nodeId ||
      run.stepNodeId === nodeId ||
      run.rootNodeId === nodeId ||
      run.outputNodeId === nodeId,
  );
  if (direct.length > 0) {
    return [...direct].sort(rankRuns)[0] ?? null;
  }

  const related = runs.filter(
    (run) =>
      (run.triggerNodeId && component.has(run.triggerNodeId)) ||
      (run.stepNodeId && component.has(run.stepNodeId)) ||
      (run.rootNodeId && component.has(run.rootNodeId)) ||
      (run.outputNodeId && component.has(run.outputNodeId)),
  );
  return [...related].sort(rankRuns)[0] ?? null;
}

function rankRuns(a: LiveRunDescriptor, b: LiveRunDescriptor): number {
  if (a.isActive !== b.isActive) {
    return Number(b.isActive) - Number(a.isActive);
  }
  return b.lastUpdateAt.localeCompare(a.lastUpdateAt);
}

export function planNodeRun(
  node: GraphNode | null,
  runs: readonly LiveRunDescriptor[],
  edges: readonly EdgeLink[],
): NodeRunPlan {
  if (!node) return { mode: 'spawn' };
  const run = findRun(node.id, runs, edges);
  if (run?.id) {
    if (run.isActive) {
      return {
        mode: 'open',
        runId: run.id,
        selection: selectionFromRun(run),
      };
    }
    return {
      mode: 'rerun',
      runId: run.id,
      selection: selectionFromRun(run),
    };
  }
  const selection = readNodeSelection(node);
  return selection ? { mode: 'spawn', selection } : { mode: 'spawn' };
}

export function planLoopRun(
  nodeId: string | null | undefined,
  nodes: readonly GraphNode[],
  edges: readonly EdgeLink[],
): LoopRunPlan | null {
  if (!nodeId) return null;
  const component = collectComponent(nodeId, edges);
  const loops = nodes
    .filter((node) => node.type === 'loop' && component.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b));
  if (loops.length === 0) return null;
  if (loops.length === 1) {
    return { mode: 'controller', nodeId: loops[0] ?? nodeId };
  }
  return { mode: 'ambiguous', nodeIds: loops };
}

export function readNodeSelection(node: GraphNode | null): NodeRunSelection | null {
  return node ? readGraphNodeLockedSelection(node) ?? null : null;
}

export function planControllerLaunch(node: GraphNode | null): WorkflowLaunchPlan {
  const summary = node ? readWorkflowControllerSummary(node.metadata) : null;
  if (!summary) {
    return 'run';
  }
  if (summary.status === 'completed' || summary.status === 'failed' || summary.status === 'cancelled') {
    return 'restart';
  }
  return 'resume';
}

export function planManagedFlowLaunch(node: GraphNode | null): WorkflowLaunchPlan {
  const summary = node ? readWorkflowManagedFlowSummary(node.metadata) : null;
  if (!summary) {
    return 'run';
  }
  if (summary.status === 'completed' || summary.status === 'failed' || summary.status === 'cancelled') {
    return 'restart';
  }
  return 'resume';
}

export function resolveNodeSelection(
  nodeId: string | null | undefined,
  nodes: readonly GraphNode[],
  edges: readonly EdgeLink[],
  fallback?: NodeRunSelection | null,
): NodeRunSelection | null {
  return resolveGraphNodeSelection({
    nodeId,
    nodes,
    edges,
    fallback,
  });
}
