import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createGraphStore } from '@cepage/graph-core';
import type {
  Creator,
  GraphEdge,
  GraphEventEnvelope,
  GraphNode,
  GraphSnapshot,
  WorkflowTransfer,
  WakeReason,
} from '@cepage/shared-core';
import { parseWorkflowTransfer, rekeyWorkflowTransfer, workflowToSnapshot } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { RunSupervisorService } from '../execution/run-supervisor.service';
import { getEnv } from '@cepage/config';

@Injectable()
export class GraphService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationBusService,
    @Optional()
    private readonly supervisor?: RunSupervisorService,
  ) {}

  async loadSnapshot(sessionId: string): Promise<GraphSnapshot> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { nodes: true, edges: true, branches: true },
    });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    const nodes: GraphNode[] = session.nodes.map((n) => ({
      id: n.id,
      type: n.type as GraphNode['type'],
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      content: n.content as GraphNode['content'],
      creator: n.creator as GraphNode['creator'],
      position: { x: n.positionX, y: n.positionY },
      dimensions: { width: n.width, height: n.height },
      metadata: n.metadata as Record<string, unknown>,
      status: n.status as GraphNode['status'],
      branches: n.branchIds as string[],
    }));
    const edges: GraphEdge[] = session.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.relation as GraphEdge['relation'],
      direction: e.direction as GraphEdge['direction'],
      strength: e.strength,
      createdAt: e.createdAt.toISOString(),
      creator: e.creator as GraphEdge['creator'],
      metadata: e.metadata as Record<string, unknown>,
    }));
    const branches = session.branches.map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy as GraphSnapshot['branches'][0]['createdBy'],
      headNodeId: b.headNodeId,
      nodeIds: b.nodeIds as string[],
      parentBranchId: b.parentBranchId ?? undefined,
      forkedFromNodeId: b.forkedFromNodeId ?? undefined,
      status: b.status as GraphSnapshot['branches'][0]['status'],
      mergedIntoBranchId: b.mergedIntoBranchId ?? undefined,
    }));
    return {
      version: 1,
      id: sessionId,
      createdAt: session.createdAt.toISOString(),
      lastEventId: session.lastEventId,
      nodes,
      edges,
      branches,
      viewport: { x: session.viewportX, y: session.viewportY, zoom: session.viewportZoom },
    };
  }

  private async persistAndBroadcast(
    sessionId: string,
    env: GraphEventEnvelope,
  ): Promise<GraphEventEnvelope> {
    const next = await this.prisma.$transaction(async (tx) => {
      const eventId = (
        await tx.session.update({
          where: { id: sessionId },
          data: { lastEventId: { increment: 1 } },
          select: { lastEventId: true },
        })
      ).lastEventId;
      const next = { ...env, eventId };
      const p = next.payload;
      switch (p.type) {
        case 'node_added': {
          const n = p.node;
          await tx.graphNode.create({
            data: {
              id: n.id,
              sessionId,
              type: n.type,
              content: n.content as object,
              creator: n.creator as object,
              positionX: n.position.x,
              positionY: n.position.y,
              width: n.dimensions.width,
              height: n.dimensions.height,
              metadata: n.metadata as object,
              status: n.status,
              branchIds: n.branches,
              createdAt: new Date(n.createdAt),
              updatedAt: new Date(n.updatedAt),
            },
          });
          break;
        }
        case 'node_updated': {
          const patch = p.patch;
          const data: Record<string, unknown> = { updatedAt: new Date() };
          if (patch.content !== undefined) data.content = patch.content as object;
          if (patch.position) {
            data.positionX = patch.position.x;
            data.positionY = patch.position.y;
          }
          if (patch.dimensions) {
            data.width = patch.dimensions.width;
            data.height = patch.dimensions.height;
          }
          if (patch.status !== undefined) data.status = patch.status;
          if (patch.metadata !== undefined) data.metadata = patch.metadata as object;
          if (patch.branches !== undefined) data.branchIds = patch.branches;
          await tx.graphNode.update({ where: { id: p.nodeId }, data: data as never });
          break;
        }
        case 'node_removed': {
          if (p.affectedEdges.length > 0) {
            await tx.graphEdge.deleteMany({
              where: { sessionId, id: { in: p.affectedEdges } },
            });
          }
          await tx.graphNode.delete({ where: { id: p.nodeId } });
          break;
        }
        case 'edge_added': {
          const e = p.edge;
          await tx.graphEdge.create({
            data: {
              id: e.id,
              sessionId,
              source: e.source,
              target: e.target,
              relation: e.relation,
              direction: e.direction,
              strength: e.strength,
              creator: e.creator as object,
              metadata: e.metadata as object,
              createdAt: new Date(e.createdAt),
            },
          });
          break;
        }
        case 'edge_removed': {
          await tx.graphEdge.delete({ where: { id: p.edgeId } });
          break;
        }
        case 'branch_created': {
          const b = p.branch;
          await tx.branch.create({
            data: {
              id: b.id,
              sessionId,
              name: b.name,
              color: b.color,
              headNodeId: b.headNodeId,
              nodeIds: b.nodeIds,
              parentBranchId: b.parentBranchId,
              forkedFromNodeId: b.forkedFromNodeId,
              status: b.status,
              mergedIntoBranchId: b.mergedIntoBranchId,
              createdBy: b.createdBy as object,
              createdAt: new Date(b.createdAt),
            },
          });
          break;
        }
        case 'branch_merged': {
          await tx.branch.update({
            where: { id: p.sourceBranchId },
            data: { status: 'merged', mergedIntoBranchId: p.targetBranchId },
          });
          break;
        }
        case 'branch_abandoned': {
          await tx.branch.update({
            where: { id: p.branchId },
            data: { status: 'abandoned' },
          });
          break;
        }
        default:
          break;
      }
      await tx.graphEvent.create({
        data: {
          eventId: next.eventId,
          sessionId,
          kind: p.type,
          payload: p as object,
          actor: next.actor as object,
          runId: next.runId,
          wakeReason: next.wakeReason,
          requestId: next.requestId,
          workerId: next.workerId,
          worktreeId: next.worktreeId,
          timestamp: new Date(next.timestamp),
        },
      });
      return next;
    });

    const interval = getEnv().SNAPSHOT_EVENT_INTERVAL;
    if (next.eventId > 0 && next.eventId % interval === 0) {
      const snap = await this.loadSnapshot(sessionId);
      await this.prisma.graphSnapshot.create({
        data: {
          sessionId,
          lastEventId: next.eventId,
          data: snap as object,
        },
      });
    }

    this.broadcastEnvelope(sessionId, next);
    await this.notifyGraphChangeWatchers(next);
    return next;
  }

  private async notifyGraphChangeWatchers(env: GraphEventEnvelope): Promise<void> {
    if (!this.supervisor) {
      return;
    }
    const rows = await this.prisma.watchSubscription.findMany({
      where: {
        sessionId: env.sessionId,
        status: 'active',
        kind: {
          in: ['graph_node', 'graph_branch'],
        },
      },
      select: {
        id: true,
        sessionId: true,
        target: true,
      },
    });
    const matched = rows.filter((row) => matchesWatchSubscription(row.target, env));
    for (const row of matched) {
      await this.prisma.watchSubscription.update({
        where: { id: row.id },
        data: {
          lastEventAt: new Date(env.timestamp),
          cursor: String(env.eventId),
        },
      });
      await this.supervisor.queueWatchTrigger({
        sessionId: row.sessionId,
        subscriptionId: row.id,
        eventId: env.eventId,
      });
    }
  }

  private broadcastEnvelope(sessionId: string, env: GraphEventEnvelope): void {
    const p = env.payload;
    const actor = wsActor(env.actor);
    const base = {
      eventId: env.eventId,
      sessionId,
      runId: env.runId,
      requestId: env.requestId,
      wakeReason: env.wakeReason,
      workerId: env.workerId,
      worktreeId: env.worktreeId,
      actor,
      timestamp: env.timestamp,
    };
    switch (p.type) {
      case 'node_added':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.node_added',
          ...base,
          payload: p.node,
        });
        break;
      case 'node_updated':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.node_updated',
          ...base,
          payload: { nodeId: p.nodeId, patch: p.patch },
        });
        break;
      case 'node_removed':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.node_removed',
          ...base,
          payload: { nodeId: p.nodeId },
        });
        break;
      case 'edge_added':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.edge_added',
          ...base,
          payload: p.edge,
        });
        break;
      case 'edge_removed':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.edge_removed',
          ...base,
          payload: { edgeId: p.edgeId },
        });
        break;
      case 'branch_created':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.branch_created',
          ...base,
          payload: p.branch,
        });
        break;
      case 'branch_merged':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.branch_merged',
          ...base,
          payload: { sourceBranchId: p.sourceBranchId, targetBranchId: p.targetBranchId },
        });
        break;
      case 'branch_abandoned':
        this.collaboration.emitSession(sessionId, {
          type: 'graph.branch_abandoned',
          ...base,
          payload: { branchId: p.branchId },
        });
        break;
      default:
        break;
    }
  }

  private async withStore(
    sessionId: string,
    fn: (store: ReturnType<typeof createGraphStore>) => GraphEventEnvelope,
  ): Promise<GraphEventEnvelope> {
    const snap = await this.loadSnapshot(sessionId);
    const store = createGraphStore({ sessionId });
    store.hydrateFromSnapshot(snap);
    const env = fn(store);
    return this.persistAndBroadcast(sessionId, env);
  }

  async addNode(
    sessionId: string,
    input: {
      type: GraphNode['type'];
      content: GraphNode['content'];
      position: { x: number; y: number };
      creator: Creator;
      requestId?: string;
      dimensions?: { width: number; height: number };
      metadata?: Record<string, unknown>;
      branches?: string[];
      status?: GraphNode['status'];
      runId?: string;
      wakeReason?: WakeReason;
    },
  ): Promise<GraphEventEnvelope> {
    return this.withStore(sessionId, (store) =>
      store.addNode(
        {
          type: input.type,
          content: input.content,
          creator: input.creator,
          position: input.position,
          dimensions: input.dimensions,
          metadata: input.metadata,
          branches: input.branches,
          status: input.status,
        },
        { requestId: input.requestId, runId: input.runId, wakeReason: input.wakeReason },
      ),
    );
  }

  async patchNode(
    sessionId: string,
    nodeId: string,
    patch: Partial<
      Pick<GraphNode, 'content' | 'position' | 'dimensions' | 'status' | 'metadata' | 'branches'>
    >,
    actor: Creator,
    requestId?: string,
  ): Promise<GraphEventEnvelope> {
    return this.withStore(sessionId, (store) => store.updateNode(nodeId, patch, actor, { requestId }));
  }

  async removeNode(sessionId: string, nodeId: string, actor: Creator, requestId?: string) {
    return this.withStore(sessionId, (store) => store.removeNode(nodeId, actor, { requestId }));
  }

  async addEdge(
    sessionId: string,
    input: {
      source: string;
      target: string;
      relation: GraphEdge['relation'];
      direction?: GraphEdge['direction'];
      creator: Creator;
      requestId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.withStore(sessionId, (store) =>
      store.addEdge(
        {
          source: input.source,
          target: input.target,
          relation: input.relation,
          direction: input.direction,
          creator: input.creator,
          metadata: input.metadata,
        },
        { requestId: input.requestId },
      ),
    );
  }

  async removeEdge(sessionId: string, edgeId: string, actor: Creator, requestId?: string) {
    return this.withStore(sessionId, (store) => store.removeEdge(edgeId, actor, { requestId }));
  }

  async createBranch(
    sessionId: string,
    input: {
      name: string;
      color: string;
      fromNodeId: string;
      actor: Creator;
      requestId?: string;
    },
  ) {
    return this.withStore(sessionId, (store) =>
      store.createBranch(input.name, input.color, input.fromNodeId, input.actor, {
        requestId: input.requestId,
      }),
    );
  }

  async mergeBranch(
    sessionId: string,
    input: {
      sourceBranchId: string;
      targetBranchId: string;
      actor: Creator;
      requestId?: string;
    },
  ) {
    return this.withStore(sessionId, (store) =>
      store.mergeBranch(input.sourceBranchId, input.targetBranchId, input.actor, {
        requestId: input.requestId,
      }),
    );
  }

  async abandonBranch(
    sessionId: string,
    input: {
      branchId: string;
      actor: Creator;
      requestId?: string;
    },
  ) {
    return this.withStore(sessionId, (store) =>
      store.abandonBranch(input.branchId, input.actor, {
        requestId: input.requestId,
      }),
    );
  }

  async updateViewport(
    sessionId: string,
    viewport: { x: number; y: number; zoom: number },
  ): Promise<number> {
    const current = await this.loadSnapshot(sessionId);
    let eventId = 0;
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: {
          viewportX: viewport.x,
          viewportY: viewport.y,
          viewportZoom: viewport.zoom,
          lastEventId: { increment: 1 },
        },
        select: { lastEventId: true },
      });
      eventId = row.lastEventId;
      const snap = {
        ...current,
        lastEventId: eventId,
        viewport: { ...viewport },
      };
      await tx.graphEvent.create({
        data: {
          eventId,
          sessionId,
          kind: 'graph_restored',
          payload: { type: 'graph_restored', snapshot: snap } as object,
          actor: { type: 'system', reason: 'viewport_update' } as object,
          timestamp: new Date(),
        },
      });
      await tx.graphSnapshot.create({
        data: {
          sessionId,
          lastEventId: eventId,
          data: snap as object,
        },
      });
    });
    this.collaboration.emitSession(sessionId, {
      type: 'system.resync_required',
      eventId,
      sessionId,
      payload: { reason: 'viewport_update' },
    });
    return eventId;
  }

  async restoreWorkflow(
    sessionId: string,
    flow: WorkflowTransfer,
    actor: Creator,
    reason: string = 'workflow_copilot_restore',
  ): Promise<{
    eventId: number;
    counts: {
      nodes: number;
      edges: number;
      branches: number;
    };
  }> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { lastEventId: true },
    });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const now = new Date();
    let eventId = 0;

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: {
          viewportX: flow.graph.viewport.x,
          viewportY: flow.graph.viewport.y,
          viewportZoom: flow.graph.viewport.zoom,
          lastEventId: { increment: 1 },
        },
        select: { lastEventId: true },
      });
      eventId = row.lastEventId;
      const snap = workflowToSnapshot(sessionId, flow, eventId, now.toISOString());
      await tx.branch.deleteMany({ where: { sessionId } });
      await tx.graphEdge.deleteMany({ where: { sessionId } });
      await tx.graphNode.deleteMany({ where: { sessionId } });

      for (const node of snap.nodes) {
        await tx.graphNode.create({
          data: {
            id: node.id,
            sessionId,
            type: node.type,
            content: node.content as object,
            creator: node.creator as object,
            positionX: node.position.x,
            positionY: node.position.y,
            width: node.dimensions.width,
            height: node.dimensions.height,
            metadata: node.metadata as object,
            status: node.status,
            branchIds: node.branches,
            createdAt: new Date(node.createdAt),
            updatedAt: new Date(node.updatedAt),
          },
        });
      }

      for (const edge of snap.edges) {
        await tx.graphEdge.create({
          data: {
            id: edge.id,
            sessionId,
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            direction: edge.direction,
            strength: edge.strength,
            creator: edge.creator as object,
            metadata: edge.metadata as object,
            createdAt: new Date(edge.createdAt),
          },
        });
      }

      for (const branch of snap.branches) {
        await tx.branch.create({
          data: {
            id: branch.id,
            sessionId,
            name: branch.name,
            color: branch.color,
            headNodeId: branch.headNodeId,
            nodeIds: branch.nodeIds,
            parentBranchId: branch.parentBranchId,
            forkedFromNodeId: branch.forkedFromNodeId,
            status: branch.status,
            mergedIntoBranchId: branch.mergedIntoBranchId,
            createdBy: branch.createdBy as object,
            createdAt: new Date(branch.createdAt),
          },
        });
      }

      await tx.graphEvent.create({
        data: {
          eventId,
          sessionId,
          kind: 'graph_restored',
          payload: { type: 'graph_restored', snapshot: snap } as object,
          actor: actor as object,
          timestamp: now,
        },
      });

      await tx.graphSnapshot.create({
        data: {
          sessionId,
          lastEventId: eventId,
          data: snap as object,
        },
      });
    });

    this.collaboration.emitSession(sessionId, {
      type: 'system.resync_required',
      eventId,
      sessionId,
      payload: { reason },
    });

    return {
      eventId,
      counts: {
        nodes: flow.graph.nodes.length,
        edges: flow.graph.edges.length,
        branches: flow.graph.branches.length,
      },
    };
  }

  async replaceWorkflow(sessionId: string, body: unknown) {
    const parsed = parseWorkflowTransfer(body);
    if (!parsed.success) {
      throwWorkflowValidation(parsed.errors);
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { lastEventId: true },
    });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const now = new Date();
    const actor: Creator = { type: 'system', reason: 'workflow_import' };
    let eventId = 0;

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: {
          viewportX: parsed.data.graph.viewport.x,
          viewportY: parsed.data.graph.viewport.y,
          viewportZoom: parsed.data.graph.viewport.zoom,
          lastEventId: { increment: 1 },
        },
        select: { lastEventId: true },
      });
      eventId = row.lastEventId;
      const snap = workflowToSnapshot(sessionId, rekeyWorkflowTransfer(parsed.data), eventId, now.toISOString());
      await tx.graphSnapshot.deleteMany({ where: { sessionId } });
      await tx.graphEvent.deleteMany({ where: { sessionId } });
      await tx.activityEntry.deleteMany({ where: { sessionId } });
      await tx.agentRun.deleteMany({ where: { sessionId } });
      await tx.branch.deleteMany({ where: { sessionId } });
      await tx.graphEdge.deleteMany({ where: { sessionId } });
      await tx.graphNode.deleteMany({ where: { sessionId } });

      for (const node of snap.nodes) {
        await tx.graphNode.create({
          data: {
            id: node.id,
            sessionId,
            type: node.type,
            content: node.content as object,
            creator: node.creator as object,
            positionX: node.position.x,
            positionY: node.position.y,
            width: node.dimensions.width,
            height: node.dimensions.height,
            metadata: node.metadata as object,
            status: node.status,
            branchIds: node.branches,
            createdAt: new Date(node.createdAt),
            updatedAt: new Date(node.updatedAt),
          },
        });
      }

      for (const edge of snap.edges) {
        await tx.graphEdge.create({
          data: {
            id: edge.id,
            sessionId,
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            direction: edge.direction,
            strength: edge.strength,
            creator: edge.creator as object,
            metadata: edge.metadata as object,
            createdAt: new Date(edge.createdAt),
          },
        });
      }

      for (const branch of snap.branches) {
        await tx.branch.create({
          data: {
            id: branch.id,
            sessionId,
            name: branch.name,
            color: branch.color,
            headNodeId: branch.headNodeId,
            nodeIds: branch.nodeIds,
            parentBranchId: branch.parentBranchId,
            forkedFromNodeId: branch.forkedFromNodeId,
            status: branch.status,
            mergedIntoBranchId: branch.mergedIntoBranchId,
            createdBy: branch.createdBy as object,
            createdAt: new Date(branch.createdAt),
          },
        });
      }

      // Keep a restore marker in the event log so reconnecting clients can resync.
      await tx.graphEvent.create({
        data: {
          eventId,
          sessionId,
          kind: 'graph_restored',
          payload: { type: 'graph_restored', snapshot: snap } as object,
          actor: actor as object,
          timestamp: now,
        },
      });

      await tx.graphSnapshot.create({
        data: {
          sessionId,
          lastEventId: eventId,
          data: snap as object,
        },
      });
    });
    this.collaboration.emitSession(sessionId, {
      type: 'system.resync_required',
      eventId,
      sessionId,
      payload: { reason: 'workflow_imported' },
    });

    return {
      eventId,
      counts: {
        nodes: parsed.data.graph.nodes.length,
        edges: parsed.data.graph.edges.length,
        branches: parsed.data.graph.branches.length,
      },
    };
  }

  async listEvents(sessionId: string, afterEventId: number | undefined, limit: number) {
    return this.prisma.graphEvent.findMany({
      where: { sessionId, ...(afterEventId != null ? { eventId: { gt: afterEventId } } : {}) },
      orderBy: { eventId: 'asc' },
      take: limit,
    });
  }
}

function wsActor(actor: Creator): { type: string; id: string } {
  if (actor.type === 'human') return { type: 'human', id: actor.userId };
  if (actor.type === 'agent') return { type: 'agent', id: actor.agentId };
  return { type: 'system', id: actor.reason };
}

function matchesWatchSubscription(target: string, env: GraphEventEnvelope): boolean {
  const payload = env.payload;
  if (payload.type === 'node_added' || payload.type === 'node_updated' || payload.type === 'node_removed') {
    return payload.nodeId === target;
  }
  if (payload.type === 'branch_created' || payload.type === 'branch_abandoned') {
    return payload.branchId === target;
  }
  if (payload.type === 'branch_merged') {
    return payload.sourceBranchId === target || payload.targetBranchId === target;
  }
  return false;
}

function throwWorkflowValidation(errors: string[]): never {
  throw new BadRequestException({
    message: 'VALIDATION_FAILED',
    errors: [{ field: 'workflow', messages: errors }],
  });
}
