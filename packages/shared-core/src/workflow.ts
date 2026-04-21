import { z } from 'zod';
import {
  creatorSchema,
  edgeDirectionSchema,
  edgeRelationSchema,
  nodeStatusSchema,
  nodeTypeSchema,
  type Branch,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type SessionId,
} from './graph';
import { agentTypeSchema } from './agent';
import {
  readWorkflowDecisionValidatorContent,
  readWorkflowLoopContent,
  readWorkflowManagedFlowContent,
  readWorkflowSubgraphContent,
} from './workflow-control';
import { readConnectorTargetContent } from './connector';
import { readWorkflowArtifactContent } from './workflow-artifact';
import { readWorkflowInputContent } from './workflow-input';
import { nodeAgentSelectionSchema } from './node-agent-selection';

const textSchema = z.string().min(1);
const recordSchema = z.record(z.string(), z.unknown());
const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
const dimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
});
const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const workflowNodeSchema: z.ZodType<GraphNode> = z.object({
  id: textSchema,
  type: nodeTypeSchema,
  createdAt: textSchema,
  updatedAt: textSchema,
  content: recordSchema,
  creator: creatorSchema,
  position: positionSchema,
  dimensions: dimensionsSchema,
  metadata: recordSchema,
  status: nodeStatusSchema,
  branches: z.array(textSchema),
});

export const workflowEdgeSchema: z.ZodType<GraphEdge> = z.object({
  id: textSchema,
  source: textSchema,
  target: textSchema,
  relation: edgeRelationSchema,
  direction: edgeDirectionSchema,
  strength: z.number(),
  createdAt: textSchema,
  creator: creatorSchema,
  metadata: recordSchema,
});

export const workflowBranchSchema: z.ZodType<Branch> = z.object({
  id: textSchema,
  name: textSchema,
  color: textSchema,
  createdAt: textSchema,
  createdBy: creatorSchema,
  headNodeId: textSchema,
  nodeIds: z.array(textSchema),
  parentBranchId: textSchema.optional(),
  forkedFromNodeId: textSchema.optional(),
  status: z.enum(['active', 'merged', 'abandoned']),
  mergedIntoBranchId: textSchema.optional(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  branches: z.array(workflowBranchSchema),
  viewport: viewportSchema,
});

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const workflowTransferV1Schema = z.object({
  kind: z.literal('cepage.workflow'),
  version: z.literal(1),
  exportedAt: textSchema,
  graph: workflowGraphSchema,
});

export type WorkflowTransferV1 = z.infer<typeof workflowTransferV1Schema>;

export const workflowTransferV2Schema = z.object({
  kind: z.literal('cepage.workflow'),
  version: z.literal(2),
  exportedAt: textSchema,
  graph: workflowGraphSchema,
});

export const workflowTransferSchema = z.union([workflowTransferV1Schema, workflowTransferV2Schema]);

export type WorkflowTransferV2 = z.infer<typeof workflowTransferV2Schema>;
export type WorkflowTransfer = WorkflowTransferV1 | WorkflowTransferV2;

export type WorkflowParseResult =
  | { success: true; data: WorkflowTransfer }
  | { success: false; errors: string[] };

export function workflowFromSnapshot(snap: GraphSnapshot): WorkflowTransfer {
  const graph = normalizeWorkflowGraph({
    nodes: snap.nodes,
    edges: snap.edges,
    branches: snap.branches,
  });
  const version = inferWorkflowTransferVersion(graph.nodes);
  return {
    kind: 'cepage.workflow',
    version,
    exportedAt: new Date().toISOString(),
    graph: {
      nodes: graph.nodes,
      edges: graph.edges,
      branches: graph.branches,
      viewport: { ...snap.viewport },
    },
  };
}

export function workflowToSnapshot(
  sessionId: SessionId,
  flow: WorkflowTransfer,
  lastEventId: number = 0,
  createdAt: string = new Date().toISOString(),
): GraphSnapshot {
  const graph = normalizeWorkflowGraph(flow.graph);
  return {
    version: 1,
    id: sessionId,
    createdAt,
    lastEventId,
    nodes: graph.nodes,
    edges: graph.edges,
    branches: graph.branches,
    viewport: { ...flow.graph.viewport },
  };
}

export function rekeyWorkflowTransfer(flow: WorkflowTransfer): WorkflowTransfer {
  const ids = {
    node: new Map(flow.graph.nodes.map((node) => [node.id, makeId()])),
    edge: new Map(flow.graph.edges.map((edge) => [edge.id, makeId()])),
    branch: new Map(flow.graph.branches.map((branch) => [branch.id, makeId()])),
  };
  return {
    ...flow,
    graph: {
      nodes: flow.graph.nodes.map((node) => ({
        ...node,
        id: mapId(ids.node, node.id),
        content: remapValue(node.content, ids) as GraphNode['content'],
        metadata: remapValue(node.metadata, ids) as GraphNode['metadata'],
        branches: node.branches.map((branchId) => mapId(ids.branch, branchId)),
      })),
      edges: flow.graph.edges.map((edge) => ({
        ...edge,
        id: mapId(ids.edge, edge.id),
        source: mapId(ids.node, edge.source),
        target: mapId(ids.node, edge.target),
        metadata: remapValue(edge.metadata, ids) as GraphEdge['metadata'],
      })),
      branches: flow.graph.branches.map((branch) => ({
        ...branch,
        id: mapId(ids.branch, branch.id),
        headNodeId: mapId(ids.node, branch.headNodeId),
        nodeIds: branch.nodeIds.map((nodeId) => mapId(ids.node, nodeId)),
        parentBranchId: mapOpt(ids.branch, branch.parentBranchId),
        forkedFromNodeId: mapOpt(ids.node, branch.forkedFromNodeId),
        mergedIntoBranchId: mapOpt(ids.branch, branch.mergedIntoBranchId),
      })),
      viewport: { ...flow.graph.viewport },
    },
  };
}

export function parseWorkflowTransfer(value: unknown): WorkflowParseResult {
  const parsed = workflowTransferSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      }),
    };
  }
  const errors = validateWorkflowTransfer(parsed.data);
  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data: parsed.data };
}

