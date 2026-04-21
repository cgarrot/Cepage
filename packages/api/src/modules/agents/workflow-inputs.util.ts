import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  collectManagedFlowReferencedNodeIds,
  readFileSummaryContent,
  readRuntimeTargetSummary,
  readWorkflowArtifactContent,
  readWorkflowInputContent,
  readWorkflowLoopContent,
  readWorkflowSubgraphContent,
  resolveGraphNodeSelection,
  resolveWorkflowArtifactRelativePath,
  type AgentRun,
  type GraphNode,
  type GraphSnapshot,
  type WorkflowInputPart,
  type WorkflowInputTemplate,
  type WorkflowRunInputValue,
} from '@cepage/shared-core';
import { extractFileUpload } from '../graph/file-node.util';
import type {
  AgentSelection,
  WorkflowBoundSelection,
  WorkflowInputAsset,
  WorkflowInputSourceCandidate,
  WorkflowInputTemplateRow,
  WorkflowRunFile,
} from './agents.types';

export const ACTIVE_RUN_STATUSES = new Set<AgentRun['status']>([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

const LEGACY_INPUT_ROOT = path.resolve(process.cwd(), '..', '..', '.cepage-data', 'workflow-inputs');
const WORKFLOW_INPUT_ROOT = '.cepage/workflow-inputs';

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function normalizePathPart(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  const cleaned = trimmed
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'file';
}

export function trimText(value: string | undefined, limit: number): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  return next.length > limit ? `${next.slice(0, limit)}…` : next;
}

export function splitWorkflowTextParts(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((entry) =>
      entry
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
    )
    .filter(Boolean);
}

export function normalizeInputKey(value: string | undefined): string {
  return value?.trim() || 'default';
}

export function uniqIds(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

export function collectConnectedNodeIds(
  startNodeId: string,
  edges: ReadonlyArray<{ source: string; target: string }>,
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
    for (const next of graph.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

export function looksLikeWorkflowSeed(node: GraphNode): boolean {
  if (node.creator.type === 'agent') return false;
  if (node.type === 'agent_output' || node.type === 'agent_status' || node.type === 'runtime_run') {
    return false;
  }
  if (node.type !== 'input') return true;
  return readWorkflowInputContent(node.content)?.mode !== 'bound';
}

export function buildInputSummary(parts: WorkflowInputPart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      return part.relativePath ?? part.file.name;
    })
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function legacyInputDir(sessionId: string, nodeId: string): string {
  return path.join(LEGACY_INPUT_ROOT, sessionId, nodeId, 'files');
}

function legacyInputFilePath(
  sessionId: string,
  nodeId: string,
  part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>,
): string {
  return path.join(legacyInputDir(sessionId, nodeId), `${part.id}${part.file.extension ?? ''}`);
}

export function workflowInputRelativePath(
  key: string,
  part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>,
): string {
  const ext = part.file.extension ?? path.extname(part.file.name);
  const base = path.basename(part.file.name, ext || undefined);
  const filename = `${part.id}-${normalizePathPart(base)}${ext || ''}`;
  return path.posix.join(WORKFLOW_INPUT_ROOT, normalizePathPart(key), filename);
}

export function claimRef(runId: string, relativePath: string): string {
  return `artifact://run/${runId}/${encodeURIComponent(relativePath)}`;
}

export function inputFilePath(
  cwd: string,
  sessionId: string,
  nodeId: string,
  part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>,
): string {
  if (part.relativePath?.trim()) {
    return path.resolve(cwd, part.relativePath);
  }
  return legacyInputFilePath(sessionId, nodeId, part);
}

export function workflowInputTemplates(snapshot: GraphSnapshot): WorkflowInputTemplateRow[] {
  return snapshot.nodes.flatMap((node) => {
    if (node.type !== 'input') return [];
    const content = readWorkflowInputContent(node.content);
    if (!content || content.mode !== 'template') return [];
    return [{ node, content, key: normalizeInputKey(content.key) }];
  });
}

export function findInputTemplate(snapshot: GraphSnapshot, nodeId: string): WorkflowInputTemplateRow {
  const node = snapshot.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new NotFoundException('INPUT_NODE_NOT_FOUND');
  }
  if (node.type !== 'input') {
    throw new BadRequestException('INPUT_NODE_TEMPLATE_REQUIRED');
  }
  const content = readWorkflowInputContent(node.content);
  if (!content || content.mode !== 'template') {
    throw new BadRequestException('INPUT_NODE_TEMPLATE_REQUIRED');
  }
  return { node, content, key: normalizeInputKey(content.key) };
}

export function componentWorkflowInputTemplates(
  snapshot: GraphSnapshot,
  nodeIds: ReadonlySet<string>,
): WorkflowInputTemplateRow[] {
  return workflowInputTemplates(snapshot).filter((item) => nodeIds.has(item.node.id));
}

export function componentWorkflowSeedNodeIds(snapshot: GraphSnapshot, triggerNodeId: string): string[] {
  const component = new Set(collectConnectedNodeIds(triggerNodeId, snapshot.edges));
  return snapshot.nodes.flatMap((node) => (component.has(node.id) && looksLikeWorkflowSeed(node) ? [node.id] : []));
}

function isTemplateStepNode(
  node: GraphNode | null,
): node is GraphNode & { type: 'agent_step' | 'agent_spawn' } {
  return Boolean(node && (node.type === 'agent_step' || (node.type === 'agent_spawn' && node.creator.type !== 'agent')));
}

function nodeById(snapshot: GraphSnapshot, nodeId?: string | null): GraphNode | null {
  if (!nodeId) {
    return null;
  }
  return snapshot.nodes.find((node) => node.id === nodeId) ?? null;
}

function findStructuredStepNodes(
  snapshot: GraphSnapshot,
  triggerNodeId: string,
  seen = new Set<string>(),
): GraphNode[] {
  if (seen.has(triggerNodeId)) {
    return [];
  }
  seen.add(triggerNodeId);
  const current = nodeById(snapshot, triggerNodeId);
  if (current && isTemplateStepNode(current)) {
    return [current];
  }
  const next = new Set(
    snapshot.edges
      .filter((edge) => edge.relation === 'feeds_into' && edge.source === triggerNodeId)
      .map((edge) => edge.target),
  );
  const loop = current?.type === 'loop' ? readWorkflowLoopContent(current.content) : null;
  if (loop?.bodyNodeId) {
    next.add(loop.bodyNodeId);
  }
  const subgraph = current?.type === 'sub_graph' ? readWorkflowSubgraphContent(current.content) : null;
  if (subgraph?.entryNodeId) {
    next.add(subgraph.entryNodeId);
  }
  if (current?.type === 'managed_flow') {
    for (const nodeId of collectManagedFlowReferencedNodeIds(current.content)) {
      next.add(nodeId);
    }
  }
  const runtime = current?.type === 'runtime_target' ? readRuntimeTargetSummary(current.content) : null;
  if (runtime?.outputNodeId) {
    next.add(runtime.outputNodeId);
  }
  return uniqIds(
    [...next].flatMap((nodeId) => findStructuredStepNodes(snapshot, nodeId, new Set(seen)).map((node) => node.id)),
  )
    .map((nodeId) => nodeById(snapshot, nodeId))
    .filter((node): node is GraphNode => Boolean(node));
}

export function findConnectedStepNode(snapshot: GraphSnapshot, triggerNodeId?: string | null): GraphNode | null {
  if (!triggerNodeId) {
    return null;
  }
  const structured = findStructuredStepNodes(snapshot, triggerNodeId);
  if (structured.length === 1) {
    return structured[0] ?? null;
  }
  if (structured.length > 1) {
    throw new BadRequestException('WORKFLOW_STEP_AMBIGUOUS');
  }
  const component = new Set(collectConnectedNodeIds(triggerNodeId, snapshot.edges));
  const steps = snapshot.nodes.filter((node) => component.has(node.id) && isTemplateStepNode(node));
  if (steps.length === 1) {
    return steps[0] ?? null;
  }
  if (steps.length > 1) {
    throw new BadRequestException('WORKFLOW_STEP_AMBIGUOUS');
  }
  return null;
}

export function findConnectedLoopNode(
  snapshot: GraphSnapshot,
  triggerNodeId?: string | null,
  seedNodeIds: ReadonlyArray<string> = [],
): GraphNode | null {
  const roots = uniqIds([triggerNodeId ?? '', ...seedNodeIds]);
  if (roots.length === 0) {
    return null;
  }
  const loops: GraphNode[] = [];
  const seenNodes = new Set<string>();
  const seenLoops = new Set<string>();
  for (const root of roots) {
    if (!root || seenNodes.has(root)) {
      continue;
    }
    const component = collectConnectedNodeIds(root, snapshot.edges);
    for (const id of component) {
      seenNodes.add(id);
    }
    for (const node of snapshot.nodes) {
      if (node.type !== 'loop' || !component.includes(node.id) || seenLoops.has(node.id)) {
        continue;
      }
      seenLoops.add(node.id);
      loops.push(node);
    }
  }
  if (loops.length === 0) {
    return null;
  }
  if (loops.length > 1) {
    throw new BadRequestException('WORKFLOW_LOOP_AMBIGUOUS');
  }
  return loops[0] ?? null;
}

export function assertDirectWorkflowRunAllowed(
  snapshot: GraphSnapshot,
  input: {
    triggerNodeId?: string | null;
    seedNodeIds?: ReadonlyArray<string>;
    parentExecutionId?: string | null;
    allowLoopChildRun?: boolean;
  },
): void {
  if (input.parentExecutionId || input.allowLoopChildRun) {
    return;
  }
  const loop = findConnectedLoopNode(snapshot, input.triggerNodeId ?? null, input.seedNodeIds ?? []);
  if (loop) {
    throw new BadRequestException('WORKFLOW_LOOP_USE_CONTROLLER');
  }
}

export function resolveNodeSelection(
  snapshot: GraphSnapshot,
  triggerNodeId?: string | null,
  fallback?: AgentSelection,
): AgentSelection | null {
  const selection = resolveGraphNodeSelection({
    nodeId: triggerNodeId ?? null,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    fallback,
  });
  if (!selection) return null;
  return selection.model ? { type: selection.type, model: selection.model } : { type: selection.type };
}

export function findLatestWorkflowBound(
  snapshot: GraphSnapshot,
  templateNodeId: string,
  executionId?: string | null,
): WorkflowBoundSelection | null {
  let latest: WorkflowBoundSelection | null = null;
  for (const node of snapshot.nodes) {
    if (node.type !== 'input') continue;
    const content = readWorkflowInputContent(node.content);
    if (!content || content.mode !== 'bound' || content.templateNodeId !== templateNodeId) continue;
    if (executionId && content.executionId !== executionId) continue;
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

function directNeighborNodeIds(snapshot: GraphSnapshot, nodeId: string): string[] {
  const seen = new Set<string>();
  for (const edge of snapshot.edges) {
    if (edge.source === nodeId) {
      seen.add(edge.target);
    }
    if (edge.target === nodeId) {
      seen.add(edge.source);
    }
  }
  return [...seen];
}

export function readWorkflowSourceText(node: GraphNode): string | null {
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    return trimText(artifact?.excerpt ?? artifact?.summary, 8_000) ?? null;
  }
  if (node.type === 'agent_output') {
    return trimText(readString((node.content as { output?: unknown }).output), 8_000)
      ?? trimText(readString((node.content as { text?: unknown }).text), 8_000)
      ?? null;
  }
  if (node.type === 'file_summary') {
    const content = readFileSummaryContent(node.content);
    return trimText(
      content?.summary
        ?? content?.generatedSummary
        ?? content?.files?.[0]?.summary
        ?? content?.files?.[0]?.extractedText,
      8_000,
    ) ?? null;
  }
  return trimText(readString((node.content as { text?: unknown }).text), 8_000) ?? null;
}

export function readWorkflowInputSourceCandidate(
  template: WorkflowInputTemplate,
  node: GraphNode,
): WorkflowInputSourceCandidate | null {
  const accepts = template.accepts?.length ? template.accepts : ['text', 'image', 'file'];
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    if (!artifact || artifact.kind === 'directory') {
      return accepts.includes('text') && readWorkflowSourceText(node)
        ? { node, kind: 'text' }
        : null;
    }
    if (artifact.kind === 'image' && accepts.includes('image')) {
      return { node, kind: 'image' };
    }
    if (artifact.kind !== 'image' && accepts.includes('file')) {
      return { node, kind: 'file' };
    }
    return accepts.includes('text') && readWorkflowSourceText(node)
      ? { node, kind: 'text' }
      : null;
  }
  if (!accepts.includes('text')) {
    return null;
  }
  return readWorkflowSourceText(node) ? { node, kind: 'text' } : null;
}

export function findWorkflowInputSourceCandidates(
  snapshot: GraphSnapshot,
  template: WorkflowInputTemplateRow,
): WorkflowInputSourceCandidate[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return directNeighborNodeIds(snapshot, template.node.id).flatMap((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node || node.type === 'input') {
      return [];
    }
    const candidate = readWorkflowInputSourceCandidate(template.content, node);
    return candidate ? [candidate] : [];
  });
}

export function buildWorkflowInputSourceAssetPart(
  source: WorkflowInputSourceCandidate,
): Extract<WorkflowInputPart, { type: 'file' | 'image' }> | null {
  if (source.kind === 'text') {
    return null;
  }
  const artifact = readWorkflowArtifactContent(source.node.content);
  if (!artifact || artifact.kind === 'directory' || !artifact.relativePath.trim()) {
    return null;
  }
  const relativePath = resolveWorkflowArtifactRelativePath(artifact);
  const ext = path.extname(relativePath);
  const ref =
    artifact.claimRef
    ?? ((artifact.transferMode ?? 'reference') === 'claim_check' && artifact.sourceRunId
      ? claimRef(artifact.sourceRunId, relativePath)
      : undefined);
  const extractedText = readWorkflowSourceText(source.node) ?? undefined;
  return {
    id: randomUUID(),
    type: source.kind,
    file: {
      name: path.basename(relativePath),
      mimeType:
        artifact.mimeType
        ?? (source.kind === 'image'
          ? 'image/*'
          : artifact.kind === 'text'
            ? 'text/plain'
            : 'application/octet-stream'),
      size: artifact.size ?? 0,
      kind: source.kind === 'image' ? 'image' : artifact.kind === 'text' ? 'text' : 'binary',
      uploadedAt: source.node.updatedAt,
      ...(ext ? { extension: ext } : {}),
    },
    relativePath,
    transferMode: artifact.transferMode ?? 'reference',
    workspaceFileNodeId: source.node.id,
    ...(ref ? { claimRef: ref } : {}),
    ...(extractedText ? { extractedText } : {}),
  };
}

export function buildWorkflowInputPartsFromSource(source: WorkflowInputSourceCandidate): WorkflowInputPart[] {
  if (source.kind === 'text') {
    const text = readWorkflowSourceText(source.node);
    if (!text) {
      throw new BadRequestException(`WORKFLOW_INPUT_SOURCE_UNSUPPORTED:${source.node.id}`);
    }
    return [{ id: randomUUID(), type: 'text', text }];
  }
  const part = buildWorkflowInputSourceAssetPart(source);
  if (!part) {
    throw new BadRequestException(`WORKFLOW_INPUT_SOURCE_UNSUPPORTED:${source.node.id}`);
  }
  return [part];
}

export function buildWorkflowFileMap(files: WorkflowRunFile[]): Map<string, WorkflowRunFile[]> {
  const filesByField = new Map<string, WorkflowRunFile[]>();
  for (const file of files) {
    const field = file.fieldname?.trim() || 'file';
    const queue = filesByField.get(field) ?? [];
    queue.push(file);
    filesByField.set(field, queue);
  }
  return filesByField;
}

export function assertNoUnusedWorkflowFiles(filesByField: Map<string, WorkflowRunFile[]>): void {
  for (const queue of filesByField.values()) {
    if (queue.length > 0) {
      throw new BadRequestException('WORKFLOW_INPUT_UNUSED_UPLOADS');
    }
  }
}

function takeWorkflowRunFile(
  filesByField: Map<string, WorkflowRunFile[]>,
  field: string,
): WorkflowRunFile {
  const queue = filesByField.get(field);
  const file = queue?.shift();
  if (!file) {
    throw new BadRequestException(`WORKFLOW_INPUT_FILE_REQUIRED:${field}`);
  }
  return file;
}

export function buildWorkflowInputParts(
  value: WorkflowRunInputValue,
  filesByField: Map<string, WorkflowRunFile[]>,
): {
  parts: WorkflowInputPart[];
  assets: WorkflowInputAsset[];
} {
  const parts: WorkflowInputPart[] = [];
  const assets: WorkflowInputAsset[] = [];
  for (const item of value.parts) {
    if (item.type === 'text') {
      parts.push({
        id: randomUUID(),
        type: 'text',
        text: item.text,
      });
      continue;
    }

    const file = takeWorkflowRunFile(filesByField, item.field);
    const next = extractFileUpload({
      name: file.originalname || 'upload.bin',
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      buffer: file.buffer,
    });
    if (item.type === 'image' && next.file.kind !== 'image') {
      throw new BadRequestException(`WORKFLOW_INPUT_IMAGE_REQUIRED:${item.field}`);
    }
    const part = {
      id: randomUUID(),
      type: item.type,
      file: next.file,
      transferMode: item.transferMode ?? 'reference',
      ...(next.extractedText !== undefined ? { extractedText: next.extractedText } : {}),
      ...(next.extractedTextChars != null ? { extractedTextChars: next.extractedTextChars } : {}),
      ...(next.extractedTextTruncated != null
        ? { extractedTextTruncated: next.extractedTextTruncated }
        : {}),
    } as Extract<WorkflowInputPart, { type: 'file' | 'image' }>;
    parts.push(part);
    assets.push({ part, buffer: file.buffer });
  }
  return { parts, assets };
}

export function validateWorkflowInput(
  template: WorkflowInputTemplate | undefined,
  key: string,
  parts: WorkflowInputPart[],
): void {
  if (!template) return;
  if (!template.multiple && parts.length > 1) {
    throw new BadRequestException(`WORKFLOW_INPUT_SINGLE_VALUE_ONLY:${key}`);
  }
  if (!template.accepts?.length) return;
  for (const part of parts) {
    if (!template.accepts.includes(part.type)) {
      throw new BadRequestException(`WORKFLOW_INPUT_TYPE_UNSUPPORTED:${key}:${part.type}`);
    }
  }
}

export function normalizeWorkflowInputParts(
  template: WorkflowInputTemplate | undefined,
  parts: WorkflowInputPart[],
): WorkflowInputPart[] {
  if (!template?.multiple) {
    return parts;
  }
  const accepts = template.accepts?.length ? template.accepts : ['text', 'image', 'file'];
  if (accepts.length !== 1 || accepts[0] !== 'text') {
    return parts;
  }
  if (parts.length !== 1 || parts[0]?.type !== 'text') {
    return parts;
  }
  const lines = splitWorkflowTextParts(parts[0].text);
  if (lines.length <= 1) {
    return parts;
  }
  // For text-only list inputs, treat each inline line as one runtime part so loops can iterate them.
  return lines.map((text) => ({
    id: randomUUID(),
    type: 'text',
    text,
  }));
}

export function selectWorkflowInputSourceCandidates(input: {
  template: WorkflowInputTemplateRow;
  snapshot: GraphSnapshot;
  sourceNodeIds?: ReadonlyArray<string>;
}): WorkflowInputSourceCandidate[] {
  const candidates = findWorkflowInputSourceCandidates(input.snapshot, input.template);
  const requested = [...new Set(input.sourceNodeIds ?? [])];
  if (requested.length === 0) {
    return candidates.length === 1 ? candidates : [];
  }
  const selected = requested.map((sourceNodeId) => {
    const candidate = candidates.find((item) => item.node.id === sourceNodeId) ?? null;
    if (!candidate) {
      throw new BadRequestException(`WORKFLOW_INPUT_SOURCE_NOT_CONNECTED:${input.template.key}:${sourceNodeId}`);
    }
    return candidate;
  });
  if (!input.template.content.multiple && selected.length > 1) {
    throw new BadRequestException(`WORKFLOW_INPUT_SINGLE_VALUE_ONLY:${input.template.key}`);
  }
  return selected;
}
