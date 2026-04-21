import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  peelCopilotEmbeddedFilesFromNodeContent,
  workflowCopilotApplySummarySchema,
  workflowFromSnapshot,
  type AgentType,
  type GraphNode,
  type WorkflowCopilotApplyResult,
  type WorkflowCopilotAttachment,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { GraphService } from '../graph/graph.service';
import { edgeKey } from './workflow-copilot-graph';
import {
  buildDerivedBoundInputContent,
  defaultNodeContent,
  normalizeNodeContent,
  normalizeNodePatch,
  resolveNodeRef,
} from './workflow-copilot-normalize';
import {
  agentTypeSchemaOrThrow,
  readApply,
  readMode,
  readOps,
  readScope,
  readSummary,
  rowToMessage,
  shortId,
} from './workflow-copilot-rows';
import { canRecoverApplyError, formatApplyError } from './workflow-copilot-runtime';
import { scopeNodeIds } from './workflow-copilot-prompt';
import {
  HUMAN_ACTOR,
  WORKFLOW_COPILOT_APPLY_DISABLED_IN_ASK_MODE,
  type MessageRow,
  type ThreadRow,
} from './workflow-copilot.types';

type ApplyDeps = {
  prisma: PrismaService;
  graph: GraphService;
  activity: ActivityService;
  readThreadRow: (sessionId: string, threadId: string) => Promise<ThreadRow>;
  readMessageRow: (threadId: string, messageId: string) => Promise<MessageRow>;
  readBundle: (
    sessionId: string,
    threadId: string,
  ) => Promise<{
    thread: WorkflowCopilotApplyResult['thread'];
    messages: Array<WorkflowCopilotApplyResult['message']>;
    checkpoints: WorkflowCopilotApplyResult['checkpoints'];
  }>;
  materializeCopilotEmbeddedFiles: (
    sessionId: string,
    nodeId: string,
    files: WorkflowCopilotAttachment[],
    nodesById: Map<string, GraphNode>,
    eventId: number,
  ) => Promise<number>;
  reconcileStructuredNodeRefs: (input: {
    sessionId: string;
    threadId: string;
    messageId: string;
    refs: Map<string, string>;
    nodesById: Map<string, GraphNode>;
    nodeTypes: Map<string, GraphNode['type']>;
    touchedNodeIds: Set<string>;
    createdNodeIds: string[];
    updatedNodeIds: string[];
    summary: string[];
    eventId: number;
    fallback: AgentType;
  }) => Promise<number>;
  validateStructuredNodes: (input: {
    nodeIds: Set<string>;
    nodesById: Map<string, GraphNode>;
  }) => void;
  materializeWorkflowEdges: (input: {
    sessionId: string;
    threadId: string;
    messageId: string;
    nodeIds: Set<string>;
    nodesById: Map<string, GraphNode>;
    edgeKeys: Set<string>;
    createdEdgeIds: string[];
    summary: string[];
    eventId: number;
  }) => Promise<number>;
};

