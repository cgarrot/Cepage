import { NotFoundException } from '@nestjs/common';
import { getEnv } from '@cepage/config';
import {
  readNodeLockedSelection,
  type AgentModelRef,
  type AgentRerunRequest,
  type AgentType,
  type GraphNode,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { GraphService } from '../graph/graph.service';
import { getSpawnPositions } from './spawn-layout';
import type { RunState } from './agents.types';
import { readModel, readRunModel, readStringArray } from './agents-request-parse';
import { readString } from './workflow-inputs.util';

export function findOutputNode(
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string; relation: string }>,
  runId: string,
  rootNodeId: string,
): GraphNode | null {
  const outputId = edges.find((edge) => edge.relation === 'produces' && edge.source === rootNodeId)?.target;
  if (outputId) {
    const outputNode = nodes.find((node) => node.id === outputId && node.type === 'agent_output');
    if (outputNode) {
      return outputNode;
    }
  }
  return (
    nodes.find(
      (node) =>
        node.type === 'agent_output' &&
        node.creator.type === 'agent' &&
        node.creator.agentId === runId,
    ) ?? null
  );
}

export function resolveRerunSelection(
  body: AgentRerunRequest,
  state: RunState,
): { type: AgentType; model?: AgentModelRef } {
  const locked = readNodeLockedSelection(state.rootNode.content);
  const content = state.rootNode.content as { agentType?: unknown; model?: unknown };
  const currentType = (locked?.type ?? readString(content.agentType) ?? state.run.agentType) as AgentType;
  const currentModel = locked?.model ?? readModel(content.model) ?? readRunModel(state.run);
  const type = (body.type ?? currentType) as AgentType;
  const model = body.model ?? (body.type && body.type !== currentType ? undefined : currentModel);
  return model ? { type, model } : { type };
}

export async function loadRunState(
  prisma: PrismaService,
  graph: GraphService,
  sessionId: string,
  agentRunId: string,
): Promise<RunState> {
  const run = await prisma.agentRun.findFirst({
    where: { id: agentRunId, sessionId },
    select: {
      id: true,
      sessionId: true,
      executionId: true,
      requestId: true,
      agentType: true,
      role: true,
      status: true,
      wakeReason: true,
      runtime: true,
      seedNodeIds: true,
      rootNodeId: true,
      triggerNodeId: true,
      stepNodeId: true,
      parentRunId: true,
      modelProviderId: true,
      modelId: true,
      externalSessionId: true,
    },
  });
  if (!run) {
    throw new NotFoundException('RUN_NOT_FOUND');
  }
  if (!run.rootNodeId) {
    throw new NotFoundException('RUN_ROOT_NODE_NOT_FOUND');
  }
  const snapshot = await graph.loadSnapshot(sessionId);
  const rootNode = snapshot.nodes.find((node) => node.id === run.rootNodeId);
  if (!rootNode) {
    throw new NotFoundException('RUN_ROOT_NODE_NOT_FOUND');
  }
  const outputNode = findOutputNode(snapshot.nodes, snapshot.edges, run.id, run.rootNodeId);
  const content = rootNode.content as {
    config?: {
      contextNodeIds?: unknown;
      triggerNodeId?: unknown;
      workingDirectory?: unknown;
    };
  };
  const triggerNodeId =
    readString(content.config?.triggerNodeId) ??
    snapshot.edges.find((edge) => edge.relation === 'spawns' && edge.target === rootNode.id)?.source ??
    null;
  const triggerNode =
    triggerNodeId
      ? snapshot.nodes.find((node) => node.id === triggerNodeId) ?? null
      : null;
  const seedNodeIds = readStringArray(content.config?.contextNodeIds);
  const cwd =
    readString(content.config?.workingDirectory) ??
    readString((run.runtime as { cwd?: unknown } | undefined)?.cwd) ??
    getEnv().AGENT_WORKING_DIRECTORY;
  return {
    run,
    snapshot,
    rootNode,
    outputNode,
    seedNodeIds: seedNodeIds.length > 0 ? seedNodeIds : readStringArray(run.seedNodeIds),
    triggerNode,
    cwd,
    errorPosition: triggerNode
      ? getSpawnPositions(triggerNode.position).error
      : {
          x: rootNode.position.x,
          y: rootNode.position.y + 200,
        },
  };
}

export async function clearRunMessages(
  graph: GraphService,
  sessionId: string,
  runId: string,
): Promise<number> {
  const snapshot = await graph.loadSnapshot(sessionId);
  let eventId = 0;
  for (const node of snapshot.nodes) {
    if (node.type !== 'system_message') {
      continue;
    }
    const owner = readString((node.metadata as { agentRunId?: unknown }).agentRunId);
    if (owner !== runId) {
      continue;
    }
    const env = await graph.removeNode(sessionId, node.id, {
      type: 'system',
      reason: 'agent-rerun',
    });
    eventId = env.eventId;
  }
  return eventId;
}
