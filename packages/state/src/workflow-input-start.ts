import {
  formatWorkflowInputLabel,
  readWorkflowArtifactContent,
  readWorkflowInputContent,
  type GraphNode,
  type WorkflowInputAccept,
  type WorkflowInputBound,
  type WorkflowInputTemplate,
} from '@cepage/shared-core';
import { getNodeText } from './workspace-flow.js';

type EdgeLink = {
  source: string;
  target: string;
};

export type InputTemplateBinding = {
  templateNodeId: string;
  boundNodeId: string;
  label: string;
  summary: string;
  required: boolean;
  isTarget: boolean;
};

export type InputTemplateMissing = {
  templateNodeId: string;
  key: string;
  label: string;
};

export type InputTemplateSourceCandidateKind = 'text' | 'file' | 'image';

export type InputTemplateSourceCandidate = {
  templateNodeId: string;
  sourceNodeId: string;
  label: string;
  summary: string;
  kind: InputTemplateSourceCandidateKind;
  isTarget: boolean;
};

export type InputTemplateStartEntry = {
  templateNodeId: string;
  key: string;
  label: string;
  required: boolean;
  isTarget: boolean;
  accepts: WorkflowInputAccept[];
  multiple: boolean;
  canInlineText: boolean;
  bound: InputTemplateBinding | null;
  candidates: InputTemplateSourceCandidate[];
};

export type InputTemplateStartState = {
  targetNodeId: string;
  ready: boolean;
  bound: InputTemplateBinding[];
  missing: InputTemplateMissing[];
  entries: InputTemplateStartEntry[];
  target: InputTemplateStartEntry | null;
};

export type InputTemplateStartOptions = {
  inlineText?: string;
  sourceNodeIds?: ReadonlyArray<string>;
};

export type InputTemplateStartEvaluation = {
  ready: boolean;
  missing: InputTemplateMissing[];
};

function normalizeInputKey(value: string | undefined): string {
  return value?.trim() || 'default';
}

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function listAccepts(content: WorkflowInputTemplate): WorkflowInputAccept[] {
  return content.accepts?.length ? [...content.accepts] : ['text', 'image', 'file'];
}

function collectConnectedNodeIds(
  startNodeId: string,
  edges: ReadonlyArray<EdgeLink>,
): string[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = graph.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    graph.set(edge.source, source);
    const target = graph.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    graph.set(edge.target, target);
  }

  const seen = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    queue.push(...(graph.get(id) ?? []));
  }
  return [...seen];
}

function collectDirectNodeIds(
  startNodeId: string,
  edges: ReadonlyArray<EdgeLink>,
): string[] {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.source === startNodeId) {
      seen.add(edge.target);
    }
    if (edge.target === startNodeId) {
      seen.add(edge.source);
    }
  }
  return [...seen];
}

function readTemplate(node: GraphNode): WorkflowInputTemplate | null {
  if (node.type !== 'input') return null;
  const content = readWorkflowInputContent(node.content);
  return content?.mode === 'template' ? content : null;
}

function readBound(node: GraphNode): WorkflowInputBound | null {
  if (node.type !== 'input') return null;
  const content = readWorkflowInputContent(node.content);
  return content?.mode === 'bound' ? content : null;
}

function findLatestBound(
  nodes: readonly GraphNode[],
  templateNodeId: string,
): { node: GraphNode; content: WorkflowInputBound } | null {
  let latest: { node: GraphNode; content: WorkflowInputBound } | null = null;
  for (const node of nodes) {
    const content = readBound(node);
    if (!content || content.templateNodeId !== templateNodeId) continue;
    if (
      !latest ||
      node.updatedAt > latest.node.updatedAt ||
      (node.updatedAt === latest.node.updatedAt && node.createdAt > latest.node.createdAt)
    ) {
      latest = { node, content };
    }
  }
  return latest;
}

function readCandidateText(node: GraphNode): string | undefined {
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    return trim(artifact?.excerpt) ?? trim(artifact?.summary);
  }
  return trim(getNodeText(node));
}

function readCandidateKind(
  template: WorkflowInputTemplate,
  node: GraphNode,
): InputTemplateSourceCandidateKind | null {
  const accepts = listAccepts(template);
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    if (!artifact || artifact.kind === 'directory') {
      return accepts.includes('text') && readCandidateText(node) ? 'text' : null;
    }
    if (artifact.kind === 'image' && accepts.includes('image')) {
      return 'image';
    }
    if (artifact.kind !== 'image' && accepts.includes('file')) {
      return 'file';
    }
    if (accepts.includes('text') && readCandidateText(node)) {
      return 'text';
    }
    return null;
  }
  if (!accepts.includes('text')) {
    return null;
  }
  return readCandidateText(node) ? 'text' : null;
}

