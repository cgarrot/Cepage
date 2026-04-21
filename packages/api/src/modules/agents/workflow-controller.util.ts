import type {
  AgentModelRef,
  AgentType,
  GraphNode,
  GraphSnapshot,
  WorkflowInputBound,
  WorkflowInputPart,
  WorkflowInputTemplate,
} from '@cepage/shared-core';
import {
  formatWorkflowInputLabel,
  readGraphNodeLockedSelection,
  readNodeLockedSelection,
  readWorkflowArtifactContent,
  readWorkflowDecisionValidatorContent,
  readWorkflowInputContent,
  readWorkflowSubgraphContent,
  resolveGraphNodeSelection,
  summarizeWorkflowArtifactContent,
  summarizeWorkflowDecisionValidatorContent,
  summarizeWorkflowInputContent,
  summarizeWorkflowLoopContent,
  summarizeWorkflowSubgraphContent,
  type WorkflowSubgraphContent,
  type WorkflowSubgraphInputBinding,
} from '@cepage/shared-core';

export interface WorkflowControllerItemValue {
  key: string;
  label: string;
  value: unknown;
  text: string;
}

export interface WorkflowControllerPromptInputValue {
  key: string;
  label: string;
  value: unknown;
  text: string;
  parts: unknown[];
}

export interface WorkflowControllerPromptContext {
  item: WorkflowControllerItemValue;
  index: number;
  attempt: number;
  completedSummaries: string[];
  retryFeedback?: string;
  inputs?: Record<string, WorkflowControllerPromptInputValue>;
  outputs?: Array<{
    relativePath: string;
    resolvedRelativePath: string;
    pathMode: 'static' | 'per_run';
  }>;
}

export interface WorkflowChildSelection {
  type: AgentType;
  role: string;
  model?: AgentModelRef;
}

const WORKFLOW_OUTPUT_FRESHNESS_TOLERANCE_MS = 1000;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readModel(value: unknown): AgentModelRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const providerID = readString((value as { providerID?: unknown }).providerID);
  const modelID = readString((value as { modelID?: unknown }).modelID);
  if (!providerID || !modelID) {
    return undefined;
  }
  return { providerID, modelID };
}

function collectConnectedNodeIds(triggerNodeId: string, edges: GraphSnapshot['edges']): string[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = graph.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    graph.set(edge.source, source);
    const target = graph.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    graph.set(edge.target, target);
  }
  const queue = [triggerNodeId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    for (const id of graph.get(next) ?? []) {
      if (!seen.has(id)) {
        queue.push(id);
      }
    }
  }
  return [...seen];
}

function collectStructuredNodeIds(node: GraphNode): string[] {
  if (node.type === 'loop') {
    const content = node.content as {
      bodyNodeId?: unknown;
      validatorNodeId?: unknown;
      source?: {
        kind?: unknown;
        templateNodeId?: unknown;
        boundNodeId?: unknown;
        fileNodeId?: unknown;
      };
    };
    const ids = [readString(content.bodyNodeId), readString(content.validatorNodeId)];
    const source = content.source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      ids.push(readString(source.templateNodeId));
      ids.push(readString(source.boundNodeId));
      ids.push(readString(source.fileNodeId));
    }
    return ids.filter((value): value is string => Boolean(value));
  }
  if (node.type === 'sub_graph') {
    const content = readWorkflowSubgraphContent(node.content);
    return content?.entryNodeId ? [content.entryNodeId] : [];
  }
  if (node.type === 'managed_flow') {
    const phases = (node.content as { phases?: unknown }).phases;
    if (!Array.isArray(phases)) {
      return [];
    }
    return phases
      .flatMap((phase) => {
        if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
          return [];
        }
        const value = phase as Record<string, unknown>;
        return [
          readString(value.nodeId),
          readString(value.validatorNodeId),
          readString(value.sourceNodeId),
          readString(value.targetTemplateNodeId),
        ];
      })
      .filter((value): value is string => Boolean(value));
  }
  if (node.type === 'runtime_target') {
    const outputNodeId = readString((node.content as { outputNodeId?: unknown }).outputNodeId);
    return outputNodeId ? [outputNodeId] : [];
  }
  return [];
}

