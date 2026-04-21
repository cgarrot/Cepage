import type {
  AgentRun,
  GraphNode,
  TimelineEntry,
  WorkflowCopilotApplySummary,
  WorkflowCopilotAttachment,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotMessage,
  WorkflowCopilotMessageRole,
  WorkflowCopilotMessageStatus,
  WorkflowCopilotScope,
  WorkflowExecution,
} from '@cepage/shared-core';
import { readWorkflowArtifactContent } from '@cepage/shared-core';

/**
 * Timeline view-model for the unified chat surface.
 *
 * The store keeps a {@link GraphNode}[] (already filtered by branch). Rather
 * than letting each block component re-discover what a node means, the chat
 * shell consumes a typed, ordered list of {@link ChatTimelineItem}. Each item
 * carries the minimal data a block needs and a `node` reference for advanced
 * actions (focus in studio, copy id, etc.).
 *
 * Important guarantees:
 * - Items are sorted by `createdAt` ascending; ties broken by node id.
 * - Items keep `kind` discriminator stable so React rendering stays cheap.
 * - We never include nodes whose payload is unusable (empty text, missing
 *   path, etc.) so the chat doesn't show ghost rows.
 */

export type ChatActor =
  | { kind: 'human'; userId: string }
  | { kind: 'agent'; agentType: string; agentId: string }
  | { kind: 'system'; reason: string };

export type ChatModelRef = {
  providerId: string;
  modelId: string;
};

export type ChatTimelineHumanMessage = {
  kind: 'human_message';
  id: string;
  createdAt: string;
  actor: ChatActor;
  text: string;
  format: 'markdown' | 'text';
  node: GraphNode;
};

export type ChatTimelineAgentMessage = {
  kind: 'agent_message';
  id: string;
  createdAt: string;
  actor: ChatActor;
  text: string;
  format: 'markdown' | 'text';
  agentType?: string;
  model?: ChatModelRef;
  node: GraphNode;
};

export type ChatTimelineSystemMessage = {
  kind: 'system_message';
  id: string;
  createdAt: string;
  actor: ChatActor;
  text: string;
  level: 'info' | 'warn' | 'error';
  node: GraphNode;
};

export type ChatTimelineAgentSpawn = {
  kind: 'agent_spawn';
  id: string;
  createdAt: string;
  actor: ChatActor;
  agentType: string;
  model?: ChatModelRef;
  workingDirectory?: string;
  triggerNodeId?: string;
  node: GraphNode;
};

export type ChatTimelineAgentStep = {
  kind: 'agent_step';
  id: string;
  createdAt: string;
  actor: ChatActor;
  agentType?: string;
  model?: ChatModelRef;
  label?: string;
  role?: string;
  brief?: string;
  node: GraphNode;
};

export type ChatTimelineAgentOutput = {
  kind: 'agent_output';
  id: string;
  createdAt: string;
  actor: ChatActor;
  text: string;
  stream: 'stdout' | 'stderr' | 'mixed';
  isStreaming: boolean;
  agentRunId?: string;
  node: GraphNode;
};

export type ChatTimelineFile = {
  kind: 'workspace_file';
  id: string;
  createdAt: string;
  actor: ChatActor;
  title: string;
  path: string;
  resolvedPath?: string;
  role: 'input' | 'output' | 'intermediate';
  origin: 'user_upload' | 'agent_output' | 'workspace_existing' | 'derived';
  status: 'declared' | 'available' | 'missing' | 'deleted';
  change?: 'added' | 'modified' | 'deleted';
  summary?: string;
  excerpt?: string;
  mimeType?: string;
  node: GraphNode;
};

