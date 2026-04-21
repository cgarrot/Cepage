import { z } from 'zod';

export type GraphId = string;
export type NodeId = string;
export type EdgeId = string;
export type BranchId = string;
export type SessionId = string;
export type RunId = string;

export const creatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('human'), userId: z.string() }),
  z.object({ type: z.literal('agent'), agentType: z.string(), agentId: z.string() }),
  z.object({ type: z.literal('system'), reason: z.string() }),
]);

export type Creator = z.infer<typeof creatorSchema>;

export const wakeReasonSchema = z.enum([
  'human_prompt',
  'graph_change',
  'agent_mention',
  'scheduled',
  'manual',
  'approval_resolution',
  'external_event',
]);

export type WakeReason = z.infer<typeof wakeReasonSchema>;

export const nodeTypeSchema = z.enum([
  'human_message',
  'agent_message',
  'system_message',
  'system_trigger',
  'agent_step',
  'agent_spawn',
  'agent_output',
  'agent_status',
  'runtime_target',
  'runtime_run',
  'connector_target',
  'connector_run',
  'workspace_file',
  'file_summary',
  'file_snapshot',
  'file_diff',
  'code_block',
  'merge_result',
  'branch_point',
  'decision',
  'approval',
  'approval_request',
  'approval_resolution',
  'note',
  'input',
  'loop',
  'managed_flow',
  'workflow_copilot',
  'review_report',
  'test_report',
  'lease_conflict',
  'budget_alert',
  'worker_event',
  'integration_decision',
  'cluster',
  'sub_graph',
  'external_event',
  'human_request',
  'tag',
]);

export type NodeType = z.infer<typeof nodeTypeSchema>;

export const edgeRelationSchema = z.enum([
  'responds_to',
  'asks',
  'notifies',
  'references',
  'mentions',
  'validates',
  'confirms',
  'improves_on',
  'approves',
  'contradicts',
  'invalidates',
  'corrects',
  'forks_from',
  'merges',
  'contains',
  'belongs_to',
  'spawns',
  'feeds_into',
  'delegates',
  'produces',
  'revises',
  'supersedes',
  'derived_from',
  'observes',
  'monitors',
  'custom',
]);

export type EdgeRelation = z.infer<typeof edgeRelationSchema>;

export const edgeDirectionSchema = z.enum([
  'source_to_target',
  'target_to_source',
  'bidirectional',
]);

export type EdgeDirection = z.infer<typeof edgeDirectionSchema>;

export const nodeStatusSchema = z.enum([
  'draft',
  'active',
  'archived',
  'error',
]);

export type NodeStatus = z.infer<typeof nodeStatusSchema>;

/** Polymorphic content — validated lightly at API boundary */
export type NodeContent = Record<string, unknown>;

export interface SessionWorkspace {
  parentDirectory: string;
  directoryName: string;
  workingDirectory: string;
}

export const workspaceFileChangeKindSchema = z.enum(['added', 'modified', 'deleted']);
export type WorkspaceFileChangeKind = z.infer<typeof workspaceFileChangeKindSchema>;

export const webPreviewStatusSchema = z.enum([
  'idle',
  'available',
  'launching',
  'running',
  'error',
  'unavailable',
]);
export type WebPreviewStatus = z.infer<typeof webPreviewStatusSchema>;

export const webPreviewStrategySchema = z.enum(['static', 'script']);
export type WebPreviewStrategy = z.infer<typeof webPreviewStrategySchema>;

export interface WebPreviewInfo {
  status: WebPreviewStatus;
  strategy?: WebPreviewStrategy;
  framework?: string;
  root?: string;
  command?: string;
  port?: number;
  url?: string;
  embedPath?: string;
  error?: string;
}

export interface RunArtifactCounts {
  added: number;
  modified: number;
  deleted: number;
  total: number;
}

export interface RunArtifactSummaryEntry {
  path: string;
  kind: WorkspaceFileChangeKind;
}

export interface RunArtifactsSummary {
  runId: string;
  executionId?: string;
  ownerNodeId: string;
  outputNodeId?: string;
  cwd: string;
  generatedAt: string;
  counts: RunArtifactCounts;
  files: RunArtifactSummaryEntry[];
  preview: WebPreviewInfo;
}

