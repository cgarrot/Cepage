import type {
  AgentType,
  Creator,
  WorkflowCopilotMode,
  WorkflowCopilotScope,
  WorkflowCopilotThread,
  WorkflowCopilotTurn,
} from '@cepage/shared-core';

export type ThreadRow = {
  id: string;
  sessionId: string;
  surface: string;
  ownerKey: string;
  ownerNodeId: string | null;
  title: string | null;
  agentType: string;
  modelProviderId: string | null;
  modelId: string | null;
  scope: unknown;
  mode: string;
  autoApply: boolean;
  autoRun: boolean;
  externalSessionId: string | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  threadId: string;
  role: string;
  status: string;
  content: string;
  analysis: string | null;
  summary: unknown;
  warnings: unknown;
  ops: unknown;
  apply: unknown;
  error: string | null;
  scope: unknown;
  agentType: string | null;
  modelProviderId: string | null;
  modelId: string | null;
  rawOutput: string | null;
  // Live-streamed reasoning / chain-of-thought captured while the agent runs.
  // Persisted alongside `rawOutput` so the Copilot panel can replay the
  // "Thinking…" trail when revisiting a finished message.
  thinkingOutput: string | null;
  executions?: unknown | null;
  executionResults?: unknown | null;
  attachments?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CheckpointRow = {
  id: string;
  sessionId: string;
  threadId: string;
  messageId: string;
  summary: unknown;
  flow: unknown;
  restoredAt: Date | null;
  createdAt: Date;
};

export type BundleRow = ThreadRow & {
  messages: MessageRow[];
  checkpoints: CheckpointRow[];
};

export type SessionRow = {
  id: string;
  workspaceParentDirectory: string | null;
  workspaceDirectoryName: string | null;
};

export type RunTurnResult =
  | {
      ok: true;
      rawOutput: string;
      turn: WorkflowCopilotTurn;
      externalSessionId?: string;
    }
  | {
      ok: false;
      rawOutput: string;
      error: string;
      externalSessionId?: string;
    };

export type RunThreadProgress = {
  rawOutput: string;
  snapshotOutput: string;
  // Live reasoning stream accumulated from `thinking` daemon messages. Empty
  // string when the active agent does not surface a reasoning channel.
  thinkingOutput: string;
  externalSessionId?: string;
};

export type StructuralEdge = {
  source: string;
  target: string;
  relation: 'contains' | 'feeds_into' | 'produces' | 'references' | 'validates';
};

export const DEFAULT_SCOPE: WorkflowCopilotScope = { kind: 'session' };
export const DEFAULT_MODE: WorkflowCopilotMode = 'edit';
export const DEFAULT_AGENT_TYPE: AgentType = 'opencode';
export const DEFAULT_AUTO_APPLY = true;
export const DEFAULT_AUTO_RUN = true;
export const HUMAN_ACTOR: Creator = { type: 'human', userId: 'local-user' };
export const WORKFLOW_COPILOT_APPLY_DISABLED_IN_ASK_MODE = 'WORKFLOW_COPILOT_APPLY_DISABLED_IN_ASK_MODE';

export type ThreadSurface = WorkflowCopilotThread['surface'];