export type ChatTimelineCopilotMessage = {
  kind: 'copilot_message';
  id: string;
  createdAt: string;
  role: WorkflowCopilotMessageRole;
  status: WorkflowCopilotMessageStatus;
  text: string;
  analysis?: string;
  summary: readonly string[];
  warnings: readonly string[];
  attachments: readonly WorkflowCopilotAttachment[];
  apply?: WorkflowCopilotApplySummary;
  /** Number of architectural ops the agent proposes; > 0 enables the Apply CTA. */
  opCount: number;
  rawOutput?: string;
  /**
   * Live reasoning stream replayed by the Copilot panel as a collapsible
   * "Thinking…" section. Stays undefined when the agent doesn't surface a
   * separate chain-of-thought channel.
   */
  thinkingOutput?: string;
  error?: string;
  agentType?: string;
  model?: ChatModelRef;
  scope?: WorkflowCopilotScope;
  message: WorkflowCopilotMessage;
};

export type ChatTimelineCopilotCheckpoint = {
  kind: 'copilot_checkpoint';
  id: string;
  createdAt: string;
  /** The user message id this checkpoint was created for (used for placement). */
  forUserMessageId?: string;
  summary: readonly string[];
  restoredAt?: string;
  checkpoint: WorkflowCopilotCheckpoint;
};

/**
 * One entry of the fallback chain lineage for a workflow execution. The chain
 * is built from AgentRun rows linked by `retryOfRunId` — the primary run is
 * the one without `retryOfRunId`, then siblings follow in chronological order.
 */
export type ChatTimelineExecutionSibling = {
  runId: string;
  model?: ChatModelRef;
  status: AgentRun['status'];
  startedAt?: string;
  endedAt?: string;
  isPrimary: boolean;
};

/**
 * Live fallback-switch event (from the activity feed with
 * `summaryKey: 'activity.agent_fallback_switch'`), surfaced inline in the
 * execution block so the user sees exactly which model was swapped and why.
 */
export type ChatTimelineExecutionFallback = {
  id: string;
  at: string;
  fromModel?: ChatModelRef;
  toModel?: ChatModelRef;
  reason: string;
};

/**
 * Unified execution block that aggregates every AgentRun belonging to a
 * single `executionId` (primary + fallback siblings), the agent_step nodes
 * attached to those runs, and any fallback-switch activity events. The chat
 * shell renders this as a single collapsible card, replacing the individual
 * spawn/step blocks that would otherwise scatter across the transcript.
 */
export type ChatTimelineExecution = {
  kind: 'execution';
  id: string;
  createdAt: string;
  actor: ChatActor;
  agentType: string;
  configuredModel?: ChatModelRef;
  calledModel?: ChatModelRef;
  status: AgentRun['status'];
  isStreaming: boolean;
  output: string;
  siblings: readonly ChatTimelineExecutionSibling[];
  steps: readonly ChatTimelineAgentStep[];
  fallbackEvents: readonly ChatTimelineExecutionFallback[];
  triggerNodeId?: string;
  stepNodeId?: string;
  startedAt?: string;
  endedAt?: string;
  currentRunId: string;
};

export type ChatTimelineItem =
  | ChatTimelineHumanMessage
  | ChatTimelineAgentMessage
  | ChatTimelineSystemMessage
  | ChatTimelineAgentSpawn
  | ChatTimelineAgentStep
  | ChatTimelineAgentOutput
  | ChatTimelineFile
  | ChatTimelineCopilotMessage
  | ChatTimelineCopilotCheckpoint
  | ChatTimelineExecution;

const CHAT_NODE_TYPES: ReadonlySet<GraphNode['type']> = new Set([
  'human_message',
  'agent_message',
  'system_message',
  'agent_spawn',
  'agent_step',
  'agent_output',
  'workspace_file',
]);

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readActor(creator: GraphNode['creator']): ChatActor {
  if (creator.type === 'human') {
    return { kind: 'human', userId: creator.userId };
  }
  if (creator.type === 'agent') {
    return { kind: 'agent', agentType: creator.agentType, agentId: creator.agentId };
  }
  return { kind: 'system', reason: creator.reason };
}

function readModelRef(value: unknown): ChatModelRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const provider = readString((value as { providerID?: unknown }).providerID);
  const modelId = readString((value as { modelID?: unknown }).modelID);
  if (!provider || !modelId) return undefined;
  return { providerId: provider, modelId };
}