export interface RunArtifactTextSnapshot {
  kind: 'text';
  text: string;
  size: number;
  truncated: boolean;
}

export interface RunArtifactBinarySnapshot {
  kind: 'binary';
  size: number;
}

export interface RunArtifactMissingSnapshot {
  kind: 'missing';
  size: number;
}

export type RunArtifactFileSnapshot =
  | RunArtifactTextSnapshot
  | RunArtifactBinarySnapshot
  | RunArtifactMissingSnapshot;

export interface RunArtifactFileChange {
  path: string;
  kind: WorkspaceFileChangeKind;
  before?: RunArtifactFileSnapshot;
  after?: RunArtifactFileSnapshot;
}

export interface RunArtifactsBundle {
  summary: RunArtifactsSummary;
  files: RunArtifactFileChange[];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readRunArtifactsSummary(value: unknown): RunArtifactsSummary | null {
  const direct = readRecord(value);
  const summary = readRecord(direct?.summary) ?? readRecord(direct?.artifacts) ?? direct;
  if (!summary) return null;
  const ownerNodeId =
    typeof summary.ownerNodeId === 'string'
      ? summary.ownerNodeId
      : typeof summary.outputNodeId === 'string'
        ? summary.outputNodeId
        : null;
  if (typeof summary.runId !== 'string' || !ownerNodeId || typeof summary.cwd !== 'string') {
    return null;
  }
  return {
    ...(summary as unknown as RunArtifactsSummary),
    ownerNodeId,
  };
}

export function readRunArtifactsBundle(value: unknown): RunArtifactsBundle | null {
  const direct = readRecord(value);
  const bundle = readRecord(direct?.artifacts) ?? direct;
  if (!bundle) return null;
  const summary = readRunArtifactsSummary(bundle.summary);
  if (!summary || !Array.isArray(bundle.files)) return null;
  return {
    summary,
    files: bundle.files as RunArtifactFileChange[],
  };
}

export interface GraphNode {
  id: NodeId;
  type: NodeType;
  createdAt: string;
  updatedAt: string;
  content: NodeContent;
  creator: Creator;
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
  metadata: Record<string, unknown>;
  status: NodeStatus;
  branches: BranchId[];
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  relation: EdgeRelation;
  direction: EdgeDirection;
  strength: number;
  createdAt: string;
  creator: Creator;
  metadata: Record<string, unknown>;
}

export interface Branch {
  id: BranchId;
  name: string;
  color: string;
  createdAt: string;
  createdBy: Creator;
  headNodeId: NodeId;
  nodeIds: NodeId[];
  parentBranchId?: BranchId;
  forkedFromNodeId?: NodeId;
  status: 'active' | 'merged' | 'abandoned';
  mergedIntoBranchId?: BranchId;
}

export interface GraphSnapshot {
  version: 1;
  id: SessionId;
  createdAt: string;
  lastEventId?: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  branches: Branch[];
  viewport: { x: number; y: number; zoom: number };
}

export type GraphEventPayload =
  | { type: 'node_added'; nodeId: NodeId; node: GraphNode }
  | { type: 'node_updated'; nodeId: NodeId; patch: Partial<GraphNode> }
  | { type: 'node_removed'; nodeId: NodeId; affectedEdges: EdgeId[] }
  | { type: 'edge_added'; edgeId: EdgeId; edge: GraphEdge }
  | { type: 'edge_removed'; edgeId: EdgeId; edge: GraphEdge }
  | { type: 'branch_created'; branchId: BranchId; branch: Branch }
  | { type: 'branch_merged'; sourceBranchId: BranchId; targetBranchId: BranchId }
  | { type: 'branch_abandoned'; branchId: BranchId }
  | { type: 'graph_cleared' }
  | { type: 'graph_restored'; snapshot: GraphSnapshot };

export interface GraphEventEnvelope {
  eventId: number;
  sessionId: SessionId;
  actor: Creator;
  runId?: RunId;
  wakeReason?: WakeReason;
  requestId?: string;
  workerId?: string;
  worktreeId?: string;
  timestamp: string;
  payload: GraphEventPayload;
}

export type GraphEvent = GraphEventEnvelope;
