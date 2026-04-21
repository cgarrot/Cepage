import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getEnv } from '@cepage/config';
import type {
  AgentModelRef,
  AgentRun,
  AgentRuntime,
  TimelineEntry,
  WorkflowControllerState,
  WorkflowManagedFlowState,
  WsServerEvent,
} from '@cepage/shared-core';
import { readWorkflowControllerState, readWorkflowManagedFlowState } from '@cepage/shared-core';
import { randomUUID } from 'node:crypto';
import { Client as PgClient, type Notification } from 'pg';
import { z } from 'zod';
import { PrismaService } from '../../common/database/prisma.service';
import { graphEnvelopeToWs, graphEventRowToEnvelope } from './collaboration-event.util';

const CHANNEL = 'cepage_collaboration_events';

const relaySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('graph_event'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('activity'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
    activityId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('flow'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
    flowId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('controller'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
    controllerId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('agent_run'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
    runId: z.string().min(1),
    eventType: z.enum(['agent.spawned', 'agent.status', 'agent.output_chunk']),
  }),
  z.object({
    kind: z.literal('resync'),
    instanceId: z.string().min(1),
    sessionId: z.string().min(1),
    eventId: z.number().int().nonnegative(),
    reason: z.string().min(1),
  }),
]);

type RelayNotice = z.infer<typeof relaySchema>;

export type CollaborationRelayEvent = {
  instanceId: string;
  event: WsServerEvent;
};

type Listener = (msg: CollaborationRelayEvent) => void;

@Injectable()
export class CollaborationRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CollaborationRelayService.name);
  private readonly instanceId = process.env.COLLABORATION_INSTANCE_ID?.trim() || `${process.pid}-${randomUUID()}`;
  private readonly listeners = new Set<Listener>();
  private send: PgClient | null = null;
  private recv: PgClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  id(): string {
    return this.instanceId;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async onModuleInit(): Promise<void> {
    const url = getEnv().DATABASE_URL;
    const send = new PgClient({ connectionString: url });
    const recv = new PgClient({ connectionString: url });

    send.on('error', (err: Error) => {
      this.log.error(`relay send client error: ${err.message}`, err.stack);
    });
    recv.on('error', (err: Error) => {
      this.log.error(`relay recv client error: ${err.message}`, err.stack);
    });
    recv.on('notification', (msg: Notification) => {
      void this.handleNotification(msg);
    });

    await send.connect();
    await recv.connect();
    await recv.query(`LISTEN ${CHANNEL}`);

    this.send = send;
    this.recv = recv;
  }

  async onModuleDestroy(): Promise<void> {
    const send = this.send;
    const recv = this.recv;
    this.send = null;
    this.recv = null;

    if (recv) {
      try {
        await recv.query(`UNLISTEN ${CHANNEL}`);
      } catch (err) {
        this.log.warn(`relay unlisten failed: ${message(err)}`);
      }
      await recv.end().catch((err: unknown) => {
        this.log.warn(`relay recv client close failed: ${message(err)}`);
      });
    }

    if (send) {
      await send.end().catch((err: unknown) => {
        this.log.warn(`relay send client close failed: ${message(err)}`);
      });
    }
  }

  async publish(event: WsServerEvent): Promise<void> {
    if (!this.send) return;
    const payload = JSON.stringify(this.notice(event));
    await this.send.query('select pg_notify($1, $2)', [CHANNEL, payload]);
  }

  private notice(event: WsServerEvent): RelayNotice {
    if (event.type.startsWith('graph.')) {
      return {
        kind: 'graph_event',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
      };
    }

    if (event.type === 'activity.logged') {
      return {
        kind: 'activity',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        activityId: event.payload.id,
      };
    }

    if (event.type === 'workflow.flow_updated') {
      return {
        kind: 'flow',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        flowId: event.payload.id,
      };
    }

    if (event.type === 'workflow.controller_updated') {
      return {
        kind: 'controller',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        controllerId: event.payload.id,
      };
    }

    if (event.type === 'agent.spawned') {
      return {
        kind: 'agent_run',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        runId: event.payload.id,
        eventType: event.type,
      };
    }

    if (event.type === 'agent.status') {
      return {
        kind: 'agent_run',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        runId: event.payload.id,
        eventType: event.type,
      };
    }

    if (event.type === 'agent.output_chunk') {
      return {
        kind: 'agent_run',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        runId: event.payload.agentRunId,
        eventType: event.type,
      };
    }

    if (event.type === 'system.resync_required') {
      return {
        kind: 'resync',
        instanceId: this.instanceId,
        sessionId: event.sessionId,
        eventId: event.eventId,
        reason: event.payload.reason,
      };
    }

    return {
      kind: 'resync',
      instanceId: this.instanceId,
      sessionId: event.sessionId,
      eventId: event.eventId,
      reason: 'unsupported_event',
    };
  }

  private async handleNotification(msg: Notification): Promise<void> {
    if (msg.channel !== CHANNEL || !msg.payload) return;

    let raw: unknown;
    try {
      raw = JSON.parse(msg.payload);
    } catch (err) {
      this.log.warn(`relay payload json parse failed: ${message(err)}`);
      return;
    }

    const parsed = relaySchema.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(`relay payload validation failed: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`);
      return;
    }

    const event = await this.hydrate(parsed.data);
    if (!event) return;
    for (const listener of this.listeners) {
      listener({ instanceId: parsed.data.instanceId, event });
    }
  }

  private async hydrate(msg: RelayNotice): Promise<WsServerEvent | null> {
    if (msg.kind === 'resync') {
      return {
        type: 'system.resync_required',
        eventId: msg.eventId,
        sessionId: msg.sessionId,
        payload: { reason: msg.reason },
      };
    }

    if (msg.kind === 'graph_event') {
      const row = await this.prisma.graphEvent.findUnique({
        where: {
          sessionId_eventId: {
            sessionId: msg.sessionId,
            eventId: msg.eventId,
          },
        },
      });
      if (!row) {
        return this.resync(msg.sessionId, 'graph_event_missing');
      }
      return graphEnvelopeToWs(graphEventRowToEnvelope(row));
    }

    if (msg.kind === 'activity') {
      const row = await this.prisma.activityEntry.findUnique({ where: { id: msg.activityId } });
      if (!row) {
        return this.resync(msg.sessionId, 'activity_missing');
      }
      return activityEvent(row, msg.eventId);
    }

    if (msg.kind === 'flow') {
      const row = await this.prisma.workflowManagedFlow.findUnique({ where: { id: msg.flowId } });
      if (!row) {
        return this.resync(msg.sessionId, 'flow_missing');
      }
      const payload = flowState(row);
      return {
        type: 'workflow.flow_updated',
        eventId: msg.eventId,
        sessionId: row.sessionId,
        actor: { type: 'system', id: 'workflow_managed_flow' },
        timestamp: row.updatedAt.toISOString(),
        payload,
      };
    }

    if (msg.kind === 'controller') {
      const row = await this.prisma.workflowControllerState.findUnique({ where: { id: msg.controllerId } });
      if (!row) {
        return this.resync(msg.sessionId, 'controller_missing');
      }
      const payload = controllerState(row);
      return {
        type: 'workflow.controller_updated',
        eventId: msg.eventId,
        sessionId: row.sessionId,
        ...(payload.currentChildRunId ? { runId: payload.currentChildRunId } : {}),
        actor: { type: 'system', id: 'workflow_controller' },
        timestamp: row.updatedAt.toISOString(),
        payload,
      };
    }

    const row = await this.prisma.agentRun.findUnique({ where: { id: msg.runId } });
    if (!row) {
      return this.resync(msg.sessionId, 'agent_run_missing');
    }

    if (msg.eventType === 'agent.output_chunk') {
      return {
        type: 'agent.output_chunk',
        eventId: msg.eventId,
        sessionId: row.sessionId,
        runId: row.id,
        actor: { type: 'agent', id: row.id },
        timestamp: row.updatedAt.toISOString(),
        payload: {
          agentRunId: row.id,
          ...(row.executionId ? { executionId: row.executionId } : {}),
          output: row.outputText ?? '',
          isStreaming: row.isStreaming,
        },
      };
    }

    const payload = agentRun(row);
    if (msg.eventType === 'agent.spawned') {
      return {
        type: 'agent.spawned',
        eventId: msg.eventId,
        sessionId: row.sessionId,
        actor: { type: 'agent', id: row.id },
        timestamp: row.updatedAt.toISOString(),
        payload,
      };
    }

    return {
      type: 'agent.status',
      eventId: msg.eventId,
      sessionId: row.sessionId,
      runId: row.id,
      actor: { type: 'agent', id: row.id },
      timestamp: row.updatedAt.toISOString(),
      payload,
    };
  }

  private resync(sessionId: string, reason: string): WsServerEvent {
    return {
      type: 'system.resync_required',
      eventId: 0,
      sessionId,
      payload: { reason },
    };
  }
}

