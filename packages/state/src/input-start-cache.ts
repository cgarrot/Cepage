import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode } from '@cepage/shared-core';
import { readInputTemplateStartState, type InputTemplateStartState } from './workflow-input-start.js';

function readRawFlowNode(node: Node): GraphNode {
  return (node.data as { raw: GraphNode }).raw;
}

function toGraphEdgeLinks(edges: readonly Edge[]): Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> {
  return edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relation: (typeof edge.label === 'string' ? edge.label : 'references') as GraphEdge['relation'],
  }));
}

function readGraphNodes(nodes: readonly Node[]): GraphNode[] {
  return nodes.map(readRawFlowNode);
}

export function createInputStartStateCache() {
  let lastNodes: readonly Node[] | null = null;
  let lastEdges: readonly Edge[] | null = null;
  let graphNodes: GraphNode[] = [];
  let links: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> = [];
  let byNodeId = new Map<string, InputTemplateStartState | null>();

  return (nodeId: string, nodes: readonly Node[], edges: readonly Edge[]): InputTemplateStartState | null => {
    if (nodes !== lastNodes) {
      lastNodes = nodes;
      graphNodes = readGraphNodes(nodes);
      byNodeId = new Map();
    }
    if (edges !== lastEdges) {
      lastEdges = edges;
      links = toGraphEdgeLinks(edges);
      byNodeId = new Map();
    }
    if (byNodeId.has(nodeId)) {
      return byNodeId.get(nodeId) ?? null;
    }
    const next = readInputTemplateStartState(nodeId, graphNodes, links);
    byNodeId.set(nodeId, next);
    return next;
  };
}
