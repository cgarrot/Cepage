import type {
  ApprovalRequest,
  AgentCatalog,
  InputNodeStartRequest,
  InputNodeStartResult,
  AgentRerunRequest,
  AgentRun,
  WorkflowExecution,
  AgentSpawnRequest,
  Branch,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  ExecutionLease,
  RuntimeRunSummary,
  RunArtifactFileChange,
  RunArtifactFileSnapshot,
  RunArtifactsBundle,
  SessionWorkspace,
  TimelineEntry,
  TimelinePage,
  WorkflowControllerRunRequest,
  WorkflowControllerRunResult,
  WorkflowControllerState,
  WorkflowManagedFlowRunRequest,
  WorkflowManagedFlowRunResult,
  WorkflowManagedFlowState,
  WorkflowTransfer,
  WorkflowRunRequest,
  WorkflowRunResult,
  WebPreviewInfo,
} from '@cepage/shared-core';
import { getApiBaseUrl } from './config';
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from './http';

export type SessionMeta = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  workspace: SessionWorkspace | null;
};

export type SessionLibraryRow = SessionMeta & {
  lastEventId: number;
  counts: { nodes: number; edges: number; agentRuns: number };
};

export async function createSession(name: string) {
  return apiPost<SessionMeta>('/api/v1/sessions', { name });
}

export type SessionFromSkillBody = {
  name?: string;
  workspace?: { parentDirectory?: string; directoryName?: string };
  seed?: {
    files?: Array<{ path: string; content: string }>;
    directories?: Array<{ source: string; destination: string }>;
  };
  agent?: { agentType: string; providerID: string; modelID: string };
  workflowTransfer?: WorkflowTransfer;
  copilot?: {
    title?: string;
    message?: string;
    autoApply?: boolean;
    autoRun?: boolean;
  };
  autoRun?: boolean;
};

export type SessionFromSkillResult = {
  sessionId: string;
  skillId: string;
  workspaceDir: string | null;
  mode: 'workflow_transfer' | 'copilot' | 'empty';
  threadId?: string;
  copilotMessageId?: string;
  flowNodeId?: string;
  flowId?: string;
  flowStatus?: string;
};

export async function createSessionFromSkill(skillId: string, body: SessionFromSkillBody) {
  return apiPost<SessionFromSkillResult>(
    `/api/v1/sessions/from-skill/${encodeURIComponent(skillId)}`,
    body,
  );
}

export async function listSessions(opts?: {
  q?: string;
  status?: 'active' | 'archived';
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.q) params.set('q', opts.q);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return apiGet<{ items: SessionLibraryRow[]; total: number; limit: number; offset: number }>(
    `/api/v1/sessions${qs ? `?${qs}` : ''}`,
  );
}

export async function duplicateSession(sessionId: string, name?: string) {
  return apiPost<SessionMeta>(`/api/v1/sessions/${sessionId}/duplicate`, name ? { name } : {});
}

export async function patchSessionStatus(sessionId: string, status: 'active' | 'archived') {
  return apiPatch<SessionMeta>(`/api/v1/sessions/${sessionId}`, { status });
}

export async function deleteArchivedSession(sessionId: string) {
  return apiDelete<{ deleted: true }>(`/api/v1/sessions/${sessionId}`);
}

export async function getGraphBundle(sessionId: string) {
  return apiGet<{
    session: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      status: 'active' | 'archived';
      workspace: SessionWorkspace | null;
    };
    nodes: GraphNode[];
    edges: GraphEdge[];
    branches: Branch[];
    agentRuns: AgentRun[];
    workflowExecutions: WorkflowExecution[];
    workflowControllers?: WorkflowControllerState[];
    workflowFlows?: WorkflowManagedFlowState[];
    activeLeases?: ExecutionLease[];
    pendingApprovals?: ApprovalRequest[];
    viewport: { x: number; y: number; zoom: number };
    lastEventId: number;
    activity: TimelineEntry[];
    activityNextCursor: string | null;
    activityHasMore: boolean;
  }>(`/api/v1/sessions/${sessionId}/graph`);
}