export function validateWorkflowTransfer(flow: WorkflowTransfer): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const branchIds = new Set<string>();

  // The transfer stores cross references in several places, so validate ids first,
  // then validate references after the sets are complete.
  for (const node of flow.graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
      continue;
    }
    nodeIds.add(node.id);
  }

  for (const edge of flow.graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge id: ${edge.id}`);
      continue;
    }
    edgeIds.add(edge.id);
  }

  for (const branch of flow.graph.branches) {
    if (branchIds.has(branch.id)) {
      errors.push(`Duplicate branch id: ${branch.id}`);
      continue;
    }
    branchIds.add(branch.id);
  }

  for (const edge of flow.graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references missing source node: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references missing target node: ${edge.target}`);
    }
  }

  for (const node of flow.graph.nodes) {
    for (const branchId of node.branches) {
      if (!branchIds.has(branchId)) {
        errors.push(`Node ${node.id} references missing branch: ${branchId}`);
      }
    }
  }

  for (const branch of flow.graph.branches) {
    if (!nodeIds.has(branch.headNodeId)) {
      errors.push(`Branch ${branch.id} references missing head node: ${branch.headNodeId}`);
    }
    if (!branch.nodeIds.includes(branch.headNodeId)) {
      errors.push(`Branch ${branch.id} head node must also exist in nodeIds`);
    }
    if (branch.parentBranchId && !branchIds.has(branch.parentBranchId)) {
      errors.push(`Branch ${branch.id} references missing parent branch: ${branch.parentBranchId}`);
    }
    if (branch.mergedIntoBranchId && !branchIds.has(branch.mergedIntoBranchId)) {
      errors.push(`Branch ${branch.id} references missing merged target branch: ${branch.mergedIntoBranchId}`);
    }
    for (const nodeId of branch.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        errors.push(`Branch ${branch.id} references missing node: ${nodeId}`);
      }
    }
  }

  for (const node of flow.graph.nodes) {
    errors.push(...validateWorkflowNodeContent(node, flow.version));
    errors.push(...validateWorkflowNodeRefs(node, nodeIds));
  }

  return errors;
}

