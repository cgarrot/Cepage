import { BadRequestException } from '@nestjs/common';
import type {
  Creator,
  GraphNode,
  GraphSnapshot,
  WakeReason,
  WorkflowInputBound,
  WorkflowInputPart,
  WorkflowRunInputValue,
} from '@cepage/shared-core';
import type {
  WorkflowBoundInput,
  WorkflowInputAsset,
  WorkflowInputTemplateRow,
  WorkflowRunFile,
} from './agents.types';
import { GraphService } from '../graph/graph.service';
import {
  assertNoUnusedWorkflowFiles,
  buildInputSummary,
  buildWorkflowFileMap,
  buildWorkflowInputParts,
  buildWorkflowInputPartsFromSource,
  claimRef,
  normalizeInputKey,
  normalizeWorkflowInputParts,
  selectWorkflowInputSourceCandidates,
  trimText,
  validateWorkflowInput,
  workflowInputRelativePath,
  workflowInputTemplates,
} from './workflow-inputs.util';

type WorkflowInputMaterializerDeps = {
  graph: GraphService;
  writeInputAsset: (
    cwd: string,
    sessionId: string,
    nodeId: string,
    part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>,
    buffer: Buffer,
  ) => Promise<void>;
};

async function createInputWorkspaceFileNodes(
  deps: WorkflowInputMaterializerDeps,
  input: {
    sessionId: string;
    executionId?: string;
    runId: string;
    requestId?: string;
    wakeReason: WakeReason;
    key: string;
    boundNodeId: string;
    templateNodeId?: string;
    actor: Creator;
    anchor: GraphNode['position'];
    parts: WorkflowInputPart[];
  },
): Promise<string[]> {
  const nodeIds: string[] = [];
  const assetParts = input.parts.filter(
    (part): part is Extract<WorkflowInputPart, { type: 'file' | 'image' }> => part.type !== 'text',
  );
  for (const [index, part] of assetParts.entries()) {
    const env = await deps.graph.addNode(input.sessionId, {
      type: 'workspace_file',
      content: {
        title: part.file.name,
        relativePath: part.relativePath ?? part.file.name,
        role: 'input',
        origin: 'user_upload',
        kind: part.type === 'image' ? 'image' : part.file.kind,
        mimeType: part.file.mimeType,
        size: part.file.size,
        transferMode: part.transferMode ?? 'reference',
        excerpt: trimText(part.extractedText, 800),
        ...(input.templateNodeId ? { sourceTemplateNodeId: input.templateNodeId } : {}),
        ...(input.executionId ? { sourceExecutionId: input.executionId } : {}),
        sourceRunId: input.runId,
        ...(part.claimRef ? { claimRef: part.claimRef } : {}),
        status: 'available',
        lastSeenAt: new Date().toISOString(),
        change: 'added',
      } as GraphNode['content'],
      position: {
        x: input.anchor.x + 420,
        y: input.anchor.y + 160 + index * 140,
      },
      creator: input.actor,
      requestId: input.requestId ? `${input.requestId}:input-file:${input.key}:${index}` : undefined,
      runId: input.runId,
      wakeReason: input.wakeReason,
    });
    if (env.payload.type !== 'node_added') {
      throw new Error('workflow input file node');
    }
    nodeIds.push(env.payload.node.id);
    await deps.graph.addEdge(input.sessionId, {
      source: input.boundNodeId,
      target: env.payload.node.id,
      relation: 'contains',
      direction: 'source_to_target',
      creator: input.actor,
      requestId: input.requestId ? `${input.requestId}:input-file-edge:${input.key}:${index}` : undefined,
      metadata: { runId: input.runId, inputKey: input.key },
    });
  }
  return nodeIds;
}

