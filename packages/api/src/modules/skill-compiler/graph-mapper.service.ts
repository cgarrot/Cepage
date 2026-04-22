import { Injectable } from '@nestjs/common';
import type {
  Branch,
  Creator,
  EdgeRelation,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  NodeType,
} from '@cepage/shared-core';

export interface ExtractedSession {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

const DEFAULT_CREATOR: Creator = {
  type: 'system',
  reason: 'skill-compiler-graph-mapper',
};

const DEFAULT_CREATED_AT = '2026-04-22T00:00:00.000Z';
const DEFAULT_DIMENSIONS = { width: 220, height: 120 };
const RUNTIME_TARGET_HINT = /(deploy|preview|serve|start|launch|host|vercel|netlify|docker compose up|pnpm dev|npm run dev|vite preview)/i;
const TEST_HINT = /(\btest\b|vitest|jest|mocha|pytest|bun test|pnpm test|npm test|cargo test|go test)/i;

interface RetryGroup {
  keepId: string;
  dropIds: string[];
}

@Injectable()
export class GraphMapperService {
  map(session: ExtractedSession): GraphSnapshot {
    if (!session.nodes?.length) {
      return {
        version: 1,
        id: this.readSessionId(session),
        createdAt: DEFAULT_CREATED_AT,
        nodes: [],
        edges: [],
        branches: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
    }

    const normalizedNodes = session.nodes.map((node, index) => this.normalizeNode(node, index));
    const normalizedNodeIds = new Set(normalizedNodes.map((node) => node.id));
    const normalizedEdges = session.edges
      .map((edge, index) => this.normalizeEdge(edge, index, normalizedNodes))
      .filter((edge): edge is GraphEdge => Boolean(edge))
      .filter((edge) => normalizedNodeIds.has(edge.source) && normalizedNodeIds.has(edge.target));

    const retryGroups = this.findRetryGroups(normalizedNodes, normalizedEdges);
    const collapsed = this.collapseRetryGroups(normalizedNodes, normalizedEdges, retryGroups);
    const orphanLinked = this.connectOrphans(collapsed.nodes, collapsed.edges);
    const branched = this.injectBranchPoints(orphanLinked.nodes, orphanLinked.edges);
    const laidOut = this.layout(branched.nodes, branched.edges);

    return {
      version: 1,
      id: this.readSessionId(session),
      createdAt: laidOut.nodes[0]?.createdAt ?? DEFAULT_CREATED_AT,
      nodes: laidOut.nodes,
      edges: laidOut.edges,
      branches: this.createBranches(laidOut.nodes),
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  private normalizeNode(node: GraphNode, index: number): GraphNode {
    const createdAt = this.safeTimestamp(node.createdAt) ?? DEFAULT_CREATED_AT;
    const updatedAt = this.safeTimestamp(node.updatedAt) ?? createdAt;
    const type = this.normalizeNodeType(node);
    const metadata: Record<string, unknown> = { ...(node.metadata ?? {}) };

    if (type === 'runtime_run') {
      metadata.runtimeCategory = this.isTestRun(node) ? 'test' : 'command';
    }

    if (type === 'runtime_target') {
      metadata.runtimeCategory = 'deploy';
    }

    return {
      id: node.id || `mapped-node-${index}`,
      type,
      createdAt,
      updatedAt,
      content: { ...(node.content ?? {}) },
      creator: node.creator ?? DEFAULT_CREATOR,
      position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
      dimensions: {
        width: node.dimensions?.width && node.dimensions.width > 0 ? node.dimensions.width : DEFAULT_DIMENSIONS.width,
        height: node.dimensions?.height && node.dimensions.height > 0 ? node.dimensions.height : DEFAULT_DIMENSIONS.height,
      },
      metadata,
      status: node.status ?? 'active',
      branches: [...(node.branches ?? [])],
    };
  }

  private normalizeNodeType(node: GraphNode): NodeType {
    if (node.type === 'file_diff' || node.type === 'workspace_file' || node.type === 'branch_point') {
      return node.type;
    }

    if (node.type === 'runtime_run') {
      return this.looksLikeRuntimeTarget(node) ? 'runtime_target' : 'runtime_run';
    }

    if (node.type === 'agent_spawn' || node.type === 'agent_message' || node.type === 'system_message') {
      return 'agent_step';
    }

    if (node.type === 'human_request') return 'human_message';
    if (node.type === 'agent_output' || node.type === 'human_message' || node.type === 'agent_step') {
      return node.type;
    }

    return 'agent_step';
  }

  private normalizeEdge(edge: GraphEdge, index: number, nodes: GraphNode[]): GraphEdge | null {
    if (!edge.source || !edge.target || edge.source === edge.target) {
      return null;
    }

    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) return null;

    const relation = this.normalizeRelation(edge.relation, source, target);

    return {
      id: edge.id || `mapped-edge-${index}`,
      source: edge.source,
      target: edge.target,
      relation,
      direction: 'source_to_target',
      strength: edge.strength && edge.strength > 0 ? edge.strength : 1,
      createdAt: this.safeTimestamp(edge.createdAt) ?? source.createdAt,
      creator: edge.creator ?? source.creator ?? DEFAULT_CREATOR,
      metadata: { ...(edge.metadata ?? {}) },
    };
  }

  private normalizeRelation(_relation: GraphEdge['relation'], source: GraphNode, target: GraphNode): EdgeRelation {
    if (target.type === 'file_diff') return 'revises';
    if (source.type === 'runtime_target' && target.type === 'runtime_run') return 'spawns';
    if (target.type === 'runtime_target') return 'produces';
    if (source.type === 'agent_step' && target.type === 'agent_step') return 'spawns';
    if (source.type === 'branch_point') return 'spawns';
    if (target.type === 'runtime_run') return 'produces';
    if (target.type === 'agent_output') return 'feeds_into';
    if (target.type === 'agent_step') return 'feeds_into';
    return 'produces';
  }

  private findRetryGroups(nodes: GraphNode[], edges: GraphEdge[]): RetryGroup[] {
    const byKey = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const key = this.retryKey(node);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(node);
      byKey.set(key, list);
    }

    const groups: RetryGroup[] = [];
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      const ordered = [...list].sort((a, b) => this.compareNodes(a, b));
      const related = ordered.filter((node, index) => {
        if (index === 0) return true;
        return this.isLikelyRetryOf(ordered[index - 1]!, node, edges);
      });
      if (related.length < 2) continue;

      const keep = [...related].reverse().find((node) => !this.nodeHasError(node)) ?? related[related.length - 1]!;
      const dropIds = related.filter((node) => node.id !== keep.id).map((node) => node.id);
      if (dropIds.length > 0) groups.push({ keepId: keep.id, dropIds });
    }

    return groups;
  }