function readLevel(value: unknown): 'info' | 'warn' | 'error' {
  if (value === 'warn' || value === 'warning') return 'warn';
  if (value === 'error' || value === 'fatal') return 'error';
  return 'info';
}

function readStream(value: unknown): 'stdout' | 'stderr' | 'mixed' {
  if (value === 'stderr') return 'stderr';
  if (value === 'mixed') return 'mixed';
  return 'stdout';
}

function buildHumanMessage(node: GraphNode): ChatTimelineHumanMessage | null {
  const text = readString((node.content as { text?: unknown }).text);
  if (!text) return null;
  const fmt = (node.content as { format?: unknown }).format;
  return {
    kind: 'human_message',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    text,
    format: fmt === 'text' ? 'text' : 'markdown',
    node,
  };
}

function buildAgentMessage(node: GraphNode): ChatTimelineAgentMessage | null {
  const text = readString((node.content as { text?: unknown }).text);
  if (!text) return null;
  const fmt = (node.content as { format?: unknown }).format;
  const model = readModelRef((node.content as { model?: unknown }).model);
  const agentType =
    readString((node.content as { agentType?: unknown }).agentType) ??
    (node.creator.type === 'agent' ? node.creator.agentType : undefined);
  return {
    kind: 'agent_message',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    text,
    format: fmt === 'text' ? 'text' : 'markdown',
    ...(agentType ? { agentType } : {}),
    ...(model ? { model } : {}),
    node,
  };
}

function buildSystemMessage(node: GraphNode): ChatTimelineSystemMessage | null {
  const text = readString((node.content as { text?: unknown }).text);
  if (!text) return null;
  return {
    kind: 'system_message',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    text,
    level: readLevel((node.content as { level?: unknown }).level),
    node,
  };
}

function buildAgentSpawn(node: GraphNode): ChatTimelineAgentSpawn {
  const content = node.content as {
    agentType?: unknown;
    model?: unknown;
    config?: { workingDirectory?: unknown; triggerNodeId?: unknown };
  };
  const agentType = readString(content.agentType) ?? 'unknown';
  return {
    kind: 'agent_spawn',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    agentType,
    ...(readModelRef(content.model) ? { model: readModelRef(content.model)! } : {}),
    ...(readString(content.config?.workingDirectory)
      ? { workingDirectory: readString(content.config?.workingDirectory)! }
      : {}),
    ...(readString(content.config?.triggerNodeId)
      ? { triggerNodeId: readString(content.config?.triggerNodeId)! }
      : {}),
    node,
  };
}

function buildAgentStep(node: GraphNode): ChatTimelineAgentStep {
  const content = node.content as {
    agentType?: unknown;
    model?: unknown;
    label?: unknown;
    role?: unknown;
  };
  const meta = node.metadata as { brief?: unknown; role?: unknown };
  return {
    kind: 'agent_step',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    ...(readString(content.agentType) ? { agentType: readString(content.agentType)! } : {}),
    ...(readModelRef(content.model) ? { model: readModelRef(content.model)! } : {}),
    ...(readString(content.label) ? { label: readString(content.label)! } : {}),
    ...(readString(content.role) ?? readString(meta?.role)
      ? { role: (readString(content.role) ?? readString(meta?.role))! }
      : {}),
    ...(readString(meta?.brief) ? { brief: readString(meta?.brief)! } : {}),
    node,
  };
}

function buildAgentOutput(node: GraphNode): ChatTimelineAgentOutput | null {
  const content = node.content as {
    output?: unknown;
    outputType?: unknown;
    isStreaming?: unknown;
  };
  const text = readString(content.output);
  if (!text) return null;
  const meta = node.metadata as { agentRunId?: unknown };
  return {
    kind: 'agent_output',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    text,
    stream: readStream(content.outputType),
    isStreaming: content.isStreaming === true,
    ...(readString(meta?.agentRunId) ? { agentRunId: readString(meta?.agentRunId)! } : {}),
    node,
  };
}