async function createWorkflowBoundInputFromParts(
  deps: WorkflowInputMaterializerDeps,
  input: {
    sessionId: string;
    cwd: string;
    executionId?: string;
    runId: string;
    requestId?: string;
    wakeReason: WakeReason;
    key: string;
    parts: WorkflowInputPart[];
    assets?: WorkflowInputAsset[];
    sourceNodeIds?: string[];
    triggerNode: GraphNode | null;
    templates: WorkflowInputTemplateRow[];
    index: number;
    reason: 'workflow-run' | 'input-start';
  },
): Promise<WorkflowBoundInput> {
  const template = input.templates[0];
  const parts = normalizeWorkflowInputParts(template?.content, input.parts);
  validateWorkflowInput(template?.content, input.key, parts);
  const anchor = template?.node.position ?? input.triggerNode?.position ?? { x: 120, y: 120 };
  const content: WorkflowInputBound = {
    mode: 'bound',
    ...(input.key !== 'default' ? { key: input.key } : {}),
    label: template?.content.label ?? (input.key === 'default' ? 'Input' : input.key),
    ...(template?.content.accepts ? { accepts: template.content.accepts } : {}),
    ...(template?.content.multiple !== undefined ? { multiple: template.content.multiple } : {}),
    ...(template?.content.required !== undefined ? { required: template.content.required } : {}),
    ...(template?.content.instructions ? { instructions: template.content.instructions } : {}),
    runId: input.runId,
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(template?.node.id ? { templateNodeId: template.node.id } : {}),
    parts,
    summary: buildInputSummary(parts),
  };
  const actor: Creator = { type: 'system', reason: input.reason };
  const env = await deps.graph.addNode(input.sessionId, {
    type: 'input',
    content: content as GraphNode['content'],
    position: {
      x: anchor.x + 40,
      y: anchor.y + 160 + input.index * 28,
    },
    creator: actor,
    requestId: input.requestId ? `${input.requestId}:input:${input.key}` : undefined,
    runId: input.runId,
    wakeReason: input.wakeReason,
  });
  if (env.payload.type !== 'node_added') {
    throw new Error('workflow input node');
  }
  const nodeId = env.payload.node.id;
  for (const asset of input.assets ?? []) {
    await deps.writeInputAsset(input.cwd, input.sessionId, nodeId, asset.part, asset.buffer);
  }
  const workspaceFileNodeIds = await createInputWorkspaceFileNodes(deps, {
    sessionId: input.sessionId,
    executionId: input.executionId,
    runId: input.runId,
    requestId: input.requestId,
    wakeReason: input.wakeReason,
    key: input.key,
    boundNodeId: nodeId,
    templateNodeId: template?.node.id,
    actor,
    anchor,
    parts: (input.assets ?? []).map((asset) => asset.part),
  });
  if (input.templates.length > 0) {
    for (const item of input.templates) {
      await deps.graph.addEdge(input.sessionId, {
        source: item.node.id,
        target: nodeId,
        relation: 'derived_from',
        direction: 'source_to_target',
        creator: actor,
        requestId: input.requestId ? `${input.requestId}:input-edge:${input.key}` : undefined,
        metadata: { runId: input.runId, inputKey: input.key },
      });
    }
    for (const [index, sourceNodeId] of (input.sourceNodeIds ?? []).entries()) {
      await deps.graph.addEdge(input.sessionId, {
        source: sourceNodeId,
        target: nodeId,
        relation: 'derived_from',
        direction: 'source_to_target',
        creator: actor,
        requestId: input.requestId ? `${input.requestId}:input-source:${input.key}:${index}` : undefined,
        metadata: { runId: input.runId, inputKey: input.key },
      });
    }
  } else if (input.triggerNode) {
    await deps.graph.addEdge(input.sessionId, {
      source: nodeId,
      target: input.triggerNode.id,
      relation: 'feeds_into',
      direction: 'source_to_target',
      creator: actor,
      requestId: input.requestId ? `${input.requestId}:input-edge:${input.key}` : undefined,
      metadata: { runId: input.runId, inputKey: input.key },
    });
  }
  return { nodeId, parts, workspaceFileNodeIds };
}