  private collapseRetryGroups(nodes: GraphNode[], edges: GraphEdge[], groups: RetryGroup[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    if (!groups.length) return { nodes: this.dedupeNodes(nodes), edges: this.dedupeEdges(edges) };

    const keepByDrop = new Map<string, string>();
    for (const group of groups) {
      for (const dropId of group.dropIds) keepByDrop.set(dropId, group.keepId);
    }

    const nodesById = new Map(nodes.map((node) => [node.id, { ...node, metadata: { ...node.metadata } }]));
    for (const group of groups) {
      const kept = nodesById.get(group.keepId);
      if (!kept) continue;
      const retries = group.dropIds.map((dropId) => nodesById.get(dropId)).filter(Boolean) as GraphNode[];
      if (retries.length) {
        kept.metadata.retryChain = retries.map((node) => ({ id: node.id, status: node.status, content: node.content }));
        kept.metadata.collapsedRetries = retries.length;
      }
    }

    const rewrittenEdges = edges
      .map((edge) => ({
        ...edge,
        source: keepByDrop.get(edge.source) ?? edge.source,
        target: keepByDrop.get(edge.target) ?? edge.target,
      }))
      .filter((edge) => edge.source !== edge.target);

    const remainingNodes = [...nodesById.values()].filter((node) => !keepByDrop.has(node.id));
    return {
      nodes: this.dedupeNodes(remainingNodes),
      edges: this.dedupeEdges(rewrittenEdges),
    };
  }

  private connectOrphans(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    if (nodes.length < 2) return { nodes, edges };

    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of edges) {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    }

    const orderedNodes = [...nodes].sort((a, b) => this.compareNodes(a, b));
    const stitched = [...edges];
    for (let index = 1; index < orderedNodes.length; index++) {
      const node = orderedNodes[index]!;
      if ((incoming.get(node.id) ?? 0) > 0) continue;
      const previous = orderedNodes[index - 1]!;
      stitched.push(this.makeEdge(previous, node, this.normalizeRelation('feeds_into', previous, node), `orphan-${index}`));
    }

    return { nodes, edges: this.dedupeEdges(stitched) };
  }