export async function applyWorkflowCopilotMessage(
  deps: ApplyDeps,
  input: {
    sessionId: string;
    threadId: string;
    messageId: string;
  },
): Promise<WorkflowCopilotApplyResult> {
  const thread = await deps.readThreadRow(input.sessionId, input.threadId);
  if (readMode(thread.mode) === 'ask') {
    throw new BadRequestException(WORKFLOW_COPILOT_APPLY_DISABLED_IN_ASK_MODE);
  }
  const message = await deps.readMessageRow(input.threadId, input.messageId);
  if (message.role !== 'assistant') {
    throw new BadRequestException('WORKFLOW_COPILOT_ASSISTANT_REQUIRED');
  }

  const existingApply = readApply(message.apply);
  if (existingApply) {
    const bundle = await deps.readBundle(input.sessionId, input.threadId);
    return {
      thread: bundle.thread,
      message: rowToMessage({
        ...message,
        apply: existingApply,
      }),
      checkpoints: bundle.checkpoints,
    };
  }

  const ops = readOps(message.ops);
  const snapshot = await deps.graph.loadSnapshot(input.sessionId);
  const before = workflowFromSnapshot(snapshot);
  const checkpoint = await deps.prisma.workflowCopilotCheckpoint.create({
    data: {
      sessionId: input.sessionId,
      threadId: input.threadId,
      messageId: input.messageId,
      summary: readSummary(message.summary) as never,
      flow: before as never,
    },
  });

  const refs = new Map<string, string>();
  const summary: string[] = [];
  const createdNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const removedEdgeIds: string[] = [];
  const createdBranchIds: string[] = [];
  const mergedBranchIds: string[] = [];
  const abandonedBranchIds: string[] = [];
  let viewportUpdated = false;
  let mutated = false;
  let eventId = snapshot.lastEventId ?? 0;
  const edgesById = new Map(snapshot.edges.map((edge) => [edge.id, edge] as const));
  const edgeKeys = new Set(snapshot.edges.map((edge) => edgeKey(edge)));
  const touchedNodeIds = new Set<string>();
  const nodeTypes = new Map(snapshot.nodes.map((node) => [node.id, node.type] as const));
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
  try {
    for (const [index, op] of ops.entries()) {
      const requestId = `workflow-copilot:${input.threadId}:${input.messageId}:${index}`;
      if (op.kind === 'add_node') {
        let rawAddContent: GraphNode['content'] = op.content ?? defaultNodeContent(op.type);
        let embeddedForFileSummary: WorkflowCopilotAttachment[] = [];
        if (op.type === 'file_summary') {
          const peel = peelCopilotEmbeddedFilesFromNodeContent(rawAddContent);
          if (!peel.ok) throw new BadRequestException(peel.error);
          embeddedForFileSummary = peel.files;
          const rest = peel.rest;
          const hasRest =
            rest !== null &&
            typeof rest === 'object' &&
            !Array.isArray(rest) &&
            Object.keys(rest as object).length > 0;
          rawAddContent = hasRest ? (rest as GraphNode['content']) : defaultNodeContent('file_summary');
        }
        const next = normalizeNodeContent(
          op.type,
          rawAddContent,
          agentTypeSchemaOrThrow(thread.agentType),
          refs,
          input.sessionId,
          nodesById,
        );
        const env = await deps.graph.addNode(input.sessionId, {
          type: next.type,
          content: next.content,
          creator: HUMAN_ACTOR,
          position: op.position,
          requestId,
          dimensions: op.dimensions,
          metadata: op.metadata,
          branches: op.branches,
          status: op.status,
        });
        if (env.payload.type !== 'node_added') continue;
        mutated = true;
        const nodeId = env.payload.node.id;
        if (op.ref) refs.set(op.ref, nodeId);
        nodeTypes.set(nodeId, next.type);
        nodesById.set(nodeId, env.payload.node);
        touchedNodeIds.add(nodeId);
        createdNodeIds.push(nodeId);
        summary.push(`Added ${op.type} node ${shortId(nodeId)}.`);
        eventId = env.eventId;
        if (embeddedForFileSummary.length > 0) {
          eventId = await deps.materializeCopilotEmbeddedFiles(
            input.sessionId,
            nodeId,
            embeddedForFileSummary,
            nodesById,
            eventId,
          );
          summary.push(`Materialized ${embeddedForFileSummary.length} file(s) into ${shortId(nodeId)}.`);
        }
        continue;
      }

      if (op.kind === 'patch_node') {
        const nodeId = resolveNodeRef(op.nodeId, refs);
        const currentNode = nodesById.get(nodeId);
        const derivedBound = currentNode ? buildDerivedBoundInputContent(currentNode, op.patch) : null;
        if (derivedBound && currentNode) {
          const env = await deps.graph.addNode(input.sessionId, {
            type: 'input',
            content: derivedBound,
            creator: HUMAN_ACTOR,
            position: {
              x: currentNode.position.x + 40,
              y: currentNode.position.y + 160,
            },
            requestId,
          });
          if (env.payload.type !== 'node_added') continue;
          mutated = true;
          const boundNodeId = env.payload.node.id;
          nodeTypes.set(boundNodeId, 'input');
          nodesById.set(boundNodeId, env.payload.node);
          touchedNodeIds.add(boundNodeId);
          createdNodeIds.push(boundNodeId);
          summary.push(`Added bound input ${shortId(boundNodeId)} from template ${shortId(nodeId)}.`);
          eventId = env.eventId;
          const edge = await deps.graph.addEdge(input.sessionId, {
            source: nodeId,
            target: boundNodeId,
            relation: 'derived_from',
            direction: 'source_to_target',
            creator: HUMAN_ACTOR,
            requestId: `${requestId}:derived_from`,
          });
          if (edge.payload.type !== 'edge_added') continue;
          edgesById.set(edge.payload.edge.id, edge.payload.edge);
          edgeKeys.add(edgeKey(edge.payload.edge));
          createdEdgeIds.push(edge.payload.edge.id);
          eventId = edge.eventId;
          continue;
        }
        let patchOp = op.patch;
        let embeddedPatch: WorkflowCopilotAttachment[] = [];
        if (nodeTypes.get(nodeId) === 'file_summary' && op.patch.content !== undefined) {
          const peel = peelCopilotEmbeddedFilesFromNodeContent(op.patch.content);
          if (!peel.ok) throw new BadRequestException(peel.error);
          embeddedPatch = peel.files;
          const rest = peel.rest;
          const hasRest =
            rest !== null &&
            typeof rest === 'object' &&
            !Array.isArray(rest) &&
            Object.keys(rest as object).length > 0;
          patchOp = hasRest
            ? { ...op.patch, content: rest as Record<string, unknown> }
            : (() => {
                const { content: _ignore, ...restPatch } = op.patch;
                return restPatch;
              })();
        }
        const nextPatch = normalizeNodePatch(
          nodeTypes.get(nodeId),
          patchOp,
          refs,
          input.sessionId,
          agentTypeSchemaOrThrow(thread.agentType),
          nodesById,
        );
        const env = await deps.graph.patchNode(
          input.sessionId,
          nodeId,
          nextPatch,
          HUMAN_ACTOR,
          requestId,
        );
        if (env.payload.type !== 'node_updated') continue;
        mutated = true;
        if (currentNode) {
          nodesById.set(nodeId, {
            ...currentNode,
            ...nextPatch,
            position: nextPatch.position ? { ...nextPatch.position } : currentNode.position,
            dimensions: nextPatch.dimensions ? { ...nextPatch.dimensions } : currentNode.dimensions,
            metadata: nextPatch.metadata ? { ...currentNode.metadata, ...nextPatch.metadata } : currentNode.metadata,
            branches: nextPatch.branches ?? currentNode.branches,
            updatedAt: new Date().toISOString(),
          });
        }
        touchedNodeIds.add(nodeId);
        updatedNodeIds.push(nodeId);
        summary.push(`Updated node ${shortId(nodeId)}.`);
        eventId = env.eventId;
        if (embeddedPatch.length > 0) {
          eventId = await deps.materializeCopilotEmbeddedFiles(
            input.sessionId,
            nodeId,
            embeddedPatch,
            nodesById,
            eventId,
          );
          summary.push(`Materialized ${embeddedPatch.length} file(s) into ${shortId(nodeId)}.`);
        }
        continue;
      }

      if (op.kind === 'remove_node') {
        const nodeId = resolveNodeRef(op.nodeId, refs);
        const env = await deps.graph.removeNode(input.sessionId, nodeId, HUMAN_ACTOR, requestId);
        if (env.payload.type !== 'node_removed') continue;
        mutated = true;
        nodeTypes.delete(nodeId);
        nodesById.delete(nodeId);
        for (const [edgeId, edge] of edgesById) {
          if (edge.source !== nodeId && edge.target !== nodeId) continue;
          edgeKeys.delete(edgeKey(edge));
          edgesById.delete(edgeId);
        }
        removedNodeIds.push(nodeId);
        summary.push(`Removed node ${shortId(nodeId)}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'add_edge') {
        const source = resolveNodeRef(op.source, refs);
        const target = resolveNodeRef(op.target, refs);
        // Idempotent add_edge: if the same (source, target, relation) triple
        // already exists in the current snapshot, silently skip this op
        // instead of throwing EDGE_DUPLICATE. Rolling back the entire turn
        // (including benign executions such as workflow_run) over a no-op
        // edge insertion is too aggressive — the LLM often re-emits
        // structural edges it believes to be missing.
        if (edgeKeys.has(edgeKey({ source, target, relation: op.relation }))) {
          summary.push(`Edge ${shortId(source)} -> ${shortId(target)} (${op.relation}) already exists; skipped.`);
          continue;
        }
        const env = await deps.graph.addEdge(input.sessionId, {
          source,
          target,
          relation: op.relation,
          direction: op.direction,
          creator: HUMAN_ACTOR,
          requestId,
          metadata: op.metadata,
        });
        if (env.payload.type !== 'edge_added') continue;
        mutated = true;
        edgesById.set(env.payload.edge.id, env.payload.edge);
        edgeKeys.add(edgeKey(env.payload.edge));
        createdEdgeIds.push(env.payload.edge.id);
        summary.push(`Connected ${shortId(env.payload.edge.source)} to ${shortId(env.payload.edge.target)}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'remove_edge') {
        const env = await deps.graph.removeEdge(input.sessionId, op.edgeId, HUMAN_ACTOR, requestId);
        if (env.payload.type !== 'edge_removed') continue;
        mutated = true;
        const removed = edgesById.get(op.edgeId);
        if (removed) {
          edgeKeys.delete(edgeKey(removed));
          edgesById.delete(op.edgeId);
        }
        removedEdgeIds.push(op.edgeId);
        summary.push(`Removed edge ${shortId(op.edgeId)}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'create_branch') {
        const env = await deps.graph.createBranch(input.sessionId, {
          name: op.name,
          color: op.color,
          fromNodeId: resolveNodeRef(op.fromNodeId, refs),
          actor: HUMAN_ACTOR,
          requestId,
        });
        if (env.payload.type !== 'branch_created') continue;
        mutated = true;
        createdBranchIds.push(env.payload.branch.id);
        summary.push(`Created branch ${env.payload.branch.name}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'merge_branch') {
        const env = await deps.graph.mergeBranch(input.sessionId, {
          sourceBranchId: op.sourceBranchId,
          targetBranchId: op.targetBranchId,
          actor: HUMAN_ACTOR,
          requestId,
        });
        if (env.payload.type !== 'branch_merged') continue;
        mutated = true;
        mergedBranchIds.push(op.sourceBranchId);
        summary.push(`Merged branch ${shortId(op.sourceBranchId)} into ${shortId(op.targetBranchId)}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'abandon_branch') {
        const env = await deps.graph.abandonBranch(input.sessionId, {
          branchId: op.branchId,
          actor: HUMAN_ACTOR,
          requestId,
        });
        if (env.payload.type !== 'branch_abandoned') continue;
        mutated = true;
        abandonedBranchIds.push(op.branchId);
        summary.push(`Abandoned branch ${shortId(op.branchId)}.`);
        eventId = env.eventId;
        continue;
      }

      if (op.kind === 'set_viewport') {
        eventId = await deps.graph.updateViewport(input.sessionId, op.viewport);
        mutated = true;
        viewportUpdated = true;
        summary.push('Updated viewport.');
      }
    }

    eventId = await deps.reconcileStructuredNodeRefs({
      sessionId: input.sessionId,
      threadId: input.threadId,
      messageId: input.messageId,
      refs,
      nodesById,
      nodeTypes,
      touchedNodeIds,
      createdNodeIds,
      updatedNodeIds,
      summary,
      eventId,
      fallback: agentTypeSchemaOrThrow(thread.agentType),
    });

    const repairNodeIds = new Set(
      scopeNodeIds(
        {
          nodes: [...nodesById.values()],
          edges: [...edgesById.values()],
        },
        readScope(thread.scope),
      ),
    );

    deps.validateStructuredNodes({
      nodeIds: repairNodeIds,
      nodesById,
    });

    eventId = await deps.materializeWorkflowEdges({
      sessionId: input.sessionId,
      threadId: input.threadId,
      messageId: input.messageId,
      nodeIds: repairNodeIds,
      nodesById,
      edgeKeys,
      createdEdgeIds,
      summary,
      eventId,
    });

    const apply = workflowCopilotApplySummarySchema.parse({
      checkpointId: checkpoint.id,
      summary,
      createdNodeIds,
      updatedNodeIds,
      removedNodeIds,
      createdEdgeIds,
      removedEdgeIds,
      createdBranchIds,
      mergedBranchIds,
      abandonedBranchIds,
      viewportUpdated,
      appliedAt: new Date().toISOString(),
      refMap:
        refs.size > 0
          ? Object.fromEntries([...refs.entries()].sort((a, b) => a[0].localeCompare(b[0])))
          : undefined,
    });

    await deps.prisma.workflowCopilotMessage.update({
      where: { id: input.messageId },
      data: { apply: apply as never },
    });

    await deps.activity.log({
      sessionId: input.sessionId,
      eventId,
      actorType: 'human',
      actorId: 'local-user',
      summary: summary.length > 0 ? summary.join(' ') : 'Applied workflow copilot changes.',
      summaryKey: 'activity.workflow_copilot_applied',
      summaryParams: { count: String(summary.length) },
      relatedNodeIds: [...createdNodeIds, ...updatedNodeIds, ...removedNodeIds],
    });

    const bundle = await deps.readBundle(input.sessionId, input.threadId);
    const nextMessage = bundle.messages.find((entry) => entry.id === input.messageId);
    if (!nextMessage) {
      throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
    }
    return {
      thread: bundle.thread,
      message: nextMessage,
      checkpoints: bundle.checkpoints,
    };
  } catch (error) {
    if (mutated) {
      await deps.graph.restoreWorkflow(
        input.sessionId,
        before,
        HUMAN_ACTOR,
        'workflow_copilot_apply_rollback',
      );
    }
    await deps.prisma.workflowCopilotCheckpoint.delete({ where: { id: checkpoint.id } });
    if (canRecoverApplyError(error)) {
      throw new BadRequestException(formatApplyError(error));
    }
    throw error;
  }
}
