import type {
  AgentModelRef,
  AgentType,
  WorkflowCopilotAttachment,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotMessage,
  WorkflowCopilotScope,
  WorkflowCopilotThread,
} from '@cepage/shared-core';

export type WorkflowCopilotSelection = {
  type: AgentType;
  model?: AgentModelRef;
};

export type PendingWorkflowCopilotSend = {
  userId: string;
  assistantId: string;
  messages: [WorkflowCopilotMessage, WorkflowCopilotMessage];
};

let tempSeq = 0;

function nextTempId(role: 'user' | 'assistant'): string {
  tempSeq += 1;
  return `workflow-copilot:${role}:${Date.now()}:${tempSeq}`;
}

function isTempMessage(message: Pick<WorkflowCopilotMessage, 'id'>): boolean {
  return message.id.startsWith('workflow-copilot:');
}

export function mergeWorkflowCopilotMessages(
  current: readonly WorkflowCopilotMessage[],
  next: readonly WorkflowCopilotMessage[],
): WorkflowCopilotMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of next) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function mergeWorkflowCopilotLiveMessage(
  current: readonly WorkflowCopilotMessage[],
  next: WorkflowCopilotMessage,
): WorkflowCopilotMessage[] {
  const base = isTempMessage(next)
    ? [...current]
    : current.filter(
        (message) =>
          !(
            isTempMessage(message)
            && message.threadId === next.threadId
            && message.role === next.role
          ),
      );
  return mergeWorkflowCopilotMessages(base, [next]);
}

export function readWorkflowCopilotPatch(bundle: {
  thread: WorkflowCopilotThread;
  messages: readonly WorkflowCopilotMessage[];
  checkpoints: readonly WorkflowCopilotCheckpoint[];
}) {
  return {
    workflowCopilotThread: bundle.thread,
    workflowCopilotMessages: [...bundle.messages],
    workflowCopilotCheckpoints: [...bundle.checkpoints],
    workflowCopilotLoading: false,
    workflowCopilotSending: false,
    workflowCopilotStopping: false,
    workflowCopilotApplyingMessageId: null,
    workflowCopilotRestoringCheckpointId: null,
  };
}

export function createPendingWorkflowCopilotSend(input: {
  threadId: string;
  content: string;
  attachments?: WorkflowCopilotAttachment[];
  scope?: WorkflowCopilotScope;
  selection?: WorkflowCopilotSelection | null;
  at?: Date;
}): PendingWorkflowCopilotSend {
  const userAt = input.at ?? new Date();
  const assistantAt = new Date(userAt.getTime() + 1);
  const shared = {
    scope: input.scope,
    agentType: input.selection?.type,
    model: input.selection?.model,
    summary: [],
    warnings: [],
    ops: [],
    executions: [],
    executionResults: [],
  } satisfies Pick<
    WorkflowCopilotMessage,
    | 'scope'
    | 'agentType'
    | 'model'
    | 'summary'
    | 'warnings'
    | 'ops'
    | 'executions'
    | 'executionResults'
  >;

  const user: WorkflowCopilotMessage = {
    id: nextTempId('user'),
    threadId: input.threadId,
    role: 'user',
    status: 'completed',
    content: input.content,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    createdAt: userAt.toISOString(),
    updatedAt: userAt.toISOString(),
    ...shared,
  };

  const assistant: WorkflowCopilotMessage = {
    id: nextTempId('assistant'),
    threadId: input.threadId,
    role: 'assistant',
    status: 'pending',
    content: '',
    createdAt: assistantAt.toISOString(),
    updatedAt: assistantAt.toISOString(),
    ...shared,
  };

  return {
    userId: user.id,
    assistantId: assistant.id,
    messages: [user, assistant],
  };
}

export function dropPendingWorkflowCopilotSend(
  current: readonly WorkflowCopilotMessage[],
  pending: PendingWorkflowCopilotSend,
): WorkflowCopilotMessage[] {
  return current.filter((message) => message.id !== pending.userId && message.id !== pending.assistantId);
}

export function settlePendingWorkflowCopilotSend(input: {
  current: readonly WorkflowCopilotMessage[];
  pending: PendingWorkflowCopilotSend;
  next: readonly WorkflowCopilotMessage[];
}): WorkflowCopilotMessage[] {
  return mergeWorkflowCopilotMessages(
    dropPendingWorkflowCopilotSend(input.current, input.pending),
    input.next,
  );
}