function isReferencedPromptBoundary(node: GraphNode): boolean {
  return (
    node.type === 'agent_spawn' ||
    node.type === 'agent_step' ||
    node.type === 'loop' ||
    node.type === 'managed_flow' ||
    node.type === 'connector_target' ||
    node.type === 'runtime_target' ||
    node.type === 'sub_graph'
  );
}

function shouldExpandReferencedPrompt(node: GraphNode, isStart: boolean): boolean {
  if (isStart) {
    return true;
  }
  if (
    node.type === 'agent_message' ||
    node.type === 'file_summary' ||
    node.type === 'human_message' ||
    node.type === 'input' ||
    node.type === 'note'
  ) {
    return true;
  }
  if (node.type !== 'workspace_file') {
    return false;
  }
  return readWorkflowArtifactContent(node.content)?.role === 'input';
}

function collectReferencedNodeIds(snapshot: GraphSnapshot, entryNodeId: string): string[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const links = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    const source = links.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    links.set(edge.source, source);
    const target = links.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    links.set(edge.target, target);
  }
  const queue = [entryNodeId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    const node = byId.get(current);
    if (!node) {
      continue;
    }
    const isStart = current === entryNodeId;
    if (!isStart && isReferencedPromptBoundary(node)) {
      continue;
    }
    seen.add(current);
    if (!shouldExpandReferencedPrompt(node, isStart)) {
      continue;
    }
    for (const next of links.get(current) ?? []) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
    for (const next of collectStructuredNodeIds(node)) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen];
}

function sortNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function sortNodesDesc(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

function isControllerOwned(node: GraphNode, controllerId: string): boolean {
  const meta = node.metadata as { runtimeOwned?: unknown; controllerId?: unknown };
  return meta.runtimeOwned === 'workflow_controller' && meta.controllerId === controllerId;
}

function artifactPath(node: GraphNode): string | undefined {
  const artifact = node.type === 'workspace_file' ? readWorkflowArtifactContent(node.content) : null;
  return artifact?.relativePath.trim() || undefined;
}

function isBoundInput(value: ReturnType<typeof readWorkflowInputContent>): value is WorkflowInputBound {
  return value?.mode === 'bound';
}

function isTemplateInput(value: ReturnType<typeof readWorkflowInputContent>): value is WorkflowInputTemplate {
  return value?.mode === 'template';
}

function latestBoundInput(
  snapshot: GraphSnapshot,
  templateNodeId: string,
): WorkflowInputBound | null {
  return snapshot.nodes
    .filter((node) => node.type === 'input')
    .map((node) => ({ node, content: readWorkflowInputContent(node.content) }))
    .filter(
      (entry): entry is { node: GraphNode; content: WorkflowInputBound } =>
        isBoundInput(entry.content) && entry.content.templateNodeId === templateNodeId,
    )
    .sort((a, b) => b.node.updatedAt.localeCompare(a.node.updatedAt) || b.node.createdAt.localeCompare(a.node.createdAt))[0]
    ?.content ?? null;
}

function readBoundPartValue(part: WorkflowInputPart): unknown {
  if (part.type === 'text') {
    return part.text;
  }
  return {
    type: part.type,
    name: part.file.name,
    mimeType: part.file.mimeType,
    relativePath: part.relativePath,
    extractedText: part.extractedText,
    claimRef: part.claimRef,
  };
}

function summarizeBoundPart(part: WorkflowInputPart): string {
  if (part.type === 'text') {
    return part.text.trim();
  }
  return (
    part.extractedText?.trim() ??
    part.relativePath?.trim() ??
    part.file.name.trim()
  );
}

export function collectWorkflowPromptInputs(
  snapshot: GraphSnapshot,
): Record<string, WorkflowControllerPromptInputValue> {
  const values = sortNodes(snapshot.nodes)
    .filter((node) => node.type === 'input')
    .map((node) => ({ node, content: readWorkflowInputContent(node.content) }))
    .filter(
      (
        entry,
      ): entry is {
        node: GraphNode;
        content: WorkflowInputTemplate;
      } => isTemplateInput(entry.content),
    )
    .flatMap(({ node, content }) => {
      const key = readString(content.key)?.trim();
      if (!key) return [];
      const bound = latestBoundInput(snapshot, node.id);
      if (!bound || bound.mode !== 'bound') return [];
      const parts = bound.parts.map(readBoundPartValue);
      const text = bound.parts.map(summarizeBoundPart).filter(Boolean).join('\n\n');
      return [
        [
          key,
          {
            key,
            label: formatWorkflowInputLabel(content),
            value: parts.length === 1 ? parts[0] : parts,
            text,
            parts,
          },
        ] as const,
      ];
    });
  return Object.fromEntries(values);
}

function referencedNodes(snapshot: GraphSnapshot, entryNodeId?: string): GraphNode[] {
  if (!entryNodeId) {
    return sortNodes(snapshot.nodes);
  }
  const ids = new Set(collectReferencedNodeIds(snapshot, entryNodeId));
  const nodes = snapshot.nodes.filter((node) => ids.has(node.id));
  if (nodes.length > 0) {
    return sortNodes(nodes);
  }
  return sortNodes(snapshot.nodes);
}

function referencedPromptInputs(
  subgraph: WorkflowSubgraphContent,
  inputs: Record<string, WorkflowControllerPromptInputValue>,
): WorkflowControllerPromptInputValue[] {
  const values = Object.values(inputs);
  if (values.length === 0) {
    return [];
  }
  if (Object.keys(subgraph.inputMap).length === 0) {
    return values;
  }
  const known = new Set(values.map((value) => value.key));
  const referenced = new Set<string>();
  for (const binding of Object.values(subgraph.inputMap)) {
    const template = typeof binding === 'string' ? binding : binding.template;
    for (const match of template.matchAll(/\b(?:inputs|controller(?:\.inputs)?)\.([A-Za-z0-9_]+)/g)) {
      const key = match[1];
      if (key && known.has(key)) {
        referenced.add(key);
      }
    }
  }
  return values.filter((value) => referenced.has(value.key));
}

function summarizeAgentStep(node: GraphNode): string {
  const content = node.content as {
    label?: unknown;
    agentType?: unknown;
    role?: unknown;
    model?: unknown;
  };
  const lines = [readString(content.label) ?? 'Agent step'];
  const selection = readGraphNodeLockedSelection(node);
  const agentType = selection?.type ?? readString(content.agentType) ?? 'agent';
  const role = readString(content.role) ?? 'builder';
  const model = selection?.model ?? readModel(content.model);
  lines.push(
    [agentType, role, model ? `${model.providerID}/${model.modelID}` : null].filter(Boolean).join(' · '),
  );
  return lines.join('\n');
}

function summarizeNode(node: GraphNode): string | null {
  if (node.type === 'note' || node.type === 'human_message' || node.type === 'agent_message') {
    return readString((node.content as { text?: unknown }).text)?.trim() ?? null;
  }
  if (node.type === 'input') {
    return summarizeWorkflowInputContent(node.content).trim() || null;
  }
  if (node.type === 'workspace_file') {
    return summarizeWorkflowArtifactContent(node.content).trim() || null;
  }
  if (node.type === 'agent_step' || node.type === 'agent_spawn') {
    return summarizeAgentStep(node);
  }
  if (node.type === 'decision') {
    const summary = summarizeWorkflowDecisionValidatorContent(node.content).trim();
    return summary || readString((node.content as { text?: unknown }).text)?.trim() || null;
  }
  if (node.type === 'loop') {
    return summarizeWorkflowLoopContent(node.content).trim() || null;
  }
  if (node.type === 'sub_graph') {
    return summarizeWorkflowSubgraphContent(node.content).trim() || null;
  }
  return readString((node.content as { text?: unknown }).text)?.trim() ?? null;
}

function stringifyValue(value: unknown, format: 'text' | 'json' = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value == null) {
    return '';
  }
  return JSON.stringify(value, null, 2);
}

