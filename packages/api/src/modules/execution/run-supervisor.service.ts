import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WakeReason } from '@cepage/shared-core';
import { ExecutionQueueService } from './execution-queue.service';
import type {
  AgentRunJobPayload,
  ConnectorJobPayload,
  ControllerJobPayload,
  FlowJobPayload,
  RuntimeJobPayload,
  ScheduledTriggerJobPayload,
  WatchTriggerJobPayload,
} from './execution-job-payload';

@Injectable()
export class RunSupervisorService {
  constructor(private readonly queue: ExecutionQueueService) {}

  flowKey(flowId: string): string {
    return `workflow-flow:${flowId}:advance`;
  }

  controllerKey(controllerId: string): string {
    return `workflow-controller:${controllerId}:advance`;
  }

  agentRunKey(runId: string): string {
    return `agent-run:${runId}:execute`;
  }

  runtimeKey(operation: RuntimeJobPayload['operation'], sessionId: string, targetId: string): string {
    return `runtime:${operation}:${sessionId}:${targetId}`;
  }

  connectorKey(sessionId: string, targetNodeId: string, requestId?: string): string {
    return `connector:${sessionId}:${targetNodeId}:${requestId ?? randomUUID()}`;
  }

  scheduledTriggerKey(triggerId: string): string {
    return `scheduled-trigger:${triggerId}`;
  }

  watchTriggerKey(subscriptionId: string, eventId?: number): string {
    return eventId == null ? `watch-trigger:${subscriptionId}` : `watch-trigger:${subscriptionId}:${eventId}`;
  }

  async queueFlow(sessionId: string, payload: FlowJobPayload) {
    return this.queue.ensureJob({
      key: this.flowKey(payload.flowId),
      kind: 'workflow_managed_flow',
      ownerKind: 'workflow_managed_flow',
      ownerId: payload.flowId,
      sessionId,
      payload,
    });
  }

  async queueController(sessionId: string, payload: ControllerJobPayload) {
    return this.queue.ensureJob({
      key: this.controllerKey(payload.controllerId),
      kind: 'workflow_controller',
      ownerKind: 'workflow_controller',
      ownerId: payload.controllerId,
      sessionId,
      payload,
    });
  }

  async queueAgentRun(payload: AgentRunJobPayload) {
    return this.queue.ensureJob({
      key: this.agentRunKey(payload.runId),
      kind: 'agent_run',
      ownerKind: payload.mode === 'execution' ? 'workflow_execution' : 'agent_run',
      ownerId: payload.executionId ?? payload.runId,
      sessionId: payload.sessionId,
      runId: payload.runId,
      executionId: payload.executionId,
      requestId: payload.requestId,
      wakeReason: payload.wakeReason,
      payload,
      priority: payload.mode === 'execution' ? 10 : 5,
    });
  }

  async queueRuntime(payload: RuntimeJobPayload) {
    const target = payload.targetNodeId ?? payload.runNodeId ?? 'missing';
    return this.queue.ensureJob({
      key: this.runtimeKey(payload.operation, payload.sessionId, target),
      kind:
        payload.operation === 'start'
          ? 'runtime_start'
          : payload.operation === 'stop'
            ? 'runtime_stop'
            : 'runtime_restart',
      ownerKind: 'runtime',
      ownerId: target,
      sessionId: payload.sessionId,
      payload,
      priority: payload.operation === 'stop' ? 20 : 4,
    });
  }

  async queueConnector(payload: ConnectorJobPayload) {
    return this.queue.ensureJob({
      key: this.connectorKey(payload.sessionId, payload.targetNodeId, payload.requestId),
      kind: 'connector_run',
      ownerKind: 'connector_target',
      ownerId: payload.targetNodeId,
      sessionId: payload.sessionId,
      requestId: payload.requestId,
      payload,
      priority: 6,
    });
  }

  async queueScheduledTrigger(payload: ScheduledTriggerJobPayload) {
    return this.queue.ensureJob({
      key: this.scheduledTriggerKey(payload.triggerId),
      kind: 'scheduled_trigger',
      ownerKind: 'scheduled_trigger',
      ownerId: payload.triggerId,
      sessionId: payload.sessionId,
      payload,
    });
  }

  async queueWatchTrigger(payload: WatchTriggerJobPayload) {
    return this.queue.ensureJob({
      key: this.watchTriggerKey(payload.subscriptionId, payload.eventId),
      kind: 'watch_trigger',
      ownerKind: 'watch_subscription',
      ownerId: payload.subscriptionId,
      sessionId: payload.sessionId,
      payload,
      priority: 8,
    });
  }

  async queueApprovalResolution(input: {
    sessionId: string;
    approvalId: string;
    wakeReason?: WakeReason;
  }) {
    return this.queue.ensureJob({
      key: `approval:${input.approvalId}:resolution`,
      kind: 'approval_resolution',
      ownerKind: 'approval_request',
      ownerId: input.approvalId,
      sessionId: input.sessionId,
      wakeReason: input.wakeReason,
      payload: {
        sessionId: input.sessionId,
        approvalId: input.approvalId,
      },
    });
  }
}