function validateWorkflowNodeContent(node: GraphNode, version: WorkflowTransfer['version']): string[] {
  const errors: string[] = [];
  const record =
    node.content && typeof node.content === 'object' && !Array.isArray(node.content)
      ? (node.content as Record<string, unknown>)
      : null;
  const agentSelection =
    record?.agentSelection !== undefined ? nodeAgentSelectionSchema.safeParse(record.agentSelection) : null;
  if (record?.agentSelection !== undefined && !agentSelection?.success) {
    errors.push(`Node ${node.id} has invalid agentSelection metadata`);
  }
  if (node.type === 'agent_step' || node.type === 'agent_spawn') {
    const useLegacy = !agentSelection?.success;
    const parsedType = agentTypeSchema.safeParse(record?.agentType);
    if (useLegacy && !parsedType.success) {
      errors.push(`Node ${node.id} has unsupported agentType: ${String(record?.agentType ?? '') || '(missing)'}`);
    }
    if (useLegacy && record?.model !== undefined) {
      if (!record.model || typeof record.model !== 'object' || Array.isArray(record.model)) {
        errors.push(`Node ${node.id} has structurally invalid model metadata`);
        return errors;
      }
      const providerID = readString((record.model as { providerID?: unknown }).providerID)?.trim();
      const modelID = readString((record.model as { modelID?: unknown }).modelID)?.trim();
      if (!providerID || !modelID) {
        errors.push(`Node ${node.id} has an empty or incomplete model reference`);
      }
    }
  }

  if (version === 1 && node.type === 'loop') {
    errors.push(`Node ${node.id} uses loop content that requires workflow export version 2`);
    return errors;
  }

  if (node.type === 'loop') {
    if (!readWorkflowLoopContent(node.content)) {
      errors.push(`Node ${node.id} has invalid loop content`);
    }
  }

  if (version === 1 && node.type === 'connector_target') {
    errors.push(`Node ${node.id} uses connector content that requires workflow export version 2`);
    return errors;
  }

  if (node.type === 'connector_target' && version === 2) {
    if (!readConnectorTargetContent(node.content)) {
      errors.push(`Node ${node.id} has invalid connector target content`);
    }
  }

  if (version === 1 && node.type === 'managed_flow') {
    errors.push(`Node ${node.id} uses managed flow content that requires workflow export version 2`);
    return errors;
  }

  if (node.type === 'managed_flow' && version === 2) {
    if (!readWorkflowManagedFlowContent(node.content)) {
      errors.push(`Node ${node.id} has invalid managed flow content`);
    }
  }

  if (version === 1 && node.type === 'sub_graph' && readWorkflowSubgraphContent(node.content)) {
    errors.push(`Node ${node.id} uses executable sub_graph content that requires workflow export version 2`);
  }
  if (node.type === 'sub_graph' && version === 2) {
    const parsed = readWorkflowSubgraphContent(node.content);
    if (!parsed) {
      errors.push(`Node ${node.id} has invalid sub_graph content`);
    }
  }

  const decision = readWorkflowDecisionValidatorContent(node.content);
  if (version === 1 && decision) {
    errors.push(`Node ${node.id} uses validator decision content that requires workflow export version 2`);
  }
  const decisionContent =
    node.content && typeof node.content === 'object' && !Array.isArray(node.content)
      ? (node.content as { mode?: unknown })
      : null;
  if (node.type === 'decision' && version === 2 && decisionContent) {
    const rawMode = decisionContent.mode;
    if (rawMode === 'workspace_validator' && !decision) {
      errors.push(`Node ${node.id} has invalid decision validator content`);
    }
  }

  return errors;
}

