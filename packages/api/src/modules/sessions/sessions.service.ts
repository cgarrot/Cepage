import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  type ApprovalRequest,
  type AgentRun,
  type AgentRuntime,
  type ExecutionLease,
  type GraphSnapshot,
  type AgentModelRef,
  type WorkflowControllerState,
  type WorkflowManagedFlowState,
  type WorkflowExecution,
  ok,
  readWorkflowControllerState,
  readWorkflowManagedFlowState,
  rekeyWorkflowTransfer,
  workflowFromSnapshot,
  type SessionWorkspace,
} from '@cepage/shared-core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import {
  buildAutoWorkspaceDirectoryName,
  buildSessionWorkspace,
  readSessionWorkspace,
  resolveDefaultWorkspaceParent,
} from '../../common/utils/session-workspace.util';
import {
  buildOpenDirectoryCommand,
  chooseParentDirectory,
  openDirectory,
} from './session-directory-picker';
import { ACTIVITY_LIMIT, buildTimelinePage } from './timeline.util';
import { GraphService } from '../graph/graph.service';
import { ApprovalService } from '../execution/approval.service';
import { LeaseService } from '../execution/lease.service';

const LIST_LIMIT_MAX = 100;
const LIST_LIMIT_DEFAULT = 50;
const SNAPSHOT_LIMIT_MAX = 100;
const SNAPSHOT_LIMIT_DEFAULT = 25;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    @Optional()
    private readonly approvals?: ApprovalService,
    @Optional()
    private readonly leases?: LeaseService,
  ) {}

  private async readWorkflowFlows(sessionId: string) {
    try {
      return await this.prisma.workflowManagedFlow.findMany({
        where: { sessionId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      });
    } catch (err) {
      if (isMissingWorkflowManagedFlowTable(err)) {
        return [];
      }
      throw err;
    }
  }

  private serializeWorkspace(session: {
    id: string;
    workspaceParentDirectory: string | null;
    workspaceDirectoryName: string | null;
  }): SessionWorkspace | null {
    return readSessionWorkspace(process.cwd(), session);
  }

  private serializeSession(session: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceParentDirectory: string | null;
    workspaceDirectoryName: string | null;
  }) {
    return {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      status: session.status as 'active' | 'archived',
      workspace: this.serializeWorkspace(session),
    };
  }

  private serializeModel(providerID: string | null, modelID: string | null): AgentModelRef | undefined {
    if (!providerID || !modelID) {
      return undefined;
    }
    return { providerID, modelID };
  }

  private serializeLease(row: {
    id: string;
    sessionId: string | null;
    resourceKind: string;
    resourceKey: string;
    scopeKey: string | null;
    holderKind: string;
    holderId: string;
    workerId: string | null;
    runId: string | null;
    executionId: string | null;
    requestId: string | null;
    status: string;
    leaseToken: string | null;
    metadata: unknown;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    releasedAt: Date | null;
  }): ExecutionLease {
    return {
      id: row.id,
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      resourceKind: row.resourceKind,
      resourceKey: row.resourceKey,
      ...(row.scopeKey ? { scopeKey: row.scopeKey } : {}),
      holderKind: row.holderKind,
      holderId: row.holderId,
      ...(row.workerId ? { workerId: row.workerId } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      ...(row.executionId ? { executionId: row.executionId } : {}),
      ...(row.requestId ? { requestId: row.requestId } : {}),
      status: row.status as ExecutionLease['status'],
      ...(row.leaseToken ? { leaseToken: row.leaseToken } : {}),
      ...(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? { metadata: row.metadata as Record<string, unknown> }
        : {}),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.releasedAt ? { releasedAt: row.releasedAt.toISOString() } : {}),
    };
  }

  private serializeApproval(row: {
    id: string;
    sessionId: string | null;
    runId: string | null;
    executionId: string | null;
    requestId: string | null;
    kind: string;
    status: string;
    title: string;
    detail: string | null;
    risk: string;
    payload: unknown;
    resolution: unknown;
    requestedByType: string;
    requestedById: string;
    resolvedByType: string | null;
    resolvedById: string | null;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt: Date | null;
  }): ApprovalRequest {
    return {
      id: row.id,
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      ...(row.executionId ? { executionId: row.executionId } : {}),
      ...(row.requestId ? { requestId: row.requestId } : {}),
      kind: row.kind,
      status: row.status as ApprovalRequest['status'],
      title: row.title,
      ...(row.detail ? { detail: row.detail } : {}),
      risk: row.risk as ApprovalRequest['risk'],
      payload:
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {},
      ...(row.resolution && typeof row.resolution === 'object' && !Array.isArray(row.resolution)
        ? { resolution: row.resolution as Record<string, unknown> }
        : {}),
      requestedByType: row.requestedByType,
      requestedById: row.requestedById,
      ...(row.resolvedByType ? { resolvedByType: row.resolvedByType } : {}),
      ...(row.resolvedById ? { resolvedById: row.resolvedById } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    };
  }

  private serializeAgentRun(row: {
    id: string;
    sessionId: string;
    executionId: string | null;
    requestId: string | null;
    agentType: string;
    role: string;
    status: string;
    wakeReason: string;
    runtime: unknown;
    startedAt: Date;
    endedAt: Date | null;
    updatedAt: Date;
    seedNodeIds: unknown;
    rootNodeId: string | null;
    triggerNodeId: string | null;
    stepNodeId: string | null;
    retryOfRunId: string | null;
    parentAgentId: string | null;
    parentRunId: string | null;
    lastSeenEventId: number | null;
    modelProviderId: string | null;
    modelId: string | null;
    externalSessionId: string | null;
    providerMetadata: unknown;
    outputText: string | null;
    isStreaming: boolean;
  }): AgentRun {
    return {
      id: row.id,
      sessionId: row.sessionId,
      ...(row.executionId ? { executionId: row.executionId } : {}),
      ...(row.requestId ? { requestId: row.requestId } : {}),
      type: row.agentType as AgentRun['type'],
      role: row.role,
      runtime: row.runtime as AgentRuntime,
      wakeReason: row.wakeReason as AgentRun['wakeReason'],
      status: row.status as AgentRun['status'],
      startedAt: row.startedAt.toISOString(),
      ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      updatedAt: row.updatedAt.toISOString(),
      seedNodeIds: Array.isArray(row.seedNodeIds) ? row.seedNodeIds.filter((item): item is string => typeof item === 'string') : [],
      ...(row.rootNodeId ? { rootNodeId: row.rootNodeId } : {}),
      ...(row.triggerNodeId ? { triggerNodeId: row.triggerNodeId } : {}),
      ...(row.stepNodeId ? { stepNodeId: row.stepNodeId } : {}),
      ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
      ...(row.parentAgentId ? { parentAgentId: row.parentAgentId } : {}),
      ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
      ...(this.serializeModel(row.modelProviderId, row.modelId) ? { model: this.serializeModel(row.modelProviderId, row.modelId) } : {}),
      ...(row.externalSessionId ? { externalSessionId: row.externalSessionId } : {}),
      ...(row.providerMetadata && typeof row.providerMetadata === 'object' && !Array.isArray(row.providerMetadata)
        ? { providerMetadata: row.providerMetadata as Record<string, unknown> }
        : {}),
      ...(row.lastSeenEventId != null ? { lastSeenEventId: row.lastSeenEventId } : {}),
      ...(row.outputText ? { outputText: row.outputText } : {}),
      isStreaming: row.isStreaming,
    };
  }

  private serializeWorkflowExecution(row: {
    id: string;
    sessionId: string;
    parentExecutionId: string | null;
    triggerNodeId: string | null;
    stepNodeId: string | null;
    currentRunId: string | null;
    latestRunId: string | null;
    agentType: string;
    role: string;
    status: string;
    wakeReason: string;
    runtime: unknown;
    seedNodeIds: unknown;
    modelProviderId: string | null;
    modelId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkflowExecution {
    return {
      id: row.id,
      sessionId: row.sessionId,
      ...(row.parentExecutionId ? { parentExecutionId: row.parentExecutionId } : {}),
      ...(row.triggerNodeId ? { triggerNodeId: row.triggerNodeId } : {}),
      ...(row.stepNodeId ? { stepNodeId: row.stepNodeId } : {}),
      ...(row.currentRunId ? { currentRunId: row.currentRunId } : {}),
      ...(row.latestRunId ? { latestRunId: row.latestRunId } : {}),
      type: row.agentType as WorkflowExecution['type'],
      role: row.role,
      runtime: row.runtime as AgentRuntime,
      wakeReason: row.wakeReason as WorkflowExecution['wakeReason'],
      status: row.status as WorkflowExecution['status'],
      startedAt: row.startedAt.toISOString(),
      ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      seedNodeIds: Array.isArray(row.seedNodeIds) ? row.seedNodeIds.filter((item): item is string => typeof item === 'string') : [],
      ...(this.serializeModel(row.modelProviderId, row.modelId) ? { model: this.serializeModel(row.modelProviderId, row.modelId) } : {}),
    };
  }

  private serializeWorkflowControllerState(row: {
    id: string;
    sessionId: string;
    controllerNodeId: string;
    parentExecutionId: string | null;
    executionId: string | null;
    currentChildExecutionId: string | null;
    mode: string;
    sourceKind: string;
    status: string;
    state: unknown;
    startedAt: Date;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkflowControllerState {
    const base = {
      ...(row.state && typeof row.state === 'object' && !Array.isArray(row.state)
        ? (row.state as Record<string, unknown>)
        : {}),
      id: row.id,
      sessionId: row.sessionId,
      controllerNodeId: row.controllerNodeId,
      ...(row.parentExecutionId ? { parentExecutionId: row.parentExecutionId } : {}),
      ...(row.executionId ? { executionId: row.executionId } : {}),
      ...(row.currentChildExecutionId ? { currentChildExecutionId: row.currentChildExecutionId } : {}),
      mode: row.mode,
      sourceKind: row.sourceKind,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    const parsed = readWorkflowControllerState(base);
    if (!parsed) {
      throw new Error(`INVALID_WORKFLOW_CONTROLLER_STATE:${row.id}`);
    }
    return parsed;
  }

  private serializeWorkflowManagedFlowState(row: {
    id: string;
    sessionId: string;
    entryNodeId: string;
    status: string;
    syncMode: string;
    revision: number;
    currentPhaseId: string | null;
    currentPhaseIndex: number | null;
    cancelRequested: boolean;
    wait: unknown;
    state: unknown;
    startedAt: Date;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkflowManagedFlowState {
    const parsed = readWorkflowManagedFlowState({
      ...(row.state && typeof row.state === 'object' && !Array.isArray(row.state)
        ? (row.state as Record<string, unknown>)
        : {}),
      id: row.id,
      sessionId: row.sessionId,
      entryNodeId: row.entryNodeId,
      status: row.status,
      syncMode: row.syncMode,
      revision: row.revision,
      ...(row.currentPhaseId ? { currentPhaseId: row.currentPhaseId } : {}),
      ...(row.currentPhaseIndex != null ? { currentPhaseIndex: row.currentPhaseIndex } : {}),
      cancelRequested: row.cancelRequested,
      ...(row.wait && typeof row.wait === 'object' ? { wait: row.wait } : {}),
      startedAt: row.startedAt.toISOString(),
      ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    if (!parsed) {
      throw new Error(`INVALID_WORKFLOW_MANAGED_FLOW_STATE:${row.id}`);
    }
    return parsed;
  }

  protected async openDir(dir: string): Promise<void> {
    await openDirectory(dir);
  }

  async create(name: string) {
    // Stamp a default workspace on every new session so agent_run jobs
    // dispatched to the host-side daemon receive a host-valid runtime.cwd
    // instead of falling back to resolveWorkingDirectory()'s process.cwd()
    // (= /repo/apps/api when the API runs in Docker → ENOENT on host mkdir).
    const sessionId = randomUUID();
    const workspaceParentDirectory = resolveDefaultWorkspaceParent();
    const workspaceDirectoryName = buildAutoWorkspaceDirectoryName(sessionId);
    const session = await this.prisma.session.create({
      data: {
        id: sessionId,
        name,
        status: 'active',
        workspaceParentDirectory,
        workspaceDirectoryName,
      },
    });
    return ok(this.serializeSession(session));
  }

  async list(
    query: string | undefined,
    status: 'active' | 'archived' | undefined,
    limitRaw: number | undefined,
    offsetRaw: number | undefined,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw) || LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
    const offset = Math.max(Number(offsetRaw) || 0, 0);
    const where: Prisma.SessionWhereInput = {};
    if (status) where.status = status;
    const term = query?.trim();
    if (term) {
      where.name = { contains: term, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          lastEventId: true,
          workspaceParentDirectory: true,
          workspaceDirectoryName: true,
          _count: { select: { nodes: true, edges: true, agentRuns: true } },
        },
      }),
      this.prisma.session.count({ where }),
    ]);

    return ok({
      items: rows.map((row) => ({
        ...this.serializeSession(row),
        lastEventId: row.lastEventId,
        counts: {
          nodes: row._count.nodes,
          edges: row._count.edges,
          agentRuns: row._count.agentRuns,
        },
      })),
      total,
      limit,
      offset,
    });
  }

  async duplicateSession(sourceId: string, name?: string) {
    const source = await this.prisma.session.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('SESSION_NOT_FOUND');

    const base = name?.trim();
    const nextName =
      base && base.length > 0 ? base : `${source.name} (copy)`;

    const copy = await this.prisma.session.create({
      data: { name: nextName, status: 'active' },
    });

    const snap = await this.graph.loadSnapshot(sourceId);
    const flow = rekeyWorkflowTransfer(workflowFromSnapshot(snap));
    await this.graph.replaceWorkflow(copy.id, flow);

    const fresh = await this.prisma.session.findUnique({ where: { id: copy.id } });
    if (!fresh) throw new NotFoundException('SESSION_NOT_FOUND');

    return ok(this.serializeSession(fresh));
  }

  async setStatus(sessionId: string, status: 'active' | 'archived') {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: { status },
    });
    return ok(this.serializeSession(updated));
  }

  async removeArchived(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (session.status !== 'archived') {
      throw new BadRequestException('SESSION_MUST_BE_ARCHIVED');
    }
    await this.prisma.session.delete({ where: { id: sessionId } });
    return ok({ deleted: true as const });
  }

  async getMeta(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    return ok(this.serializeSession(session));
  }

  async chooseParentDirectory(defaultPath?: string) {
    return ok(await chooseParentDirectory(defaultPath));
  }

  async openWorkspaceDirectory(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const workspace = this.serializeWorkspace(session);
    if (!workspace) {
      throw new BadRequestException('SESSION_WORKSPACE_NOT_CONFIGURED');
    }

    if (!buildOpenDirectoryCommand(workspace.workingDirectory)) {
      return ok({
        path: workspace.workingDirectory,
        supported: false,
      });
    }

    await fs.mkdir(workspace.workingDirectory, { recursive: true });
    await this.openDir(workspace.workingDirectory);

    return ok({
      path: workspace.workingDirectory,
      supported: true,
    });
  }

  async updateWorkspace(sessionId: string, parentDirectory: string, directoryName?: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (!parentDirectory.trim()) {
      throw new BadRequestException('SESSION_WORKSPACE_PARENT_REQUIRED');
    }

    const workspace = buildSessionWorkspace(
      process.cwd(),
      session.id,
      parentDirectory,
      directoryName,
    );

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        workspaceParentDirectory: workspace.parentDirectory,
        workspaceDirectoryName: workspace.directoryName,
      },
    });

    return ok({
      session: this.serializeSession(updated),
      workspace: this.serializeWorkspace(updated),
    });
  }

  async getGraphBundle(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    const pendingApprovals = this.approvals ? this.approvals.listPending(sessionId) : Promise.resolve([]);
    const activeLeases = this.leases ? this.leases.listActive(sessionId) : Promise.resolve([]);
    const [
      snap,
      activityRows,
      agentRuns,
      workflowExecutions,
      workflowControllers,
      workflowFlows,
      approvals,
      leases,
    ] = await Promise.all([
      this.graph.loadSnapshot(sessionId),
      this.prisma.activityEntry.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: ACTIVITY_LIMIT + 1,
      }),
      this.prisma.agentRun.findMany({
        where: { sessionId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.workflowExecution.findMany({
        where: { sessionId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.workflowControllerState.findMany({
        where: { sessionId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.readWorkflowFlows(sessionId),
      pendingApprovals,
      activeLeases,
    ]);
    const activity = buildTimelinePage(activityRows, ACTIVITY_LIMIT);
    return ok({
      session: this.serializeSession(session),
      nodes: snap.nodes,
      edges: snap.edges,
      branches: snap.branches,
      agentRuns: agentRuns.map((row) => this.serializeAgentRun(row)),
      workflowExecutions: workflowExecutions.map((row) => this.serializeWorkflowExecution(row)),
      workflowControllers: workflowControllers.map((row) => this.serializeWorkflowControllerState(row)),
      workflowFlows: workflowFlows.map((row) => this.serializeWorkflowManagedFlowState(row)),
      activeLeases: leases.map((row) => this.serializeLease(row)),
      pendingApprovals: approvals.map((row) => this.serializeApproval(row)),
      viewport: snap.viewport,
      lastEventId: snap.lastEventId ?? 0,
      activity: activity.items,
      activityNextCursor: activity.nextCursor,
      activityHasMore: activity.nextCursor !== null,
    });
  }

  async listSnapshots(sessionId: string, limitRaw?: number, before?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const cursor = readSnapshotCursor(before);
    if (before && !cursor) {
      throw new BadRequestException('INVALID_SNAPSHOT_CURSOR');
    }
    const limit = Math.min(Math.max(Number(limitRaw) || SNAPSHOT_LIMIT_DEFAULT, 1), SNAPSHOT_LIMIT_MAX);
    const rows = await this.prisma.graphSnapshot.findMany({
      where: {
        sessionId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.ts } },
                { createdAt: cursor.ts, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        createdAt: true,
        lastEventId: true,
      },
    });
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      lastEventId: row.lastEventId,
    }));
    return ok({
      items,
      nextCursor: rows.length > limit && items.length > 0 ? makeSnapshotCursor(rows[limit - 1]) : null,
    });
  }

  async getSnapshot(sessionId: string, snapshotId: string) {
    const row = await this.prisma.graphSnapshot.findFirst({
      where: { id: snapshotId, sessionId },
      select: { data: true },
    });
    if (!row) {
      throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    }
    return ok(row.data as unknown as GraphSnapshot);
  }

  async exportWorkflow(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    const snap = await this.graph.loadSnapshot(sessionId);
    return ok(workflowFromSnapshot(snap));
  }
}

function isMissingWorkflowManagedFlowTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const rec = err as { code?: unknown; message?: unknown };
  if (rec.code === 'P2021') {
    return true;
  }
  return (
    typeof rec.message === 'string'
    && rec.message.includes('WorkflowManagedFlow')
    && rec.message.includes('does not exist')
  );
}

function readSnapshotCursor(raw?: string): { ts: Date; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf('|');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const ts = new Date(raw.slice(0, idx));
  if (Number.isNaN(ts.getTime())) return null;
  const id = raw.slice(idx + 1);
  if (!id) return null;
  return { ts, id };
}

function makeSnapshotCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}