function readPath(root: unknown, path: string): unknown {
  const clean = path.trim();
  if (!clean) {
    return undefined;
  }
  const parts = clean.split('.').filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function renderTemplate(template: string, data: Record<string, unknown>, format: 'text' | 'json' = 'text'): string {
  const match = template.trim().match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (match) {
    return stringifyValue(readPath(data, match[1] ?? ''), format);
  }
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_full, rawPath: string) =>
    stringifyValue(readPath(data, rawPath), format),
  );
}

export function renderInputBinding(
  binding: WorkflowSubgraphInputBinding,
  data: Record<string, unknown>,
): string {
  if (typeof binding === 'string') {
    return renderTemplate(binding, data, 'text');
  }
  return renderTemplate(binding.template, data, binding.format ?? 'text');
}

function renderNodeSummary(node: GraphNode, data: Record<string, unknown>): string | null {
  if (node.type === 'note' || node.type === 'human_message' || node.type === 'agent_message') {
    const text = readString((node.content as { text?: unknown }).text)?.trim();
    if (!text) {
      return null;
    }
    return renderTemplate(text, data, 'text').trim() || null;
  }
  return summarizeNode(node);
}

export function normalizeControllerItem(value: unknown, index: number): WorkflowControllerItemValue {
  if (typeof value === 'string') {
    const text = value.trim();
    return {
      key: `item-${index + 1}`,
      label: text.slice(0, 80) || `Item ${index + 1}`,
      value,
      text,
    };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return {
      key: `item-${index + 1}`,
      label: `Item ${index + 1}`,
      value,
      text: String(value),
    };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const label =
      readString(record.label) ??
      readString(record.title) ??
      readString(record.name) ??
      readString(record.key) ??
      readString(record.text) ??
      `Item ${index + 1}`;
    return {
      key: readString(record.key) ?? readString(record.id) ?? `item-${index + 1}`,
      label,
      value,
      text: stringifyValue(value, 'json'),
    };
  }
  return {
    key: `item-${index + 1}`,
    label: `Item ${index + 1}`,
    value,
    text: stringifyValue(value, 'json'),
  };
}

export function pickWorkflowChildSelection(
  snapshot: GraphSnapshot,
  subgraph: WorkflowSubgraphContent,
): WorkflowChildSelection {
  const nodes = referencedNodes(snapshot, subgraph.entryNodeId);
  const step = nodes.find((node) => node.type === 'agent_step' || node.type === 'agent_spawn') ?? null;
  const content = (step?.content ?? {}) as {
    agentType?: unknown;
    role?: unknown;
    model?: unknown;
  };
  const ids = new Set(nodes.map((node) => node.id));
  const own = readGraphNodeLockedSelection(step);
  const parent = readNodeLockedSelection(subgraph);
  const selection =
    own ??
    parent ??
    resolveGraphNodeSelection({
      nodeId: step?.id ?? subgraph.entryNodeId ?? nodes[0]?.id ?? null,
      nodes,
      edges: snapshot.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      fallback: null,
    });
  return {
    type: selection?.type ?? ((readString(content.agentType) as AgentType | undefined) ?? 'opencode'),
    role: readString(content.role) ?? 'builder',
    ...(selection?.model ? { model: selection.model } : {}),
  };
}