function readCandidateLabel(node: GraphNode): string {
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    return trim(artifact?.title) ?? trim(artifact?.relativePath) ?? 'Workspace file';
  }
  if (node.type === 'agent_output') {
    return 'Agent output';
  }
  if (node.type === 'file_summary') {
    return 'File summary';
  }
  if (node.type === 'human_message') {
    return 'Message';
  }
  const first = trim(getNodeText(node))?.split('\n')[0]?.trim();
  return first || node.type.replace(/_/g, ' ');
}

function readCandidateSummary(node: GraphNode, kind: InputTemplateSourceCandidateKind): string {
  if (kind === 'text') {
    return readCandidateText(node) ?? readCandidateLabel(node);
  }
  return trim(getNodeText(node)) ?? readCandidateLabel(node);
}

function readTemplateCandidates(
  targetNodeId: string,
  templateNodeId: string,
  template: WorkflowInputTemplate,
  nodesById: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyArray<EdgeLink>,
): InputTemplateSourceCandidate[] {
  return collectDirectNodeIds(templateNodeId, edges)
    .map((sourceNodeId) => {
      const node = nodesById.get(sourceNodeId);
      if (!node || node.type === 'input') {
        return null;
      }
      const kind = readCandidateKind(template, node);
      if (!kind) {
        return null;
      }
      return {
        templateNodeId,
        sourceNodeId,
        label: readCandidateLabel(node),
        summary: readCandidateSummary(node, kind),
        kind,
        isTarget: templateNodeId === targetNodeId,
      } satisfies InputTemplateSourceCandidate;
    })
    .filter((candidate): candidate is InputTemplateSourceCandidate => candidate !== null);
}

export function evaluateInputTemplateStartState(
  state: InputTemplateStartState,
  options: InputTemplateStartOptions = {},
): InputTemplateStartEvaluation {
  const inlineText = trim(options.inlineText);
  const selected = new Set(options.sourceNodeIds ?? []);
  const missing = state.entries.flatMap((entry) => {
    if (!entry.required) {
      return [];
    }
    if (entry.bound) {
      return [];
    }
    if (entry.isTarget && inlineText && entry.canInlineText) {
      return [];
    }
    if (entry.isTarget && entry.candidates.some((candidate) => selected.has(candidate.sourceNodeId))) {
      return [];
    }
    if (entry.candidates.length === 1) {
      return [];
    }
    return [
      {
        templateNodeId: entry.templateNodeId,
        key: entry.key,
        label: entry.label,
      } satisfies InputTemplateMissing,
    ];
  });
  return {
    ready: missing.length === 0,
    missing,
  };
}

export function readInputTemplateStartState(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: ReadonlyArray<EdgeLink>,
): InputTemplateStartState | null {
  const target = nodes.find((node) => node.id === nodeId);
  const targetContent = target ? readTemplate(target) : null;
  if (!target || !targetContent) return null;

  const component = new Set(collectConnectedNodeIds(nodeId, edges));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const entries = nodes.flatMap((node) => {
    if (!component.has(node.id)) return [];
    const content = readTemplate(node);
    if (!content) return [];
    const latest = findLatestBound(nodes, node.id);
    const bound = latest
      ? {
          templateNodeId: node.id,
          boundNodeId: latest.node.id,
          label: formatWorkflowInputLabel(content),
          summary: latest.content.summary?.trim() || `${latest.content.parts.length} part(s)`,
          required: content.required ?? false,
          isTarget: node.id === nodeId,
        }
      : null;
    return [
      {
        templateNodeId: node.id,
        key: normalizeInputKey(content.key),
        label: formatWorkflowInputLabel(content),
        required: content.required ?? false,
        isTarget: node.id === nodeId,
        accepts: listAccepts(content),
        multiple: content.multiple ?? true,
        canInlineText: listAccepts(content).length === 1 && listAccepts(content)[0] === 'text',
        bound,
        candidates: readTemplateCandidates(nodeId, node.id, content, nodesById, edges),
      } satisfies InputTemplateStartEntry,
    ];
  });
  const next = {
    targetNodeId: nodeId,
    ready: false,
    bound: entries.flatMap((entry) => (entry.bound ? [entry.bound] : [])),
    missing: [],
    entries,
    target: entries.find((entry) => entry.isTarget) ?? null,
  } satisfies InputTemplateStartState;
  const evaluation = evaluateInputTemplateStartState(next);
  return {
    ...next,
    ready: evaluation.ready,
    missing: evaluation.missing,
  };
}
