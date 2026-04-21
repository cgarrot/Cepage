import { NotFoundException } from '@nestjs/common';
import {
  readNodeLockedSelection,
  type AgentModelRef,
  type AgentType,
  type WorkflowCopilotThreadBundle,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { GraphService } from '../graph/graph.service';
import { bundleToThread } from './workflow-copilot-rows';
import type {
  BundleRow,
  CheckpointRow,
  MessageRow,
  SessionRow,
  ThreadRow,
} from './workflow-copilot.types';

export async function readBundle(
  prisma: PrismaService,
  sessionId: string,
  threadId: string,
): Promise<WorkflowCopilotThreadBundle> {
  const row = await prisma.workflowCopilotThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      checkpoints: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!row || row.sessionId !== sessionId) {
    throw new NotFoundException('WORKFLOW_COPILOT_THREAD_NOT_FOUND');
  }
  return bundleToThread(row as BundleRow);
}

export async function readThreadRow(
  prisma: PrismaService,
  sessionId: string,
  threadId: string,
): Promise<ThreadRow> {
  const row = await prisma.workflowCopilotThread.findUnique({
    where: { id: threadId },
  });
  if (!row || row.sessionId !== sessionId) {
    throw new NotFoundException('WORKFLOW_COPILOT_THREAD_NOT_FOUND');
  }
  return row as ThreadRow;
}

export async function readMessageRow(
  prisma: PrismaService,
  threadId: string,
  messageId: string,
): Promise<MessageRow> {
  const row = await prisma.workflowCopilotMessage.findUnique({
    where: { id: messageId },
  });
  if (!row || row.threadId !== threadId) {
    throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
  }
  return row as MessageRow;
}

export async function readCheckpointRow(
  prisma: PrismaService,
  threadId: string,
  checkpointId: string,
): Promise<CheckpointRow> {
  const row = await prisma.workflowCopilotCheckpoint.findUnique({
    where: { id: checkpointId },
  });
  if (!row || row.threadId !== threadId) {
    throw new NotFoundException('WORKFLOW_COPILOT_CHECKPOINT_NOT_FOUND');
  }
  return row as CheckpointRow;
}

export async function assertSession(prisma: PrismaService, sessionId: string): Promise<void> {
  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!row) {
    throw new NotFoundException('SESSION_NOT_FOUND');
  }
}

export async function readSession(prisma: PrismaService, sessionId: string): Promise<SessionRow> {
  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      workspaceParentDirectory: true,
      workspaceDirectoryName: true,
    },
  });
  if (!row) {
    throw new NotFoundException('SESSION_NOT_FOUND');
  }
  return row as SessionRow;
}

export async function readLockedNodeSelection(
  graph: GraphService,
  sessionId: string,
  ownerNodeId?: string | null,
): Promise<{ type: AgentType; model?: AgentModelRef } | null> {
  if (!ownerNodeId) return null;
  const snapshot = await graph.loadSnapshot(sessionId);
  const node = snapshot.nodes.find((entry) => entry.id === ownerNodeId) ?? null;
  const selection = readNodeLockedSelection(node?.content);
  if (!selection) return null;
  return selection.model ? { type: selection.type, model: selection.model } : { type: selection.type };
}