function validateWorkflowNodeRefs(node: GraphNode, nodeIds: Set<string>): string[] {
  const errors: string[] = [];
  const loop = readWorkflowLoopContent(node.content);
  if (loop) {
    if (!nodeIds.has(loop.bodyNodeId)) {
      errors.push(`Node ${node.id} loop body references missing node: ${loop.bodyNodeId}`);
    }
    if (loop.validatorNodeId && !nodeIds.has(loop.validatorNodeId)) {
      errors.push(`Node ${node.id} loop validator references missing node: ${loop.validatorNodeId}`);
    }
    if (loop.source.kind === 'input_parts' && !nodeIds.has(loop.source.templateNodeId)) {
      errors.push(`Node ${node.id} loop source references missing template node: ${loop.source.templateNodeId}`);
    }
    if (loop.source.kind === 'input_parts' && loop.source.boundNodeId && !nodeIds.has(loop.source.boundNodeId)) {
      errors.push(`Node ${node.id} loop source references missing bound input node: ${loop.source.boundNodeId}`);
    }
    if (loop.source.kind === 'json_file' && loop.source.fileNodeId && !nodeIds.has(loop.source.fileNodeId)) {
      errors.push(`Node ${node.id} loop source references missing file node: ${loop.source.fileNodeId}`);
    }
  }
  const flow = readWorkflowManagedFlowContent(node.content);
  if (flow) {
    for (const phase of flow.phases) {
      if ('nodeId' in phase && phase.nodeId && !nodeIds.has(phase.nodeId)) {
        errors.push(`Node ${node.id} flow phase references missing node: ${phase.nodeId}`);
      }
      if (phase.kind === 'validation_phase' && !nodeIds.has(phase.validatorNodeId)) {
        errors.push(`Node ${node.id} validation phase references missing node: ${phase.validatorNodeId}`);
      }
      if (phase.kind === 'derive_input_phase') {
        if (!nodeIds.has(phase.sourceNodeId)) {
          errors.push(`Node ${node.id} derive phase references missing source node: ${phase.sourceNodeId}`);
        }
        if (!nodeIds.has(phase.targetTemplateNodeId)) {
          errors.push(`Node ${node.id} derive phase references missing template node: ${phase.targetTemplateNodeId}`);
        }
        if (phase.restartPhaseId && !flow.phases.some((entry) => entry.id === phase.restartPhaseId)) {
          errors.push(`Node ${node.id} derive phase restart target is missing: ${phase.restartPhaseId}`);
        }
      }
      if ('validatorNodeId' in phase && phase.validatorNodeId && !nodeIds.has(phase.validatorNodeId)) {
        errors.push(`Node ${node.id} flow phase references missing validator node: ${phase.validatorNodeId}`);
      }
    }
    if (flow.entryPhaseId && !flow.phases.some((phase) => phase.id === flow.entryPhaseId)) {
      errors.push(`Node ${node.id} flow entry references missing phase: ${flow.entryPhaseId}`);
    }
  }
  return errors;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function makeId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapId(ids: Map<string, string>, value: string): string {
  return ids.get(value) ?? value;
}

function mapOpt(ids: Map<string, string>, value?: string): string | undefined {
  return value ? mapId(ids, value) : undefined;
}

function remapValue(
  value: unknown,
  ids: {
    node: Map<string, string>;
    edge: Map<string, string>;
    branch: Map<string, string>;
  },
  key?: string,
): unknown {
  if (typeof value === 'string') {
    if (key && NODE_REF_KEYS.has(key)) return mapId(ids.node, value);
    if (key && EDGE_REF_KEYS.has(key)) return mapId(ids.edge, value);
    if (key && BRANCH_REF_KEYS.has(key)) return mapId(ids.branch, value);
    return value;
  }

  if (Array.isArray(value)) {
    if (key && NODE_REF_LIST_KEYS.has(key)) {
      return value.map((entry) => (typeof entry === 'string' ? mapId(ids.node, entry) : entry));
    }
    if (key && EDGE_REF_LIST_KEYS.has(key)) {
      return value.map((entry) => (typeof entry === 'string' ? mapId(ids.edge, entry) : entry));
    }
    if (key && BRANCH_REF_LIST_KEYS.has(key)) {
      return value.map((entry) => (typeof entry === 'string' ? mapId(ids.branch, entry) : entry));
    }
    return value.map((entry) => remapValue(entry, ids));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    next[childKey] = remapValue(childValue, ids, childKey);
  }
  return next;
}

const NODE_REF_KEYS = new Set([
  'bodyNodeId',
  'boundNodeId',
  'entryNodeId',
  'fileNodeId',
  'headNodeId',
  'ownerNodeId',
  'nodeId',
  'outputNodeId',
  'rootNodeId',
  'runNodeId',
  'sourceNodeId',
  'sourceTemplateNodeId',
  'stepNodeId',
  'templateNodeId',
  'targetTemplateNodeId',
  'targetNodeId',
  'triggerNodeId',
  'validatorNodeId',
]);

const NODE_REF_LIST_KEYS = new Set(['contextNodeIds', 'nodeIds', 'seedNodeIds']);
const EDGE_REF_KEYS = new Set(['edgeId']);
const EDGE_REF_LIST_KEYS = new Set(['affectedEdges']);
const BRANCH_REF_KEYS = new Set(['branchId', 'mergedIntoBranchId', 'parentBranchId']);
const BRANCH_REF_LIST_KEYS = new Set(['branchIds', 'branches']);

function normalizeWorkflowGraph(graph: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  branches: Branch[];
}): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  branches: Branch[];
} {
  const nodes = graph.nodes
    .filter(isTemplateNode)
    .map((node) => sanitizeTemplateNode(structuredClone(node)));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => structuredClone(edge));
  const branches = graph.branches
    .map((branch) => {
      const nodeIdsInBranch = branch.nodeIds.filter((nodeId) => nodeIds.has(nodeId));
      if (nodeIdsInBranch.length === 0) {
        return null;
      }
      const headNodeId = nodeIds.has(branch.headNodeId) ? branch.headNodeId : nodeIdsInBranch[0];
      if (!headNodeId) {
        return null;
      }
      return {
        ...structuredClone(branch),
        headNodeId,
        nodeIds: nodeIdsInBranch,
      };
    })
    .filter((branch): branch is Branch => branch !== null);
  return { nodes, edges, branches };
}