  private injectBranchPoints(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const bySource = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const list = bySource.get(edge.source) ?? [];
      list.push(edge);
      bySource.set(edge.source, list);
    }

    const updatedNodes = [...nodes];
    const rewrittenEdges = [...edges];
    let branchIndex = 0;
    const branchAssignments = new Map<string, string[]>();

    for (const node of nodes) {
      const outgoing = bySource.get(node.id) ?? [];
      const branchable = outgoing.filter((edge) => {
        const target = nodes.find((candidate) => candidate.id === edge.target);
        return Boolean(target) && ['agent_step', 'runtime_run', 'runtime_target'].includes(target!.type);
      });
      if (branchable.length < 2) continue;

      const branchPointId = `branch-point-${branchIndex}`;
      branchIndex += 1;
      const branchPoint: GraphNode = {
        id: branchPointId,
        type: 'branch_point',
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        content: { label: 'Parallel / conditional branch', sourceNodeId: node.id },
        creator: node.creator,
        position: { ...node.position },
        dimensions: { ...DEFAULT_DIMENSIONS },
        metadata: { sourceNodeId: node.id },
        status: 'active',
        branches: [],
      };
      updatedNodes.push(branchPoint);

      rewrittenEdges.push(this.makeEdge(node, branchPoint, 'feeds_into', `branch-parent-${branchPointId}`));
      for (let i = rewrittenEdges.length - 1; i >= 0; i--) {
        const edge = rewrittenEdges[i]!;
        if (edge.source !== node.id) continue;
        const target = updatedNodes.find((candidate) => candidate.id === edge.target);
        if (!target || target.id === branchPointId) continue;
        edge.source = branchPointId;
        edge.relation = target.type === 'file_diff' ? 'revises' : 'spawns';
        const branchId = `branch-${branchPointId}-${target.id}`;
        branchAssignments.set(target.id, [...(branchAssignments.get(target.id) ?? []), branchId]);
      }
    }

    const indexedNodes = updatedNodes.map((node) => {
      const assigned = branchAssignments.get(node.id);
      if (!assigned?.length) return node;
      return { ...node, branches: [...new Set([...(node.branches ?? []), ...assigned])] };
    });

    return {
      nodes: this.dedupeNodes(indexedNodes),
      edges: this.dedupeEdges(rewrittenEdges),
    };
  }

  private createBranches(nodes: GraphNode[]): Branch[] {
    const seen = new Set<string>();
    const branches: Branch[] = [];
    for (const node of nodes) {
      for (const branchId of node.branches ?? []) {
        if (seen.has(branchId)) continue;
        seen.add(branchId);
        const nodeIds = nodes.filter((candidate) => candidate.branches.includes(branchId)).map((candidate) => candidate.id);
        branches.push({
          id: branchId,
          name: branchId,
          color: '#7c3aed',
          createdAt: node.createdAt,
          createdBy: node.creator,
          headNodeId: node.id,
          nodeIds,
          status: 'active',
          forkedFromNodeId: typeof node.metadata.sourceNodeId === 'string' ? node.metadata.sourceNodeId : undefined,
        });
      }
    }
    return branches;
  }