export async function getTimeline(
  sessionId: string,
  opts?: {
    limit?: number;
    before?: string;
    actorType?: 'human' | 'agent' | 'system';
    runId?: string;
  },
) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  if (opts?.actorType) params.set('actorType', opts.actorType);
  if (opts?.runId) params.set('runId', opts.runId);
  const qs = params.toString();
  return apiGet<TimelinePage>(`/api/v1/sessions/${sessionId}/timeline${qs ? `?${qs}` : ''}`);
}

export async function exportWorkflow(sessionId: string) {
  return apiGet<WorkflowTransfer>(`/api/v1/sessions/${sessionId}/workflow/export`);
}

export async function importWorkflowReplace(sessionId: string, flow: WorkflowTransfer) {
  return apiPost<{
    eventId: number;
    counts: {
      nodes: number;
      edges: number;
      branches: number;
    };
  }>(`/api/v1/sessions/${sessionId}/workflow/import`, flow);
}

export async function updateSessionWorkspace(
  sessionId: string,
  body: {
    parentDirectory: string;
    directoryName?: string;
  },
) {
  return apiPatch<{
    session: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      status: 'active' | 'archived';
      workspace: SessionWorkspace | null;
    };
    workspace: SessionWorkspace | null;
  }>(`/api/v1/sessions/${sessionId}/workspace`, body);
}

export async function chooseSessionWorkspaceParentDirectory(defaultPath?: string) {
  return apiPost<{
    path: string | null;
    cancelled: boolean;
    supported: boolean;
  }>('/api/v1/sessions/choose-parent-directory', {
    defaultPath,
  });
}

export async function openSessionWorkspaceDirectory(sessionId: string) {
  return apiPost<{
    path: string;
    supported: boolean;
  }>(`/api/v1/sessions/${sessionId}/workspace/open`, {});
}

export async function createNode(
  sessionId: string,
  body: {
    requestId?: string;
    type: string;
    content?: Record<string, unknown>;
    position: { x: number; y: number };
  },
) {
  return apiPost<{ node: GraphNode; eventId: number }>(`/api/v1/sessions/${sessionId}/nodes`, body);
}

export async function patchNode(
  sessionId: string,
  nodeId: string,
  patch: Record<string, unknown>,
) {
  return apiPatch<{ nodeId: string; patch: Record<string, unknown>; eventId: number }>(
    `/api/v1/sessions/${sessionId}/nodes/${nodeId}`,
    patch,
  );
}

export async function deleteNode(sessionId: string, nodeId: string) {
  return apiDelete<{ nodeId: string; eventId: number }>(
    `/api/v1/sessions/${sessionId}/nodes/${nodeId}`,
  );
}

export async function createEdge(
  sessionId: string,
  body: {
    requestId?: string;
    source: string;
    target: string;
    relation: string;
    direction?: string;
  },
) {
  return apiPost<{ edge: GraphEdge; eventId: number }>(
    `/api/v1/sessions/${sessionId}/edges`,
    body,
  );
}

export async function createBranch(
  sessionId: string,
  body: {
    requestId?: string;
    name: string;
    color: string;
    fromNodeId: string;
  },
) {
  return apiPost<{ branch: Branch; eventId: number }>(`/api/v1/sessions/${sessionId}/branches`, body);
}

export async function mergeBranch(
  sessionId: string,
  branchId: string,
  body: {
    requestId?: string;
    targetBranchId: string;
  },
) {
  return apiPost<{ sourceBranchId: string; targetBranchId: string; eventId: number }>(
    `/api/v1/sessions/${sessionId}/branches/${branchId}/merge`,
    body,
  );
}

