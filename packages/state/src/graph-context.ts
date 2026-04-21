type EdgeLike = {
  source: string;
  target: string;
};

export function collectConnectedNodeIds(
  startNodeId: string,
  edges: ReadonlyArray<EdgeLike>,
): string[] {
  if (!startNodeId) return [];

  const adjacency = new Map<string, Set<string>>();
  const ensure = (id: string): Set<string> => {
    const existing = adjacency.get(id);
    if (existing) return existing;
    const created = new Set<string>();
    adjacency.set(id, created);
    return created;
  };

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    ensure(edge.source).add(edge.target);
    ensure(edge.target).add(edge.source);
  }
  ensure(startNodeId);

  const visited = new Set<string>();
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    for (const next of neighbors) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return [...visited];
}

function hash32(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildSpawnRequestId(
  sessionId: string,
  seedNodeIds: ReadonlyArray<string>,
  options?: {
    triggerNodeId?: string | null;
    workingDirectory?: string | null;
    type?: string | null;
    providerID?: string | null;
    modelID?: string | null;
    variant?: string | null;
  },
): string {
  const normalized = [...new Set(seedNodeIds.filter(Boolean))].sort();
  const payload = [
    sessionId,
    options?.triggerNodeId ?? '',
    options?.workingDirectory ?? '',
    options?.type ?? '',
    options?.providerID ?? '',
    options?.modelID ?? '',
    options?.variant ?? '',
    ...normalized,
  ].join('|');
  return `spawn-${hash32(payload)}-${normalized.length}`;
}