function activityEvent(
  row: {
    id: string;
    sessionId: string;
    timestamp: Date;
    actorType: string;
    actorId: string;
    runId: string | null;
    wakeReason: string | null;
    requestId: string | null;
    workerId: string | null;
    worktreeId: string | null;
    summary: string;
    summaryKey: string | null;
    summaryParams: unknown;
    metadata: unknown;
    relatedNodeIds: unknown;
  },
  eventId: number,
): WsServerEvent {
  return {
    type: 'activity.logged',
    eventId,
    sessionId: row.sessionId,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.wakeReason ? { wakeReason: row.wakeReason as TimelineEntry['wakeReason'] } : {}),
    ...(row.requestId ? { requestId: row.requestId } : {}),
    ...(row.workerId ? { workerId: row.workerId } : {}),
    ...(row.worktreeId ? { worktreeId: row.worktreeId } : {}),
    actor: { type: row.actorType, id: row.actorId },
    timestamp: row.timestamp.toISOString(),
    payload: {
      id: row.id,
      summary: row.summary,
      ...(row.summaryKey ? { summaryKey: row.summaryKey } : {}),
      ...(record(row.summaryParams) ? { summaryParams: record(row.summaryParams) } : {}),
      ...(record(row.metadata) ? { metadata: record(row.metadata) } : {}),
      ...(stringList(row.relatedNodeIds) ? { relatedNodeIds: stringList(row.relatedNodeIds) } : {}),
    },
  };
}

