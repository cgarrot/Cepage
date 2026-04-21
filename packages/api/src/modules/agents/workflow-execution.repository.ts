import { randomUUID } from 'node:crypto';
import type { AgentModelRef, AgentRuntime, AgentType } from '@cepage/shared-core';
import type { WakeReason } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { ACTIVE_RUN_STATUSES } from './workflow-inputs.util';

export async function findLatestExecution(
  prisma: PrismaService,
  sessionId: string,
  triggerNodeId?: string | null,
  stepNodeId?: string | null,
  parentExecutionId?: string | null,
) {
  return prisma.workflowExecution.findFirst({
    where: {
      sessionId,
      triggerNodeId: triggerNodeId ?? null,
      stepNodeId: stepNodeId ?? null,
      parentExecutionId: parentExecutionId ?? null,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function findActiveExecution(
  prisma: PrismaService,
  sessionId: string,
  triggerNodeId?: string | null,
  stepNodeId?: string | null,
  parentExecutionId?: string | null,
) {
  return prisma.workflowExecution.findFirst({
    where: {
      sessionId,
      triggerNodeId: triggerNodeId ?? null,
      stepNodeId: stepNodeId ?? null,
      parentExecutionId: parentExecutionId ?? null,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createWorkflowExecution(
  prisma: PrismaService,
  input: {
    sessionId: string;
    executionId?: string;
    parentExecutionId?: string;
    triggerNodeId?: string | null;
    stepNodeId?: string | null;
    requestId?: string;
    type: AgentType;
    role: string;
    wakeReason: WakeReason;
    runtime: AgentRuntime;
    seedNodeIds: string[];
    startedAt: Date;
    model?: AgentModelRef;
  },
) {
  return prisma.workflowExecution.create({
    data: {
      id: input.executionId ?? randomUUID(),
      sessionId: input.sessionId,
      parentExecutionId: input.parentExecutionId ?? null,
      triggerNodeId: input.triggerNodeId ?? null,
      stepNodeId: input.stepNodeId ?? null,
      requestId: input.requestId ?? null,
      agentType: input.type,
      role: input.role,
      status: 'booting',
      wakeReason: input.wakeReason,
      runtime: input.runtime as object,
      seedNodeIds: input.seedNodeIds,
      startedAt: input.startedAt,
      modelProviderId: input.model?.providerID ?? null,
      modelId: input.model?.modelID ?? null,
    },
  });
}