  private layout(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const node of nodes) indegree.set(node.id, 0);
    for (const edge of edges) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
      const list = outgoing.get(edge.source) ?? [];
      list.push(edge.target);
      outgoing.set(edge.source, list);
    }

    const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).sort((a, b) => this.compareNodes(a, b));
    const depth = new Map<string, number>();
    const row = new Map<string, number>();
    let nextRow = 0;

    for (const node of queue) {
      depth.set(node.id, 0);
      row.set(node.id, nextRow++);
    }

    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      visited.add(current.id);
      const targets = outgoing.get(current.id) ?? [];
      targets.forEach((targetId, index) => {
        const nextDepth = (depth.get(current.id) ?? 0) + 1;
        depth.set(targetId, Math.max(depth.get(targetId) ?? 0, nextDepth));
        if (!row.has(targetId)) row.set(targetId, (row.get(current.id) ?? 0) + index);
        indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
        if ((indegree.get(targetId) ?? 0) <= 0) {
          const target = nodes.find((node) => node.id === targetId);
          if (target && !visited.has(targetId)) queue.push(target);
        }
      });
    }

    const ordered = [...nodes].sort((a, b) => this.compareNodes(a, b));
    ordered.forEach((node, index) => {
      if (!depth.has(node.id)) depth.set(node.id, index);
      if (!row.has(node.id)) row.set(node.id, nextRow++);
    });

    return {
      nodes: ordered.map((node) => ({
        ...node,
        position: {
          x: (depth.get(node.id) ?? 0) * 320,
          y: (row.get(node.id) ?? 0) * 180,
        },
      })),
      edges: this.dedupeEdges(edges).map((edge, index) => ({ ...edge, id: `mapped-edge-${index}` })),
    };
  }

  private readSessionId(session: ExtractedSession): string {
    const metadata = session.metadata ?? {};
    const candidate = metadata.sessionId ?? metadata.id;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'skill-compiler-session';
  }

  private retryKey(node: GraphNode): string | null {
    if (node.type === 'file_diff' && typeof node.content.path === 'string') {
      return `file:${node.content.path}:${String(node.content.operation ?? 'write')}`;
    }
    if (node.type === 'runtime_target') {
      const command = this.readCommand(node);
      return command ? `target:${command}` : null;
    }
    if (node.type === 'runtime_run') {
      const command = this.readCommand(node);
      return command ? `run:${command}` : null;
    }
    return null;
  }

  private isLikelyRetryOf(previous: GraphNode, current: GraphNode, edges: GraphEdge[]): boolean {
    if (previous.id === current.id) return false;
    if (this.hasDirectedPath(previous.id, current.id, edges)) return true;
    const previousParents = edges.filter((edge) => edge.target === previous.id).map((edge) => edge.source).sort();
    const currentParents = edges.filter((edge) => edge.target === current.id).map((edge) => edge.source).sort();
    return previousParents.length > 0 && previousParents.join('|') === currentParents.join('|');
  }

  private hasDirectedPath(sourceId: string, targetId: string, edges: GraphEdge[]): boolean {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const list = adjacency.get(edge.source) ?? [];
      list.push(edge.target);
      adjacency.set(edge.source, list);
    }

    const queue = [sourceId];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    return false;
  }

  private nodeHasError(node: GraphNode): boolean {
    if (node.status === 'error') return true;
    if (node.content.error || node.content.isError) return true;
    if (typeof node.content.exitCode === 'number' && node.content.exitCode !== 0) return true;
    if (typeof node.content.stderr === 'string' && node.content.stderr.length > 0) return true;
    return false;
  }

  private looksLikeRuntimeTarget(node: GraphNode): boolean {
    const command = this.readCommand(node);
    return Boolean(command && RUNTIME_TARGET_HINT.test(command));
  }

  private isTestRun(node: GraphNode): boolean {
    const command = this.readCommand(node);
    return Boolean(command && TEST_HINT.test(command));
  }

  private readCommand(node: GraphNode): string | null {
    const command = node.content.command ?? node.content.toolName ?? node.content.summary ?? node.content.text;
    return typeof command === 'string' && command.length > 0 ? command : null;
  }

  private compareNodes(a: GraphNode, b: GraphNode): number {
    const time = a.createdAt.localeCompare(b.createdAt);
    if (time !== 0) return time;
    return a.id.localeCompare(b.id);
  }

  private safeTimestamp(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private dedupeNodes(nodes: GraphNode[]): GraphNode[] {
    const seen = new Set<string>();
    return nodes.filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
  }

  private dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
    const seen = new Set<string>();
    return edges.filter((edge) => {
      const key = `${edge.source}|${edge.target}|${edge.relation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private makeEdge(source: GraphNode, target: GraphNode, relation: EdgeRelation, suffix: string): GraphEdge {
    return {
      id: `mapped-edge-${suffix}`,
      source: source.id,
      target: target.id,
      relation,
      direction: 'source_to_target',
      strength: 1,
      createdAt: source.createdAt,
      creator: source.creator,
      metadata: {},
    };
  }
}
