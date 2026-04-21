import type { GraphEdge, GraphNode } from '@cepage/shared-core';

export function getSpawnPositions(triggerPosition?: GraphNode['position'] | null): {
  spawn: GraphNode['position'];
  output: GraphNode['position'];
  error: GraphNode['position'];
} {
  if (!triggerPosition) {
    return {
      spawn: { x: 320, y: 200 },
      output: { x: 520, y: 200 },
      error: { x: 320, y: 400 },
    };
  }

  return {
    spawn: { x: triggerPosition.x + 260, y: triggerPosition.y - 40 },
    output: { x: triggerPosition.x + 460, y: triggerPosition.y - 40 },
    error: { x: triggerPosition.x + 260, y: triggerPosition.y + 160 },
  };
}

export function buildSpawnEdgeSpecs(input: {
  triggerNodeId?: string | null;
  rootNodeId: string;
  outputNodeId: string;
}): Array<{
  source: string;
  target: string;
  relation: GraphEdge['relation'];
  direction: GraphEdge['direction'];
}> {
  const edges: Array<{
    source: string;
    target: string;
    relation: GraphEdge['relation'];
    direction: GraphEdge['direction'];
  }> = [];

  if (input.triggerNodeId) {
    edges.push({
      source: input.triggerNodeId,
      target: input.rootNodeId,
      relation: 'spawns',
      direction: 'source_to_target',
    });
  }

  edges.push({
    source: input.rootNodeId,
    target: input.outputNodeId,
    relation: 'produces',
    direction: 'source_to_target',
  });

  return edges;
}
