import type {
  AgentModelRef,
  AgentRuntimeEvent,
  AgentSpawnRequest,
  AgentType,
  GraphNode,
  GraphSnapshot,
  WorkflowInputBound,
  WorkflowInputPart,
  WorkflowInputTemplate,
} from '@cepage/shared-core';
import type { AgentRun, WakeReason } from '@cepage/shared-core';

export type SpawnResponse = {
  success: true;
  data: {
    agentRunId: string;
    rootNodeId: string;
    status: AgentRun['status'];
    wakeReason: WakeReason;
  };
};

export type AgentAdapterRuntimeEvent =
  | AgentRuntimeEvent
  | { type: 'session'; externalSessionId: string }
  | { type: 'snapshot'; output: string };

export type RunRow = {
  id: string;
  sessionId: string;
  executionId: string | null;
  requestId: string | null;
  agentType: string;
  role: string;
  status: string;
  wakeReason: string;
  runtime: unknown;
  seedNodeIds: unknown;
  rootNodeId: string | null;
  triggerNodeId: string | null;
  stepNodeId: string | null;
  parentRunId: string | null;
  modelProviderId: string | null;
  modelId: string | null;
  externalSessionId: string | null;
};

export type RunState = {
  run: RunRow;
  snapshot: GraphSnapshot;
  rootNode: GraphNode;
  outputNode: GraphNode | null;
  seedNodeIds: string[];
  triggerNode: GraphNode | null;
  cwd: string;
  errorPosition: GraphNode['position'];
};

export type ManagedPhasePromptContract = {
  phaseKind: 'agent_phase' | 'runtime_verify_phase';
  expectedOutputs: string[];
  validatorNodeId?: string;
};

export type AgentSpawnInput = AgentSpawnRequest & {
  managedContract?: ManagedPhasePromptContract;
};

export type WorkflowRunFile = {
  fieldname?: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type WorkflowInputTemplateRow = {
  node: GraphNode;
  content: WorkflowInputTemplate;
  key: string;
};

export type WorkflowInputAsset = {
  part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>;
  buffer: Buffer;
};

export type WorkflowBoundInput = {
  nodeId: string;
  parts: WorkflowInputPart[];
  workspaceFileNodeIds: string[];
};

export type WorkflowBoundSelection = {
  node: GraphNode;
  content: WorkflowInputBound;
};

export type WorkflowInputSourceKind = 'text' | 'file' | 'image';

export type WorkflowInputSourceCandidate = {
  node: GraphNode;
  kind: WorkflowInputSourceKind;
};

export type AgentSelection = {
  type: AgentType;
  model?: AgentModelRef;
};
