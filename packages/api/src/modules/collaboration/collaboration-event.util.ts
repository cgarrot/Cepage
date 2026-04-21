import type { GraphEventEnvelope, WsServerEvent } from '@cepage/shared-core';

type GraphEventRow = {
  eventId: number;
  sessionId: string;
  actor: unknown;
  runId: string | null;
  wakeReason: string | null;
  requestId: string | null;
  workerId: string | null;
  worktreeId: string | null;
  timestamp: Date;
  payload: unknown;
};

export function graphEventRowToEnvelope(row: GraphEventRow): GraphEventEnvelope {
  return {
    eventId: row.eventId,
    sessionId: row.sessionId,
    actor: row.actor as GraphEventEnvelope['actor'],
    runId: row.runId ?? undefined,
    wakeReason: (row.wakeReason as GraphEventEnvelope['wakeReason']) ?? undefined,
    requestId: row.requestId ?? undefined,
    workerId: row.workerId ?? undefined,
    worktreeId: row.worktreeId ?? undefined,
    timestamp: row.timestamp.toISOString(),
    payload: row.payload as GraphEventEnvelope['payload'],
  };
}

export function graphEnvelopeToWs(env: GraphEventEnvelope): WsServerEvent {
  const base = {
    eventId: env.eventId,
    sessionId: env.sessionId,
    actor: wsActor(env.actor),
    timestamp: env.timestamp,
  };
  const p = env.payload;

  switch (p.type) {
    case 'node_added':
      return {
        type: 'graph.node_added',
        ...base,
        ...(env.runId ? { runId: env.runId } : {}),
        ...(env.wakeReason ? { wakeReason: env.wakeReason } : {}),
        payload: p.node,
      };
    case 'node_updated':
      return {
        type: 'graph.node_updated',
        ...base,
        ...(env.runId ? { runId: env.runId } : {}),
        ...(env.requestId ? { requestId: env.requestId } : {}),
        ...(env.wakeReason ? { wakeReason: env.wakeReason } : {}),
        payload: { nodeId: p.nodeId, patch: p.patch },
      };
    case 'node_removed':
      return { type: 'graph.node_removed', ...base, payload: { nodeId: p.nodeId } };
    case 'edge_added':
      return { type: 'graph.edge_added', ...base, payload: p.edge };
    case 'edge_removed':
      return { type: 'graph.edge_removed', ...base, payload: { edgeId: p.edgeId } };
    case 'branch_created':
      return { type: 'graph.branch_created', ...base, payload: p.branch };
    case 'branch_merged':
      return {
        type: 'graph.branch_merged',
        ...base,
        payload: { sourceBranchId: p.sourceBranchId, targetBranchId: p.targetBranchId },
      };
    case 'branch_abandoned':
      return { type: 'graph.branch_abandoned', ...base, payload: { branchId: p.branchId } };
    case 'graph_cleared':
    case 'graph_restored':
      return {
        type: 'system.resync_required',
        eventId: env.eventId,
        sessionId: env.sessionId,
        payload: { reason: p.type },
      };
  }
}

function wsActor(actor: GraphEventEnvelope['actor']): { type: string; id: string } {
  if (actor.type === 'human') return { type: 'human', id: actor.userId };
  if (actor.type === 'agent') return { type: 'agent', id: actor.agentId };
  return { type: 'system', id: actor.reason };
}
