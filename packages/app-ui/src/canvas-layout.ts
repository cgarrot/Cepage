import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 180;
const MARGIN = 48;
const NODE_SEP = 72;
const RANK_SEP = 120;
const EDGE_SEP = 24;

type LayoutSize = {
  width: number;
  height: number;
};

export type CanvasLayoutChange = {
  id: string;
  position: { x: number; y: number };
};

function readSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pickSize(values: ReadonlyArray<unknown>, fallback: number): number {
  return values.map(readSize).find((value) => value !== null) ?? fallback;
}

function readNodeSize(node: Node): LayoutSize {
  return {
    width: pickSize([node.measured?.width, node.width, node.style?.width], DEFAULT_WIDTH),
    height: pickSize(
      [node.measured?.height, node.height, node.style?.height, node.style?.minHeight],
      DEFAULT_HEIGHT,
    ),
  };
}

function compareNodes(a: Node, b: Node): number {
  if (a.position.y !== b.position.y) {
    return a.position.y - b.position.y;
  }
  if (a.position.x !== b.position.x) {
    return a.position.x - b.position.x;
  }
  return a.id.localeCompare(b.id);
}

function compareEdges(a: Edge, b: Edge): number {
  if (a.source !== b.source) {
    return a.source.localeCompare(b.source);
  }
  if (a.target !== b.target) {
    return a.target.localeCompare(b.target);
  }
  return a.id.localeCompare(b.id);
}

export function arrangeCanvasNodes(
  inputNodes: ReadonlyArray<Node>,
  inputEdges: ReadonlyArray<Edge>,
): CanvasLayoutChange[] {
  const nodes = [...inputNodes].filter((node) => !node.hidden).sort(compareNodes);
  if (nodes.length < 2) {
    return [];
  }

  const sizes = new Map(nodes.map((node) => [node.id, readNodeSize(node)]));
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: 'TB',
    align: 'UL',
    marginx: MARGIN,
    marginy: MARGIN,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const size = sizes.get(node.id);
    if (!size) {
      return;
    }
    graph.setNode(node.id, size);
  });

  [...inputEdges]
    .sort(compareEdges)
    .filter((edge) => sizes.has(edge.source) && sizes.has(edge.target))
    .forEach((edge) => {
      graph.setEdge({ v: edge.source, w: edge.target, name: edge.id }, {});
    });

  dagre.layout(graph);

  return nodes
    .map((node) => {
      const size = sizes.get(node.id);
      const layout = graph.node(node.id) as { x: number; y: number } | undefined;
      if (!size || !layout) {
        return null;
      }

      // Dagre returns center points; React Flow stores node origins from the top-left corner.
      return {
        id: node.id,
        position: {
          x: Math.round(layout.x - size.width / 2),
          y: Math.round(layout.y - size.height / 2),
        },
      };
    })
    .filter((entry): entry is CanvasLayoutChange => entry !== null);
}