export async function createWorkflowBoundInput(
  deps: WorkflowInputMaterializerDeps,
  input: {
    sessionId: string;
    cwd: string;
    executionId?: string;
    runId: string;
    requestId?: string;
    wakeReason: WakeReason;
    key: string;
    value: WorkflowRunInputValue;
    triggerNode: GraphNode | null;
    templates: WorkflowInputTemplateRow[];
    filesByField: Map<string, WorkflowRunFile[]>;
    index: number;
    reason: 'workflow-run' | 'input-start';
  },
): Promise<WorkflowBoundInput> {
  const built = buildWorkflowInputParts(input.value, input.filesByField);
  for (const part of built.parts) {
    if (part.type === 'text') continue;
    part.relativePath = workflowInputRelativePath(input.key, part);
    if ((part.transferMode ?? 'reference') === 'claim_check') {
      part.claimRef = claimRef(input.runId, part.relativePath);
    }
  }
  return createWorkflowBoundInputFromParts(deps, {
    sessionId: input.sessionId,
    cwd: input.cwd,
    executionId: input.executionId,
    runId: input.runId,
    requestId: input.requestId,
    wakeReason: input.wakeReason,
    key: input.key,
    parts: built.parts,
    assets: built.assets,
    triggerNode: input.triggerNode,
    templates: input.templates,
    index: input.index,
    reason: input.reason,
  });
}

export async function createWorkflowBoundInputFromSources(
  deps: WorkflowInputMaterializerDeps,
  input: {
    sessionId: string;
    cwd: string;
    executionId?: string;
    runId: string;
    requestId?: string;
    wakeReason: WakeReason;
    snapshot: GraphSnapshot;
    template: WorkflowInputTemplateRow;
    sourceNodeIds?: ReadonlyArray<string>;
    index: number;
    reason: 'workflow-run' | 'input-start';
  },
): Promise<WorkflowBoundInput | null> {
  const selected = selectWorkflowInputSourceCandidates({
    template: input.template,
    snapshot: input.snapshot,
    sourceNodeIds: input.sourceNodeIds,
  });
  if (selected.length === 0) {
    return null;
  }
  const parts = selected.flatMap((candidate) => buildWorkflowInputPartsFromSource(candidate));
  return createWorkflowBoundInputFromParts(deps, {
    sessionId: input.sessionId,
    cwd: input.cwd,
    executionId: input.executionId,
    runId: input.runId,
    requestId: input.requestId,
    wakeReason: input.wakeReason,
    key: input.template.key,
    parts,
    sourceNodeIds: selected.map((candidate) => candidate.node.id),
    triggerNode: input.template.node,
    templates: [input.template],
    index: input.index,
    reason: input.reason,
  });
}

export async function materializeWorkflowInputs(
  deps: WorkflowInputMaterializerDeps,
  input: {
    sessionId: string;
    cwd: string;
    executionId?: string;
    snapshot: GraphSnapshot;
    runId: string;
    request: {
      input?: WorkflowRunInputValue;
      inputs?: Record<string, WorkflowRunInputValue>;
      triggerNodeId?: string | null;
      requestId?: string;
      wakeReason?: WakeReason;
    };
    files: WorkflowRunFile[];
  },
): Promise<WorkflowBoundInput[]> {
  const values = new Map<string, WorkflowRunInputValue>();
  if (input.request.input) {
    values.set('default', input.request.input);
  }
  for (const [rawKey, value] of Object.entries(input.request.inputs ?? {})) {
    const key = normalizeInputKey(rawKey);
    if (values.has(key)) {
      throw new BadRequestException(`WORKFLOW_INPUT_KEY_DUPLICATE:${key}`);
    }
    values.set(key, value);
  }

  const templates = workflowInputTemplates(input.snapshot);
  for (const item of templates) {
    if (!item.content.required) continue;
    if (values.has(item.key)) continue;
    throw new BadRequestException(`WORKFLOW_INPUT_REQUIRED:${item.key}`);
  }

  if (values.size === 0) return [];

  const triggerNode = input.request.triggerNodeId
    ? input.snapshot.nodes.find((node) => node.id === input.request.triggerNodeId) ?? null
    : null;
  const filesByField = buildWorkflowFileMap(input.files);
  const created: WorkflowBoundInput[] = [];
  let index = 0;
  for (const [key, value] of values) {
    created.push(
      await createWorkflowBoundInput(deps, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        executionId: input.executionId,
        runId: input.runId,
        requestId: input.request.requestId,
        wakeReason: input.request.wakeReason ?? 'external_event',
        key,
        value,
        triggerNode,
        templates: templates.filter((item) => item.key === key),
        filesByField,
        index,
        reason: 'workflow-run',
      }),
    );
    index += 1;
  }

  assertNoUnusedWorkflowFiles(filesByField);
  return created;
}