function flowState(row: {
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
  updatedAt: Date;
}): WorkflowManagedFlowState {
  const parsed = readWorkflowManagedFlowState({
    ...(record(row.state) ?? {}),
    id: row.id,
    sessionId: row.sessionId,
    entryNodeId: row.entryNodeId,
    status: row.status,
    syncMode: row.syncMode,
    revision: row.revision,
    ...(row.currentPhaseId ? { currentPhaseId: row.currentPhaseId } : {}),
    ...(row.currentPhaseIndex != null ? { currentPhaseIndex: row.currentPhaseIndex } : {}),
    cancelRequested: row.cancelRequested,
    ...(record(row.wait) ? { wait: record(row.wait) } : {}),
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed) {
    throw new Error(`INVALID_WORKFLOW_MANAGED_FLOW_STATE:${row.id}`);
  }
  return parsed;
}

function controllerState(row: {
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
  updatedAt: Date;
}): WorkflowControllerState {
  const parsed = readWorkflowControllerState({
    ...(record(row.state) ?? {}),
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
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed) {
    throw new Error(`INVALID_WORKFLOW_CONTROLLER_STATE:${row.id}`);
  }
  return parsed;
}

function agentRun(row: {
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
  const model = modelRef(row.modelProviderId, row.modelId);
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
    seedNodeIds: stringList(row.seedNodeIds) ?? [],
    ...(row.rootNodeId ? { rootNodeId: row.rootNodeId } : {}),
    ...(row.triggerNodeId ? { triggerNodeId: row.triggerNodeId } : {}),
    ...(row.stepNodeId ? { stepNodeId: row.stepNodeId } : {}),
    ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
    ...(row.parentAgentId ? { parentAgentId: row.parentAgentId } : {}),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(model ? { model } : {}),
    ...(row.externalSessionId ? { externalSessionId: row.externalSessionId } : {}),
    ...(record(row.providerMetadata) ? { providerMetadata: record(row.providerMetadata) } : {}),
    ...(row.lastSeenEventId != null ? { lastSeenEventId: row.lastSeenEventId } : {}),
    ...(row.outputText != null ? { outputText: row.outputText } : {}),
    isStreaming: row.isStreaming,
  };
}

function modelRef(providerID: string | null, modelID: string | null): AgentModelRef | undefined {
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