export async function abandonBranch(
  sessionId: string,
  branchId: string,
  body: {
    requestId?: string;
  } = {},
) {
  return apiPost<{ branchId: string; eventId: number }>(
    `/api/v1/sessions/${sessionId}/branches/${branchId}/abandon`,
    body,
  );
}

export async function deleteEdge(sessionId: string, edgeId: string) {
  return apiDelete<{ edgeId: string; eventId: number }>(`/api/v1/sessions/${sessionId}/edges/${edgeId}`);
}

export async function getAgentCatalog(sessionId: string) {
  return apiGet<AgentCatalog>(`/api/v1/sessions/${sessionId}/agents/catalog`);
}

export async function spawnAgent(sessionId: string, body: AgentSpawnRequest) {
  return apiPost<{
    agentRunId: AgentRun['id'];
    rootNodeId: GraphNode['id'];
    status: AgentRun['status'];
  }>(`/api/v1/sessions/${sessionId}/agents/spawn`, body);
}

export async function runWorkflow(
  sessionId: string,
  body: WorkflowRunRequest,
  files?: Record<string, File | Blob | Array<File | Blob>>,
) {
  if (!files || Object.keys(files).length === 0) {
    return apiPost<WorkflowRunResult>(`/api/v1/sessions/${sessionId}/workflow/run`, body);
  }

  const form = new FormData();
  form.append('payload', JSON.stringify(body));
  for (const [field, entry] of Object.entries(files)) {
    const list = Array.isArray(entry) ? entry : [entry];
    list.forEach((file) => {
      form.append(field, file);
    });
  }
  return apiPostForm<WorkflowRunResult>(`/api/v1/sessions/${sessionId}/workflow/run`, form);
}

export async function startInputNode(
  sessionId: string,
  nodeId: string,
  body: InputNodeStartRequest,
  files?: Record<string, File | Blob | Array<File | Blob>>,
) {
  if (!files || Object.keys(files).length === 0) {
    return apiPost<InputNodeStartResult>(`/api/v1/sessions/${sessionId}/inputs/${nodeId}/start`, body);
  }

  const form = new FormData();
  form.append('payload', JSON.stringify(body));
  for (const [field, entry] of Object.entries(files)) {
    const list = Array.isArray(entry) ? entry : [entry];
    list.forEach((file) => {
      form.append(field, file);
    });
  }
  return apiPostForm<InputNodeStartResult>(`/api/v1/sessions/${sessionId}/inputs/${nodeId}/start`, form);
}

export async function runWorkflowController(
  sessionId: string,
  nodeId: string,
  body: WorkflowControllerRunRequest,
) {
  return apiPost<WorkflowControllerRunResult>(
    `/api/v1/sessions/${sessionId}/controllers/${nodeId}/run`,
    body,
  );
}

export async function runWorkflowFlow(
  sessionId: string,
  nodeId: string,
  body: WorkflowManagedFlowRunRequest,
) {
  return apiPost<WorkflowManagedFlowRunResult>(
    `/api/v1/sessions/${sessionId}/flows/${nodeId}/run`,
    body,
  );
}

export async function cancelWorkflowFlow(sessionId: string, flowId: string, body: { reason?: string } = {}) {
  return apiPost<WorkflowManagedFlowState>(
    `/api/v1/sessions/${sessionId}/flows/${flowId}/cancel`,
    body,
  );
}

export async function rerunAgent(
  sessionId: string,
  agentRunId: string,
  body: AgentRerunRequest = {},
) {
  return apiPost<{
    agentRunId: AgentRun['id'];
    rootNodeId: GraphNode['id'];
    status: AgentRun['status'];
  }>(`/api/v1/sessions/${sessionId}/agents/${agentRunId}/rerun`, body);
}

export async function uploadFileNodeFiles(sessionId: string, nodeId: string, files: File[]) {
  const form = new FormData();
  files.forEach((file) => {
    form.append('files', file);
  });
  return apiPostForm<{ nodeId: string; patch: Record<string, unknown>; eventId: number }>(
    `/api/v1/sessions/${sessionId}/nodes/${nodeId}/file/upload`,
    form,
  );
}

