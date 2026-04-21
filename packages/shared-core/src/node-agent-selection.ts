import { z } from 'zod';
import type { GraphEdge, GraphNode } from './graph';
import { agentModelRefSchema, agentTypeSchema } from './agent';

export const agentSelectionSchema = z.object({
  type: agentTypeSchema,
  model: agentModelRefSchema.optional(),
});

export type AgentSelection = z.infer<typeof agentSelectionSchema>;

export const nodeAgentSelectionModeSchema = z.enum(['inherit', 'locked']);
export type NodeAgentSelectionMode = z.infer<typeof nodeAgentSelectionModeSchema>;

export const nodeAgentSelectionSchema = z
  .object({
    mode: nodeAgentSelectionModeSchema,
    selection: agentSelectionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'locked' && !value.selection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Locked node selections require a provider/model selection.',
        path: ['selection'],
      });
    }
  });

export type NodeAgentSelection = z.infer<typeof nodeAgentSelectionSchema>;

type EdgeLink = Pick<GraphEdge, 'source' | 'target' | 'relation'>;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cloneSelection(value: AgentSelection | null | undefined): AgentSelection | null {
  if (!value) return null;
  return {
    type: value.type,
    ...(value.model
      ? {
          model: {
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          },
        }
      : {}),
  };
}

function selectionFrom(record: Record<string, unknown> | null): AgentSelection | undefined {
  if (!record) return undefined;
  const parsed = agentSelectionSchema.safeParse({
    type: record.type,
    model: record.model,
  });
  return parsed.success ? parsed.data : undefined;
}

function compareNodes(a: GraphNode | null, b: GraphNode | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function buildGraph(edges: readonly EdgeLink[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = graph.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    graph.set(edge.source, source);
    const target = graph.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    graph.set(edge.target, target);
  }
  return graph;
}

export function readAgentSelection(value: unknown): AgentSelection | undefined {
  const record = readRecord(value);
  return selectionFrom(record);
}

export function readNodeAgentSelection(value: unknown): NodeAgentSelection | null {
  const record = readRecord(value);
  if (!record) return null;
  const direct = nodeAgentSelectionSchema.safeParse(record.agentSelection);
  if (direct.success) {
    return direct.data;
  }
  const legacy = selectionFrom({
    type: record.agentType,
    model: record.model,
  });
  if (legacy) {
    return {
      mode: 'locked',
      selection: legacy,
    };
  }
  const execution = readRecord(record.execution);
  const nested = selectionFrom({
    type: execution?.type,
    model: execution?.model,
  });
  if (nested) {
    return {
      mode: 'locked',
      selection: nested,
    };
  }
  return null;
}

export function readNodeLockedSelection(value: unknown): AgentSelection | undefined {
  const state = readNodeAgentSelection(value);
  return state?.mode === 'locked' ? state.selection : undefined;
}

export function readGraphNodeAgentSelection(node: GraphNode | null): NodeAgentSelection | null {
  if (!node) return null;
  return readNodeAgentSelection(node.content);
}

export function readGraphNodeLockedSelection(node: GraphNode | null): AgentSelection | undefined {
  if (!node) return undefined;
  return readNodeLockedSelection(node.content);
}

export function applyNodeAgentSelection(
  type: GraphNode['type'],
  content: GraphNode['content'],
  value: NodeAgentSelection | null,
): GraphNode['content'] {
  const next = {
    ...(readRecord(content) ?? {}),
  };
  if (value) {
    next.agentSelection = {
      mode: value.mode,
      ...(value.selection ? { selection: cloneSelection(value.selection) } : {}),
    };
  } else {
    delete next.agentSelection;
  }
  const selection = value?.selection ? cloneSelection(value.selection) : null;
  if (type === 'sub_graph') {
    const execution = {
      ...(readRecord(next.execution) ?? {}),
    };
    if (value?.mode === 'locked' && selection) {
      execution.type = selection.type;
      if (selection.model) {
        execution.model = selection.model;
      } else {
        delete execution.model;
      }
    } else {
      delete execution.type;
      delete execution.model;
    }
    next.execution = execution;
    return next;
  }
  if (
    type === 'agent_step' ||
    type === 'agent_spawn' ||
    type === 'file_summary' ||
    type === 'workflow_copilot'
  ) {
    if (value?.mode === 'locked' && selection) {
      next.agentType = selection.type;
      if (selection.model) {
        next.model = selection.model;
      } else {
        delete next.model;
      }
    } else {
      delete next.agentType;
      delete next.model;
    }
  }
  return next;
}

export function resolveGraphNodeSelection(input: {
  nodeId: string | null | undefined;
  nodes: readonly GraphNode[];
  edges: readonly EdgeLink[];
  fallback?: AgentSelection | null;
}): AgentSelection | null {
  const fallback = cloneSelection(input.fallback);
  if (!input.nodeId) return fallback;
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const own = cloneSelection(readGraphNodeLockedSelection(byId.get(input.nodeId) ?? null));
  if (own) {
    return own;
  }
  const graph = buildGraph(input.edges);
  const seen = new Set<string>([input.nodeId]);
  let frontier = [input.nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of graph.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    const ordered = [...new Set(next)].sort((a, b) => compareNodes(byId.get(a) ?? null, byId.get(b) ?? null));
    for (const id of ordered) {
      const selection = cloneSelection(readGraphNodeLockedSelection(byId.get(id) ?? null));
      if (selection) {
        return selection;
      }
    }
    frontier = ordered;
  }
  return fallback;
}
