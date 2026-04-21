import type {
  WorkflowCopilotCheckpoint,
  WorkflowCopilotLiveMessagePayload,
  WorkflowCopilotMessage,
  WorkflowCopilotThread,
} from '@cepage/shared-core';
import {
  mergeWorkflowCopilotLiveMessage,
  readWorkflowCopilotPatch,
} from './workflow-copilot-state';
import {
  sameWorkflowCopilotThread,
  selectionFromThread,
} from './workspace-agent-selection';
import type { WorkspaceState } from './workspace-store-types';

export type WorkflowCopilotBundle = {
  thread: WorkflowCopilotThread;
  messages: WorkflowCopilotMessage[];
  checkpoints: WorkflowCopilotCheckpoint[];
};

type WorkspaceCopilotState = Pick<
  WorkspaceState,
  | 'lastRunSelection'
  | 'workflowCopilotApplyingMessageId'
  | 'workflowCopilotCheckpoints'
  | 'workflowCopilotLoading'
  | 'workflowCopilotMessages'
  | 'workflowCopilotSending'
  | 'workflowCopilotStopping'
  | 'workflowCopilotThread'
>;

export function syncWorkflowCopilot(bundle: WorkflowCopilotBundle): Partial<WorkspaceState> {
  const selection = selectionFromThread(bundle.thread);
  const patch = readWorkflowCopilotPatch(bundle);
  return {
    ...patch,
    ...(selection ? { lastRunSelection: selection } : {}),
  };
}

export function mergeCopilotThread(
  current: WorkflowCopilotThread | null,
  thread: WorkflowCopilotThread,
): Partial<WorkspaceState> | null {
  if (!sameWorkflowCopilotThread(current, thread)) {
    return null;
  }
  const selection = selectionFromThread(thread);
  return {
    workflowCopilotThread: thread,
    workflowCopilotLoading: false,
    ...(selection ? { lastRunSelection: selection } : {}),
  };
}

export function mergeCopilotMessage(
  state: WorkspaceCopilotState,
  payload: WorkflowCopilotLiveMessagePayload,
): Partial<WorkspaceState> | null {
  if (!sameWorkflowCopilotThread(state.workflowCopilotThread, payload.thread)) {
    return null;
  }
  const done = payload.message.role === 'assistant' && payload.message.status !== 'pending';
  const selection = selectionFromThread(payload.thread);
  return {
    workflowCopilotThread: payload.thread,
    workflowCopilotMessages: mergeWorkflowCopilotLiveMessage(
      state.workflowCopilotMessages,
      payload.message,
    ),
    workflowCopilotCheckpoints: payload.checkpoints
      ? [...payload.checkpoints]
      : state.workflowCopilotCheckpoints,
    workflowCopilotLoading: false,
    workflowCopilotSending: done ? false : state.workflowCopilotSending,
    workflowCopilotStopping: done ? false : state.workflowCopilotStopping,
    workflowCopilotApplyingMessageId:
      done && state.workflowCopilotApplyingMessageId === payload.message.id
        ? null
        : state.workflowCopilotApplyingMessageId,
    ...(selection ? { lastRunSelection: selection } : {}),
  };
}

export function mergeResyncedCopilot(
  state: WorkspaceCopilotState,
  bundle: WorkflowCopilotBundle,
): Partial<WorkspaceState> | null {
  if (!sameWorkflowCopilotThread(state.workflowCopilotThread, bundle.thread)) {
    return null;
  }
  const selection = selectionFromThread(bundle.thread);
  const pending = bundle.messages.some(
    (message) => message.role === 'assistant' && message.status === 'pending',
  );
  return {
    workflowCopilotThread: bundle.thread,
    workflowCopilotMessages: [...bundle.messages],
    workflowCopilotCheckpoints: [...bundle.checkpoints],
    workflowCopilotLoading: false,
    workflowCopilotSending: state.workflowCopilotSending && pending,
    workflowCopilotStopping: state.workflowCopilotStopping && pending,
    ...(selection ? { lastRunSelection: selection } : {}),
  };
}

export function clearWorkflowCopilot(): Partial<WorkspaceState> {
  return {
    workflowCopilotThread: null,
    workflowCopilotMessages: [],
    workflowCopilotCheckpoints: [],
    workflowCopilotLoading: false,
    workflowCopilotSending: false,
    workflowCopilotStopping: false,
    workflowCopilotApplyingMessageId: null,
    workflowCopilotRestoringCheckpointId: null,
  };
}
