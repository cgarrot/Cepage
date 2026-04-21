import type { Edge, Node as FlowNode } from '@xyflow/react';
import type { GraphNode } from '@cepage/shared-core';

export function readRawNode(node: { data: unknown }): GraphNode {
  return (node.data as { raw: GraphNode }).raw;
}

export function mergeFlowNodes(current: FlowNode[], next: FlowNode[]): FlowNode[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  return next.map((node) => {
    const prev = byId.get(node.id);
    if (!prev) {
      return node;
    }
    return {
      ...prev,
      ...node,
      data: node.data,
      position: node.position,
      style: {
        ...(prev.style ?? {}),
        ...(node.style ?? {}),
      },
    };
  });
}

export function mergeFlowEdges(current: Edge[], next: Edge[]): Edge[] {
  const byId = new Map(current.map((edge) => [edge.id, edge]));
  return next.map((edge) => {
    const prev = byId.get(edge.id);
    if (!prev) {
      return edge;
    }
    return {
      ...prev,
      ...edge,
    };
  });
}