export function pickWorkflowControllerPromptNodeId(
  snapshot: GraphSnapshot,
  controllerId: string,
  currentId?: string,
): string | undefined {
  if (currentId) {
    const current = snapshot.nodes.find((node) => node.id === currentId) ?? null;
    if (current?.type === 'note' && isControllerOwned(current, controllerId)) {
      return current.id;
    }
  }
  return sortNodesDesc(
    snapshot.nodes.filter((node) => node.type === 'note' && isControllerOwned(node, controllerId)),
  )[0]?.id;
}

export function pickWorkflowControllerOutputNodeId(
  snapshot: GraphSnapshot,
  input: {
    controllerId: string;
    bodyNodeId: string;
    relativePath: string;
    currentId?: string;
    itemKey?: string;
  },
): string | undefined {
  if (input.currentId) {
    const current = snapshot.nodes.find((node) => node.id === input.currentId) ?? null;
    if (
      current?.type === 'workspace_file' &&
      artifactPath(current) === input.relativePath &&
      matchesWorkflowControllerOutputItem(current, input.controllerId, input.itemKey)
    ) {
      return current.id;
    }
  }
  const ids = new Set(collectConnectedNodeIds(input.bodyNodeId, snapshot.edges));
  const matches = snapshot.nodes
    .filter(
      (node) =>
        node.type === 'workspace_file' &&
        artifactPath(node) === input.relativePath &&
        matchesWorkflowControllerOutputItem(node, input.controllerId, input.itemKey),
    )
    .sort((a, b) => {
      const score =
        workflowControllerOutputScore(b, input.controllerId, ids, input.itemKey) -
        workflowControllerOutputScore(a, input.controllerId, ids, input.itemKey);
      if (score !== 0) {
        return score;
      }
      return (
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id)
      );
    });
  return matches[0]?.id;
}

function workflowControllerOutputScore(
  node: GraphNode,
  controllerId: string,
  ids: Set<string>,
  itemKey?: string,
): number {
  const artifact = readWorkflowArtifactContent(node.content);
  if (!artifact) {
    return 0;
  }
  const matchesItem =
    itemKey &&
    isControllerOwned(node, controllerId) &&
    matchesWorkflowControllerOutputItem(node, controllerId, itemKey)
      ? 6
      : 0;
  return (
    (ids.has(node.id) ? 4 : 0) +
    (artifact.role === 'output' ? 2 : 0) +
    (isControllerOwned(node, controllerId) ? 1 : 0) +
    matchesItem
  );
}

function matchesWorkflowControllerOutputItem(
  node: GraphNode,
  controllerId: string,
  itemKey?: string,
): boolean {
  if (!itemKey || !isControllerOwned(node, controllerId)) {
    return true;
  }
  const meta = node.metadata as { itemKey?: unknown };
  return meta.itemKey === itemKey;
}

