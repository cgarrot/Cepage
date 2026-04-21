import type { GraphNode } from '@cepage/shared-core';
import {
  collectManagedFlowStructuralEdges,
  readWorkflowArtifactContent,
  readWorkflowInputContent,
  readWorkflowLoopContent,
  readWorkflowManagedFlowContent,
  readWorkflowSubgraphContent,
} from '@cepage/shared-core';
import { readRecord, readString } from './workflow-copilot-normalize';
import type { StructuralEdge } from './workflow-copilot.types';

export function edgeKey(input: { source: string; target: string; relation: string }): string {
  return `${input.source}:${input.target}:${input.relation}`;
}

function collectInputBindingKeys(value: unknown): string[] {
  const template =
    typeof value === 'string'
      ? value
      : readString(readRecord(value)?.template)?.trim();
  if (!template) return [];
  const keys = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*(?:controller|inputs)\.([A-Za-z0-9_]+)(?:\.(?:text|value))?\s*\}\}/g)) {
    const key = match[1]?.trim();
    if (key) keys.add(key);
  }
  return [...keys];
}

function collectTemplateInputNodeIds(nodesById: Map<string, GraphNode>, key: string): string[] {
  return [...nodesById.values()]
    .flatMap((node) => {
      if (node.type !== 'input') return [];
      const content = readWorkflowInputContent(node.content);
      return content?.mode === 'template' && readString(content.key)?.trim() === key ? [node.id] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

function collectArtifactNodeIds(nodesById: Map<string, GraphNode>, paths: readonly string[]): string[] {
  const expected = new Set(paths.map((path) => path.trim()).filter(Boolean));
  if (expected.size === 0) return [];
  return [...nodesById.values()]
    .flatMap((node) => {
      if (node.type !== 'workspace_file') return [];
      const content = readWorkflowArtifactContent(node.content);
      const path = content?.relativePath.trim();
      return path && expected.has(path) ? [node.id] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

export function collectWorkflowStructuralEdges(node: GraphNode, nodesById: Map<string, GraphNode>): StructuralEdge[] {
  const next: StructuralEdge[] = [];
  const push = (edge: StructuralEdge) => {
    if (edge.source === edge.target) return;
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) return;
    next.push(edge);
  };

  const loop = node.type === 'loop' ? readWorkflowLoopContent(node.content) : null;
  if (loop) {
    if (loop.source.kind === 'input_parts') {
      push({
        source: loop.source.templateNodeId,
        target: node.id,
        relation: 'feeds_into',
      });
      if (loop.source.boundNodeId) {
        push({
          source: loop.source.boundNodeId,
          target: node.id,
          relation: 'feeds_into',
        });
      }
    }
    if (loop.source.kind === 'json_file' && loop.source.fileNodeId) {
      push({
        source: loop.source.fileNodeId,
        target: node.id,
        relation: 'feeds_into',
      });
    }
    push({
      source: node.id,
      target: loop.bodyNodeId,
      relation: 'contains',
    });
    if (loop.validatorNodeId) {
      push({
        source: loop.validatorNodeId,
        target: node.id,
        relation: 'validates',
      });
    }
  }

  const subgraph = node.type === 'sub_graph' ? readWorkflowSubgraphContent(node.content) : null;
  if (subgraph) {
    const keys = new Set(Object.values(subgraph.inputMap).flatMap(collectInputBindingKeys));
    for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
      for (const templateNodeId of collectTemplateInputNodeIds(nodesById, key)) {
        push({
          source: templateNodeId,
          target: node.id,
          relation: 'feeds_into',
        });
      }
    }
    if (subgraph.entryNodeId) {
      push({
        source: node.id,
        target: subgraph.entryNodeId,
        relation: 'contains',
      });
      for (const outputNodeId of collectArtifactNodeIds(nodesById, subgraph.expectedOutputs ?? [])) {
        push({
          source: subgraph.entryNodeId,
          target: outputNodeId,
          relation: 'produces',
        });
      }
    }
  }

  const flow = node.type === 'managed_flow' ? readWorkflowManagedFlowContent(node.content) : null;
  if (flow) {
    for (const edge of collectManagedFlowStructuralEdges(node.id, flow)) {
      push(edge);
    }
    for (const phase of flow.phases) {
      if (
        phase.kind !== 'agent_phase'
        && phase.kind !== 'runtime_verify_phase'
        && phase.kind !== 'validation_phase'
      ) {
        continue;
      }
      const outputNodeIds = collectArtifactNodeIds(nodesById, phase.expectedOutputs);
      if (phase.kind === 'agent_phase' || phase.kind === 'runtime_verify_phase') {
        for (const outputNodeId of outputNodeIds) {
          push({
            source: phase.nodeId,
            target: outputNodeId,
            relation: 'produces',
          });
        }
        continue;
      }
      for (const outputNodeId of outputNodeIds) {
        push({
          source: phase.validatorNodeId,
          target: outputNodeId,
          relation: 'produces',
        });
      }
    }
  }

  const seen = new Set<string>();
  return next
    .filter((edge) => {
      const key = edgeKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.relation.localeCompare(b.relation),
    );
}