function buildWorkspaceFile(node: GraphNode): ChatTimelineFile | null {
  const artifact = readWorkflowArtifactContent(node.content);
  if (!artifact) return null;
  const path = artifact.relativePath;
  if (!path) return null;
  return {
    kind: 'workspace_file',
    id: node.id,
    createdAt: node.createdAt,
    actor: readActor(node.creator),
    title: artifact.title?.trim() || path,
    path,
    ...(artifact.resolvedRelativePath?.trim()
      ? { resolvedPath: artifact.resolvedRelativePath.trim() }
      : {}),
    role: artifact.role,
    origin: artifact.origin,
    status: artifact.status ?? 'declared',
    ...(artifact.change ? { change: artifact.change } : {}),
    ...(artifact.summary?.trim() ? { summary: artifact.summary.trim() } : {}),
    ...(artifact.excerpt?.trim() ? { excerpt: artifact.excerpt.trim() } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    node,
  };
}

function buildItem(node: GraphNode): ChatTimelineItem | null {
  switch (node.type) {
    case 'human_message':
      return buildHumanMessage(node);
    case 'agent_message':
      return buildAgentMessage(node);
    case 'system_message':
      return buildSystemMessage(node);
    case 'agent_spawn':
      return buildAgentSpawn(node);
    case 'agent_step':
      return buildAgentStep(node);
    case 'agent_output':
      return buildAgentOutput(node);
    case 'workspace_file':
      return buildWorkspaceFile(node);
    default:
      return null;
  }
}

function compareItems(a: ChatTimelineItem, b: ChatTimelineItem): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the chat timeline from the (already branch-filtered) graph nodes.
 * Pure & memoizable — same input produces the same array reference shape.
 */
export function selectChatTimeline(nodes: readonly GraphNode[]): ChatTimelineItem[] {
  const out: ChatTimelineItem[] = [];
  for (const node of nodes) {
    if (!CHAT_NODE_TYPES.has(node.type)) continue;
    const item = buildItem(node);
    if (item) out.push(item);
  }
  out.sort(compareItems);
  return out;
}

/**
 * Subset of timeline filtered to "speakable" rows (everything except agent
 * outputs that should normally be folded under their parent step).
 */
export function selectChatConversation(nodes: readonly GraphNode[]): ChatTimelineItem[] {
  return selectChatTimeline(nodes).filter((item) => item.kind !== 'agent_output');
}

const EXECUTION_ACTIVE_STATUSES: ReadonlySet<AgentRun['status']> = new Set([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

function normalizeAgentModel(model: { providerID: string; modelID: string } | undefined): ChatModelRef | undefined {
  if (!model) return undefined;
  return { providerId: model.providerID, modelId: model.modelID };
}

function pickExecutionCurrentRun(
  sortedRuns: readonly AgentRun[],
  execution: WorkflowExecution | undefined,
): AgentRun | undefined {
  if (sortedRuns.length === 0) return undefined;
  const byId = new Map(sortedRuns.map((run) => [run.id, run]));
  if (execution?.currentRunId && byId.has(execution.currentRunId)) {
    return byId.get(execution.currentRunId);
  }
  if (execution?.latestRunId && byId.has(execution.latestRunId)) {
    return byId.get(execution.latestRunId);
  }
  const active = sortedRuns.find((run) => EXECUTION_ACTIVE_STATUSES.has(run.status));
  if (active) return active;
  return sortedRuns[sortedRuns.length - 1];
}

function readFallbackParams(entry: TimelineEntry): {
  fromProvider?: string;
  fromModel?: string;
  toProvider?: string;
  toModel?: string;
  reason?: string;
} {
  const params = entry.summaryParams ?? {};
  const read = (key: string): string | undefined => {
    const value = (params as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };
  return {
    fromProvider: read('fromProvider'),
    fromModel: read('fromModel'),
    toProvider: read('toProvider'),
    toModel: read('toModel'),
    reason: read('reason'),
  };
}

function buildExecutionSiblings(sortedRuns: readonly AgentRun[]): ChatTimelineExecutionSibling[] {
  const primary = sortedRuns.find((run) => !run.retryOfRunId) ?? sortedRuns[0];
  return sortedRuns.map((run) => {
    const entry: ChatTimelineExecutionSibling = {
      runId: run.id,
      status: run.status,
      isPrimary: primary != null && run.id === primary.id,
    };
    const model = normalizeAgentModel(run.model);
    if (model) entry.model = model;
    if (run.startedAt) entry.startedAt = run.startedAt;
    if (run.endedAt) entry.endedAt = run.endedAt;
    return entry;
  });
}

function buildExecutionFallbackEvents(
  sortedRuns: readonly AgentRun[],
  activity: readonly TimelineEntry[],
): ChatTimelineExecutionFallback[] {
  if (sortedRuns.length === 0 || activity.length === 0) return [];
  const runIds = new Set(sortedRuns.map((run) => run.id));
  const out: ChatTimelineExecutionFallback[] = [];
  for (const entry of activity) {
    if (entry.summaryKey !== 'activity.agent_fallback_switch') continue;
    if (!entry.runId || !runIds.has(entry.runId)) continue;
    const params = readFallbackParams(entry);
    const fromModel =
      params.fromProvider && params.fromModel
        ? { providerId: params.fromProvider, modelId: params.fromModel }
        : undefined;
    const toModel =
      params.toProvider && params.toModel
        ? { providerId: params.toProvider, modelId: params.toModel }
        : undefined;
    const event: ChatTimelineExecutionFallback = {
      id: entry.id,
      at: entry.timestamp,
      reason: params.reason ?? entry.summary ?? '',
    };
    if (fromModel) event.fromModel = fromModel;
    if (toModel) event.toModel = toModel;
    out.push(event);
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return out;
}

function buildExecutionItem(
  executionId: string,
  runs: readonly AgentRun[],
  execution: WorkflowExecution | undefined,
  nodesById: ReadonlyMap<string, GraphNode>,
  steps: readonly ChatTimelineAgentStep[],
  activity: readonly TimelineEntry[],
): ChatTimelineExecution | null {
  if (runs.length === 0 && !execution) return null;

  const sortedRuns = [...runs].sort((a, b) => {
    const aAt = a.startedAt ?? '';
    const bAt = b.startedAt ?? '';
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const primary = sortedRuns.find((run) => !run.retryOfRunId) ?? sortedRuns[0];
  const current = pickExecutionCurrentRun(sortedRuns, execution) ?? primary;
  if (!current) return null;

  const stepNode = current.stepNodeId ? nodesById.get(current.stepNodeId) : undefined;
  const rootNode = current.rootNodeId ? nodesById.get(current.rootNodeId) : undefined;
  const configuredModel =
    readModelRef((stepNode?.content as { model?: unknown } | undefined)?.model) ??
    readModelRef((rootNode?.content as { model?: unknown } | undefined)?.model) ??
    normalizeAgentModel(primary?.model);
  const calledModel = normalizeAgentModel(current.model);

  const agentType = current.type ?? execution?.type ?? primary?.type ?? 'opencode';
  const status = current.status ?? execution?.status ?? 'pending';
  const isStreaming = current.isStreaming === true;
  const output = typeof current.outputText === 'string' ? current.outputText : '';
  const createdAt =
    primary?.startedAt ??
    execution?.startedAt ??
    execution?.createdAt ??
    current.startedAt ??
    new Date(0).toISOString();

  // Sort steps so the UI sees them in chronological order. Ties broken by id
  // for deterministic output (matches compareItems semantics).
  const sortedSteps = [...steps].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const lastEnded = sortedRuns
    .map((run) => run.endedAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0];

  const item: ChatTimelineExecution = {
    kind: 'execution',
    id: executionId,
    createdAt,
    actor: { kind: 'agent', agentType, agentId: current.id },
    agentType,
    status,
    isStreaming,
    output,
    siblings: buildExecutionSiblings(sortedRuns),
    steps: sortedSteps,
    fallbackEvents: buildExecutionFallbackEvents(sortedRuns, activity),
    currentRunId: current.id,
  };
  if (configuredModel) item.configuredModel = configuredModel;
  if (calledModel) item.calledModel = calledModel;
  const triggerNodeId = current.triggerNodeId ?? execution?.triggerNodeId;
  if (triggerNodeId) item.triggerNodeId = triggerNodeId;
  const stepNodeId = current.stepNodeId ?? execution?.stepNodeId;
  if (stepNodeId) item.stepNodeId = stepNodeId;
  if (primary?.startedAt) item.startedAt = primary.startedAt;
  if (lastEnded) item.endedAt = lastEnded;
  return item;
}

function executionIdForOwnedNode(
  nodeId: string,
  runsByExecution: ReadonlyMap<string, AgentRun[]>,
): string | undefined {
  for (const [executionId, runs] of runsByExecution) {
    for (const run of runs) {
      if (run.rootNodeId === nodeId || run.stepNodeId === nodeId) return executionId;
    }
  }
  return undefined;
}

function buildCopilotMessageItem(message: WorkflowCopilotMessage): ChatTimelineCopilotMessage {
  const text = message.content ?? '';
  const summary = Array.isArray(message.summary) ? message.summary : [];
  const warnings = Array.isArray(message.warnings) ? message.warnings : [];
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const ops = Array.isArray(message.ops) ? message.ops.length : 0;
  const model = readModelRef(message.model);
  const item: ChatTimelineCopilotMessage = {
    kind: 'copilot_message',
    id: `copilot:${message.id}`,
    createdAt: message.createdAt,
    role: message.role,
    status: message.status,
    text,
    summary,
    warnings,
    attachments,
    opCount: ops,
    message,
  };
  if (message.analysis && message.analysis.trim().length > 0) item.analysis = message.analysis;
  if (message.apply) item.apply = message.apply;
  if (message.rawOutput && message.rawOutput.trim().length > 0) item.rawOutput = message.rawOutput;
  if (message.thinkingOutput && message.thinkingOutput.trim().length > 0)
    item.thinkingOutput = message.thinkingOutput;
  if (message.error && message.error.trim().length > 0) item.error = message.error;
  if (message.agentType) item.agentType = message.agentType;
  if (model) item.model = model;
  if (message.scope) item.scope = message.scope;
  return item;
}

function buildCopilotCheckpointItem(
  checkpoint: WorkflowCopilotCheckpoint,
  forUserMessageId: string | undefined,
): ChatTimelineCopilotCheckpoint {
  const item: ChatTimelineCopilotCheckpoint = {
    kind: 'copilot_checkpoint',
    id: `copilot:checkpoint:${checkpoint.id}`,
    createdAt: checkpoint.createdAt,
    summary: Array.isArray(checkpoint.summary) ? checkpoint.summary : [],
    checkpoint,
  };
  if (forUserMessageId) item.forUserMessageId = forUserMessageId;
  if (checkpoint.restoredAt) item.restoredAt = checkpoint.restoredAt;
  return item;
}

/**
 * Build a unified chat timeline that merges {@link GraphNode}-derived items
 * with Copilot messages and checkpoints. Copilot messages are inserted at
 * their `createdAt` so they interleave naturally with `human_message` and
 * `agent_message` graph nodes; checkpoints are placed right after the user
 * message they were created for (or at their own `createdAt` if no parent
 * message can be matched).
 *
 * The selector is pure: same input → same shape, safe to memoize.
 */
export function selectUnifiedChatTimeline(input: {
  nodes: readonly GraphNode[];
  copilotMessages?: readonly WorkflowCopilotMessage[];
  copilotCheckpoints?: readonly WorkflowCopilotCheckpoint[];
  agentRuns?: Readonly<Record<string, AgentRun>>;
  executions?: Readonly<Record<string, WorkflowExecution>>;
  activity?: readonly TimelineEntry[];
}): ChatTimelineItem[] {
  const runsArr: readonly AgentRun[] = input.agentRuns ? Object.values(input.agentRuns) : [];
  const executionsIndex = input.executions ?? {};
  const activity = input.activity ?? [];

  // Index runs by executionId. Only executions that have at least one run are
  // promoted to a ChatTimelineExecution block — executions without runs keep
  // the legacy "spawn → step → output" rendering so the UI still shows the
  // designed workflow before it has been kicked off.
  const runsByExecution = new Map<string, AgentRun[]>();
  const executionByRunId = new Map<string, string>();
  for (const run of runsArr) {
    if (!run.executionId) continue;
    const arr = runsByExecution.get(run.executionId) ?? [];
    arr.push(run);
    runsByExecution.set(run.executionId, arr);
    executionByRunId.set(run.id, run.executionId);
  }

  const rawItems = selectChatTimeline(input.nodes);

  // Back-compat short-circuit: when no runs are provided we keep the exact
  // output shape the existing tests rely on — no execution blocks, every
  // graph node renders standalone as before.
  const items: ChatTimelineItem[] = [];
  const stepsByExecution = new Map<string, ChatTimelineAgentStep[]>();

  if (runsByExecution.size === 0) {
    items.push(...rawItems);
  } else {
    for (const item of rawItems) {
      if (item.kind === 'agent_spawn') {
        const creatorAgentId = item.actor.kind === 'agent' ? item.actor.agentId : undefined;
        const executionId =
          (creatorAgentId ? executionByRunId.get(creatorAgentId) : undefined) ??
          executionIdForOwnedNode(item.id, runsByExecution);
        if (executionId) continue; // subsumed into the execution block
        items.push(item);
        continue;
      }
      if (item.kind === 'agent_step') {
        const creatorAgentId = item.actor.kind === 'agent' ? item.actor.agentId : undefined;
        const executionId =
          (creatorAgentId ? executionByRunId.get(creatorAgentId) : undefined) ??
          executionIdForOwnedNode(item.id, runsByExecution);
        if (executionId) {
          const arr = stepsByExecution.get(executionId) ?? [];
          arr.push(item);
          stepsByExecution.set(executionId, arr);
          continue;
        }
        items.push(item);
        continue;
      }
      items.push(item);
    }

    const nodesById = new Map(input.nodes.map((n) => [n.id, n]));
    for (const [executionId, runs] of runsByExecution) {
      const execution = executionsIndex[executionId];
      const steps = stepsByExecution.get(executionId) ?? [];
      const block = buildExecutionItem(
        executionId,
        runs,
        execution,
        nodesById,
        steps,
        activity,
      );
      if (block) items.push(block);
    }
  }

  const messages = input.copilotMessages ?? [];
  for (const message of messages) {
    items.push(buildCopilotMessageItem(message));
  }
  const checkpoints = input.copilotCheckpoints ?? [];
  // Map checkpoint -> the user message right before its assistant message so
  // we can render them under the user's prompt (matches WorkflowCopilotPanel).
  const messagesByThread = new Map<string, WorkflowCopilotMessage[]>();
  for (const message of messages) {
    const arr = messagesByThread.get(message.threadId) ?? [];
    arr.push(message);
    messagesByThread.set(message.threadId, arr);
  }
  for (const arr of messagesByThread.values()) {
    arr.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
    );
  }
  for (const checkpoint of checkpoints) {
    const arr = messagesByThread.get(checkpoint.threadId) ?? [];
    const assistantIdx = arr.findIndex((m) => m.id === checkpoint.messageId);
    let userMessageId: string | undefined;
    if (assistantIdx > 0) {
      for (let i = assistantIdx - 1; i >= 0; i -= 1) {
        if (arr[i]!.role === 'user') {
          userMessageId = arr[i]!.id;
          break;
        }
      }
    }
    items.push(buildCopilotCheckpointItem(checkpoint, userMessageId));
  }
  items.sort(compareItems);
  return items;
}