export async function uploadFileNodeFile(sessionId: string, nodeId: string, file: File) {
  return uploadFileNodeFiles(sessionId, nodeId, [file]);
}

export async function summarizeFileNode(
  sessionId: string,
  nodeId: string,
  body: {
    type?: AgentSpawnRequest['type'];
    model?: AgentSpawnRequest['model'];
  } = {},
) {
  return apiPost<{ nodeId: string; patch: Record<string, unknown>; eventId: number }>(
    `/api/v1/sessions/${sessionId}/nodes/${nodeId}/file/summarize`,
    body,
  );
}

export async function getAgentRunArtifacts(sessionId: string, agentRunId: string) {
  return apiGet<RunArtifactsBundle>(`/api/v1/sessions/${sessionId}/agents/${agentRunId}/artifacts`);
}

export async function getAgentRunArtifactFile(
  sessionId: string,
  agentRunId: string,
  filePath: string,
) {
  const params = new URLSearchParams({ path: filePath });
  return apiGet<{
    path: string;
    change: RunArtifactFileChange | null;
    current: RunArtifactFileSnapshot;
  }>(`/api/v1/sessions/${sessionId}/agents/${agentRunId}/artifacts/file?${params.toString()}`);
}

export async function getAgentRunPreviewStatus(sessionId: string, agentRunId: string) {
  return apiGet<WebPreviewInfo>(`/api/v1/sessions/${sessionId}/agents/${agentRunId}/preview/status`);
}

export type WorkspaceFileMeta = {
  path: string;
  size: number;
  mtimeMs: number;
  mime: string;
  isText: boolean;
};

export async function getWorkspaceFileMeta(sessionId: string, filePath: string) {
  const params = new URLSearchParams({ path: filePath });
  return apiGet<WorkspaceFileMeta>(
    `/api/v1/sessions/${sessionId}/workspace/file/meta?${params.toString()}`,
  );
}

export function getWorkspaceFileUrl(
  sessionId: string,
  filePath: string,
  opts?: { download?: boolean },
): string {
  const params = new URLSearchParams({ path: filePath });
  if (opts?.download) {
    params.set('download', '1');
  }
  return `${getApiBaseUrl()}/api/v1/sessions/${sessionId}/workspace/file?${params.toString()}`;
}

export async function ensureAgentRunPreview(sessionId: string, agentRunId: string) {
  return apiPost<WebPreviewInfo>(`/api/v1/sessions/${sessionId}/agents/${agentRunId}/preview/start`, {});
}

export async function runRuntimeTarget(sessionId: string, targetNodeId: string) {
  return apiPost<RuntimeRunSummary>(`/api/v1/sessions/${sessionId}/runtime/targets/${targetNodeId}/run`, {});
}

export async function stopRuntimeRun(sessionId: string, runNodeId: string) {
  return apiPost<RuntimeRunSummary>(`/api/v1/sessions/${sessionId}/runtime/runs/${runNodeId}/stop`, {});
}

export async function restartRuntimeRun(sessionId: string, runNodeId: string) {
  return apiPost<RuntimeRunSummary>(`/api/v1/sessions/${sessionId}/runtime/runs/${runNodeId}/restart`, {});
}

export async function listSnapshots(sessionId: string, opts?: { limit?: number; before?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const qs = params.toString();
  return apiGet<{
    items: Array<{
      id: string;
      createdAt: string;
      lastEventId: number;
    }>;
    nextCursor: string | null;
  }>(`/api/v1/sessions/${sessionId}/snapshots${qs ? `?${qs}` : ''}`);
}

export async function getSnapshot(sessionId: string, snapshotId: string) {
  return apiGet<GraphSnapshot>(`/api/v1/sessions/${sessionId}/snapshots/${snapshotId}`);
}