function isTemplateNode(node: GraphNode): boolean {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null;
  if (metadata?.runtimeOwned) {
    return false;
  }
  if (
    node.type === 'agent_output'
    || node.type === 'agent_status'
    || node.type === 'runtime_run'
    || node.type === 'connector_run'
  ) {
    return false;
  }
  if (node.type === 'input') {
    return readWorkflowInputContent(node.content)?.mode !== 'bound';
  }
  if (node.type === 'agent_spawn') {
    return node.creator.type !== 'agent';
  }
  return true;
}

function sanitizeTemplateNode(node: GraphNode): GraphNode {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? { ...node.metadata }
      : {};
  delete metadata.artifacts;
  delete metadata.controller;
  delete metadata.controllerState;
  delete metadata.flow;
  if (node.type === 'agent_spawn') {
    return {
      ...node,
      type: 'agent_step',
      metadata,
    };
  }
  if (node.type === 'workspace_file') {
    const artifact = readWorkflowArtifactContent(node.content);
    if (!artifact || artifact.role !== 'output') {
      return {
        ...node,
        metadata,
      };
    }
    const content: GraphNode['content'] = {
      title: artifact.title,
      relativePath: artifact.relativePath,
      ...(artifact.pathMode ? { pathMode: artifact.pathMode } : {}),
      role: artifact.role,
      origin: artifact.origin,
      kind: artifact.kind,
      ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      ...(artifact.size != null ? { size: artifact.size } : {}),
      ...(artifact.transferMode ? { transferMode: artifact.transferMode } : {}),
      ...(artifact.summary ? { summary: artifact.summary } : {}),
      ...(artifact.sourceTemplateNodeId ? { sourceTemplateNodeId: artifact.sourceTemplateNodeId } : {}),
      status: 'declared',
    };
    return {
      ...node,
      content,
      metadata,
    };
  }
  return {
    ...node,
    metadata,
  };
}

function inferWorkflowTransferVersion(nodes: GraphNode[]): 1 | 2 {
  for (const node of nodes) {
    if (node.type === 'loop') {
      return 2;
    }
    if (node.type === 'connector_target') {
      return 2;
    }
    if (node.type === 'managed_flow' && readWorkflowManagedFlowContent(node.content)) {
      return 2;
    }
    if (node.type === 'sub_graph' && readWorkflowSubgraphContent(node.content)) {
      return 2;
    }
    if (node.type === 'decision' && readWorkflowDecisionValidatorContent(node.content)) {
      return 2;
    }
  }
  return 1;
}