export function renderReferencedWorkflowPrompt(
  snapshot: GraphSnapshot,
  subgraph: WorkflowSubgraphContent,
  ctx: WorkflowControllerPromptContext,
): string {
  const nodes = referencedNodes(snapshot, subgraph.entryNodeId);
  const sections: string[] = [];

  const inputs = ctx.inputs ?? {};
  const controllerInputs = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.text]));
  const data = {
    loop: {
      item: ctx.item.value,
      item_text: ctx.item.text,
      item_label: ctx.item.label,
      index: ctx.index,
      attempt: ctx.attempt,
      completed_summary: ctx.completedSummaries.join('\n'),
      retry_feedback: ctx.retryFeedback ?? '',
    },
    controller: {
      completed_summary: ctx.completedSummaries.join('\n'),
      retry_feedback: ctx.retryFeedback ?? '',
      ...controllerInputs,
      inputs,
    },
    inputs,
  };

  const summary = nodes
    .map((node) => renderNodeSummary(node, data))
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('\n\n---\n\n');

  if (summary.trim()) {
    sections.push(`Referenced workflow\n${summary.trim()}`);
  }

  const renderedInputs = Object.entries(subgraph.inputMap)
    .map(([key, binding]) => {
      const value = renderInputBinding(binding, data);
      if (!value.trim()) {
        return null;
      }
      return `Input ${key}\n${value.trim()}`;
    })
    .filter((value): value is string => Boolean(value));
  if (renderedInputs.length > 0) {
    sections.push(renderedInputs.join('\n\n'));
  }

  const parentInputs = referencedPromptInputs(subgraph, inputs)
    .map((value) => `${value.label} (${value.key})\n${value.text.trim()}`)
    .filter((value) => Boolean(value.trim()));
  if (parentInputs.length > 0) {
    sections.push(`Parent inputs\n${parentInputs.join('\n\n')}`);
  }

  sections.push(
    [
      'Loop context',
      `item: ${ctx.item.label}`,
      `index: ${ctx.index + 1}`,
      `attempt: ${ctx.attempt}`,
      ctx.retryFeedback?.trim() ? `retry feedback: ${ctx.retryFeedback.trim()}` : null,
      ctx.completedSummaries.length > 0
        ? `completed summaries:\n${ctx.completedSummaries.join('\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (ctx.outputs?.length) {
    const lines = ctx.outputs.map((output) => {
      const mode = output.pathMode === 'per_run' ? 'per_run' : 'static';
      if (output.resolvedRelativePath !== output.relativePath) {
        return `- ${output.resolvedRelativePath} (template: ${output.relativePath}, mode: ${mode})`;
      }
      return `- ${output.relativePath} (mode: ${mode})`;
    });
    sections.push(
      [
        'Current run outputs',
        'Write output files to the resolved path for this attempt.',
        ...lines,
      ].join('\n'),
    );
  }

  if (subgraph.expectedOutputs?.length) {
    sections.push(`Expected outputs\n${subgraph.expectedOutputs.map((path) => `- ${path}`).join('\n')}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

export function summarizeValidatorRequirements(node: GraphNode | null): string[] {
  const content = node ? readWorkflowDecisionValidatorContent(node.content) : null;
  if (!content) {
    return [];
  }
  return [
    ...content.requirements,
    ...content.evidenceFrom.map((path) => `evidence: ${path}`),
    ...content.checks.map((check) => {
      if (check.kind === 'file_contains') {
        return `check: ${check.kind} ${check.path} contains "${check.text}"`;
      }
      if (check.kind === 'file_not_contains') {
        return `check: ${check.kind} ${check.path} does not contain "${check.text}"`;
      }
      if (check.kind === 'file_last_line_equals') {
        return `check: ${check.kind} ${check.path} ends with line "${check.text}"`;
      }
      if ('jsonPath' in check) {
        return `check: ${check.kind} ${check.path} @ ${check.jsonPath}`;
      }
      return `check: ${check.kind} ${'path' in check ? check.path : ''}`.trim();
    }),
  ];
}

export function isWorkflowOutputFresh(mtimeMs: number | undefined, startedAt: Date | null | undefined): boolean {
  if (!startedAt) {
    return true;
  }
  if (mtimeMs == null) {
    return false;
  }
  return mtimeMs + WORKFLOW_OUTPUT_FRESHNESS_TOLERANCE_MS >= startedAt.getTime();
}

export function hasWorkflowFileLastLine(text: string, expected: string): boolean {
  const actual = text
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .at(-1)
    ?.trim();
  return Boolean(actual) && actual === expected.trim();
}

export function listWorkflowReferenceArtifacts(snapshot: GraphSnapshot): string[] {
  return sortNodes(snapshot.nodes)
    .flatMap((node) => {
      const artifact = node.type === 'workspace_file' ? readWorkflowArtifactContent(node.content) : null;
      return artifact ? [artifact.relativePath] : [];
    });
}

export function listWorkflowReferenceInputs(snapshot: GraphSnapshot): string[] {
  return sortNodes(snapshot.nodes)
    .flatMap((node) => {
      const input = node.type === 'input' ? readWorkflowInputContent(node.content) : null;
      return input && input.mode === 'template' ? [input.key ?? 'default'] : [];
    });
}
