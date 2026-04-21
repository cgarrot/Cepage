import type {
  WorkflowCopilotApplyResult,
  WorkflowCopilotEnsureThread,
  WorkflowCopilotRestoreResult,
  WorkflowCopilotSendMessage,
  WorkflowCopilotSendResult,
  WorkflowCopilotThreadBundle,
  WorkflowCopilotThreadPatch,
} from '@cepage/shared-core';
import { apiGet, apiPatch, apiPost } from './http';

export async function ensureWorkflowCopilotThread(
  sessionId: string,
  body: WorkflowCopilotEnsureThread,
) {
  return apiPost<WorkflowCopilotThreadBundle>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/thread`,
    body,
  );
}

export async function getWorkflowCopilotThread(sessionId: string, threadId: string) {
  return apiGet<WorkflowCopilotThreadBundle>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}`,
  );
}

export async function patchWorkflowCopilotThread(
  sessionId: string,
  threadId: string,
  body: WorkflowCopilotThreadPatch,
) {
  return apiPatch<WorkflowCopilotThreadBundle>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}`,
    body,
  );
}

export async function sendWorkflowCopilotMessage(
  sessionId: string,
  threadId: string,
  body: WorkflowCopilotSendMessage,
) {
  return apiPost<WorkflowCopilotSendResult>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}/messages`,
    body,
  );
}

export async function stopWorkflowCopilotThread(sessionId: string, threadId: string) {
  return apiPost<{ stopped: true }>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}/stop`,
    {},
  );
}

export async function applyWorkflowCopilotMessage(
  sessionId: string,
  threadId: string,
  messageId: string,
) {
  return apiPost<WorkflowCopilotApplyResult>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}/messages/${messageId}/apply`,
    {},
  );
}

export async function restoreWorkflowCopilotCheckpoint(
  sessionId: string,
  threadId: string,
  checkpointId: string,
) {
  return apiPost<WorkflowCopilotRestoreResult>(
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}/checkpoints/${checkpointId}/restore`,
    {},
  );
}
