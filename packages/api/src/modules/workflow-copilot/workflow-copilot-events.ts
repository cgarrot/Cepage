import type {
  WorkflowCopilotCheckpoint,
  WorkflowCopilotLiveMessagePayload,
  WorkflowCopilotThread,
} from '@cepage/shared-core';
import type { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { readMode, rowToMessage, rowToThread } from './workflow-copilot-rows';
import type { MessageRow, ThreadRow } from './workflow-copilot.types';

export function emitCopilotThread(
  collaboration: CollaborationBusService,
  sessionId: string,
  thread: WorkflowCopilotThread,
): void {
  collaboration.emitSession(sessionId, {
    type: 'workflow.copilot_thread_updated',
    eventId: 0,
    sessionId,
    actor: { type: 'agent', id: thread.id },
    timestamp: new Date().toISOString(),
    payload: thread,
  });
}

export function emitCopilotMessage(
  collaboration: CollaborationBusService,
  sessionId: string,
  payload: WorkflowCopilotLiveMessagePayload,
): void {
  collaboration.emitSession(sessionId, {
    type: 'workflow.copilot_message_updated',
    eventId: 0,
    sessionId,
    actor: { type: 'agent', id: payload.thread.id },
    timestamp: new Date().toISOString(),
    payload,
  });
}

export function emitThreadRow(
  collaboration: CollaborationBusService,
  sessionId: string,
  row: ThreadRow,
): void {
  emitCopilotThread(collaboration, sessionId, rowToThread(row));
}

export function emitMessageRow(
  collaboration: CollaborationBusService,
  sessionId: string,
  thread: ThreadRow,
  row: MessageRow,
  checkpoints?: WorkflowCopilotCheckpoint[],
): void {
  emitCopilotMessage(collaboration, sessionId, {
    thread: rowToThread(thread),
    message: rowToMessage(row, readMode(thread.mode)),
    ...(checkpoints ? { checkpoints } : {}),
  });
}
