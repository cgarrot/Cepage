import type {
  Branch,
  BranchId,
  Creator,
  EdgeId,
  EdgeRelation,
  GraphEdge,
  GraphEventEnvelope,
  GraphNode,
  GraphSnapshot,
  NodeId,
  SessionId,
  WakeReason,
} from '@cepage/shared-core';

function nowIso(): string {
  return new Date().toISOString();
}

export interface GraphStoreOptions {
  sessionId: SessionId;
  viewport?: { x: number; y: number; zoom: number };
}

export interface AddNodeInput {
  id?: NodeId;
  type: GraphNode['type'];
  content: GraphNode['content'];
  creator: Creator;
  position: { x: number; y: number };
  dimensions?: { width: number; height: number };
  metadata?: Record<string, unknown>;
  branches?: BranchId[];
  status?: GraphNode['status'];
}

export interface AddEdgeInput {
  id?: EdgeId;
  source: NodeId;
  target: NodeId;
  relation: EdgeRelation;
  direction?: GraphEdge['direction'];
  strength?: number;
  creator: Creator;
  metadata?: Record<string, unknown>;
}

export class GraphStore {
  private readonly sessionId: SessionId;
  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly edges = new Map<EdgeId, GraphEdge>();
  private readonly branches = new Map<BranchId, Branch>();
  private lastEventId = 0;
  private viewport: { x: number; y: number; zoom: number };
  private readonly listeners = new Set<(e: GraphEventEnvelope) => void>();

  constructor(opts: GraphStoreOptions) {
    this.sessionId = opts.sessionId;
    this.viewport = opts.viewport ?? { x: 0, y: 0, zoom: 1 };
  }

  getLastEventId(): number {
    return this.lastEventId;
  }

  setLastEventId(n: number): void {
    this.lastEventId = n;
  }

  subscribe(fn: (e: GraphEventEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(
    payload: GraphEventEnvelope['payload'],
    actor: Creator,
    meta?: { runId?: string; wakeReason?: WakeReason; requestId?: string },
  ): GraphEventEnvelope {
    this.lastEventId += 1;
    const env: GraphEventEnvelope = {
      eventId: this.lastEventId,
      sessionId: this.sessionId,
      actor,
      runId: meta?.runId,
      wakeReason: meta?.wakeReason,
      requestId: meta?.requestId,
      timestamp: nowIso(),
      payload,
    };
    for (const l of this.listeners) l(env);
    return env;
  }

  /** Restore full state (e.g. from DB) without bumping event ids from snapshot */
  hydrateFromSnapshot(snap: GraphSnapshot): void {
    this.nodes.clear();
    this.edges.clear();
    this.branches.clear();
    for (const n of snap.nodes) this.nodes.set(n.id, { ...n });
    for (const e of snap.edges) this.edges.set(e.id, { ...e });
    for (const b of snap.branches) this.branches.set(b.id, structuredClone(b));
    this.viewport = { ...snap.viewport };
    if (snap.lastEventId != null) this.lastEventId = snap.lastEventId;
  }

  toSnapshot(): GraphSnapshot {
    return {
      version: 1,
      id: this.sessionId,
      createdAt: nowIso(),
      lastEventId: this.lastEventId,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      branches: [...this.branches.values()],
      viewport: { ...this.viewport },
    };
  }

  getNode(id: NodeId): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: EdgeId): GraphEdge | undefined {
    return this.edges.get(id);
  }

  listNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  listEdges(): GraphEdge[] {
    return [...this.edges.values()];
  }

  listBranches(): Branch[] {
    return [...this.branches.values()];
  }

  getViewport() {
    return { ...this.viewport };
  }

  /** Client-side viewport only until a dedicated WS event exists */
  updateViewportLocal(v: { x: number; y: number; zoom: number }): void {
    this.viewport = { ...v };
  }

  addNode(input: AddNodeInput, meta?: { runId?: string; wakeReason?: WakeReason; requestId?: string }): GraphEventEnvelope {
    const id = input.id ?? crypto.randomUUID();
    const t = nowIso();
    const node: GraphNode = {
      id,
      type: input.type,
      createdAt: t,
      updatedAt: t,
      content: input.content,
      creator: input.creator,
      position: { ...input.position },
      dimensions: input.dimensions ?? { width: 220, height: 120 },
      metadata: input.metadata ?? {},
      status: input.status ?? 'active',
      branches: input.branches ?? [],
    };
    this.nodes.set(id, node);
    return this.emit({ type: 'node_added', nodeId: id, node }, input.creator, meta);
  }

  updateNode(
    nodeId: NodeId,
    patch: Partial<Pick<GraphNode, 'content' | 'position' | 'dimensions' | 'status' | 'metadata' | 'branches'>>,
    actor: Creator,
    meta?: { runId?: string; wakeReason?: WakeReason; requestId?: string },
  ): GraphEventEnvelope {
    const n = this.nodes.get(nodeId);
    if (!n) throw new Error(`NODE_NOT_FOUND:${nodeId}`);
    const updated: GraphNode = {
      ...n,
      ...patch,
      position: patch.position ? { ...patch.position } : n.position,
      dimensions: patch.dimensions ? { ...patch.dimensions } : n.dimensions,
      metadata: patch.metadata ? { ...n.metadata, ...patch.metadata } : n.metadata,
      branches: patch.branches ?? n.branches,
      updatedAt: nowIso(),
    };
    this.nodes.set(nodeId, updated);
    return this.emit({ type: 'node_updated', nodeId, patch }, actor, meta);
  }

  removeNode(nodeId: NodeId, actor: Creator, meta?: { requestId?: string }): GraphEventEnvelope {
    const n = this.nodes.get(nodeId);
    if (!n) throw new Error(`NODE_NOT_FOUND:${nodeId}`);
    const affected: EdgeId[] = [];
    for (const [eid, e] of this.edges) {
      if (e.source === nodeId || e.target === nodeId) {
        affected.push(eid);
        this.edges.delete(eid);
      }
    }
    this.nodes.delete(nodeId);
    return this.emit({ type: 'node_removed', nodeId, affectedEdges: affected }, actor, meta);
  }

  addEdge(input: AddEdgeInput, meta?: { runId?: string; wakeReason?: WakeReason; requestId?: string }): GraphEventEnvelope {
    if (!this.nodes.has(input.source) || !this.nodes.has(input.target)) {
      throw new Error('EDGE_ENDPOINTS_MISSING');
    }
    for (const e of this.edges.values()) {
      if (e.source === input.source && e.target === input.target && e.relation === input.relation) {
        throw new Error('EDGE_DUPLICATE');
      }
    }
    const id = input.id ?? crypto.randomUUID();
    const edge: GraphEdge = {
      id,
      source: input.source,
      target: input.target,
      relation: input.relation,
      direction: input.direction ?? 'bidirectional',
      strength: input.strength ?? 0.5,
      createdAt: nowIso(),
      creator: input.creator,
      metadata: input.metadata ?? {},
    };
    this.edges.set(id, edge);
    return this.emit({ type: 'edge_added', edgeId: id, edge }, input.creator, meta);
  }

  removeEdge(edgeId: EdgeId, actor: Creator, meta?: { requestId?: string }): GraphEventEnvelope {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`EDGE_NOT_FOUND:${edgeId}`);
    this.edges.delete(edgeId);
    return this.emit({ type: 'edge_removed', edgeId, edge }, actor, meta);
  }

  createBranch(
    name: string,
    color: string,
    fromNodeId: NodeId,
    createdBy: Creator,
    meta?: { requestId?: string },
  ): GraphEventEnvelope {
    if (!this.nodes.has(fromNodeId)) throw new Error(`NODE_NOT_FOUND:${fromNodeId}`);
    const branchId = crypto.randomUUID();
    const branch: Branch = {
      id: branchId,
      name,
      color,
      createdAt: nowIso(),
      createdBy,
      headNodeId: fromNodeId,
      nodeIds: [fromNodeId],
      status: 'active',
    };
    this.branches.set(branchId, branch);
    return this.emit({ type: 'branch_created', branchId, branch }, createdBy, meta);
  }

  mergeBranch(
    sourceBranchId: BranchId,
    targetBranchId: BranchId,
    actor: Creator,
    meta?: { requestId?: string },
  ): GraphEventEnvelope {
    const s = this.branches.get(sourceBranchId);
    const t = this.branches.get(targetBranchId);
    if (!s || !t) throw new Error('BRANCH_NOT_FOUND');
    s.status = 'merged';
    s.mergedIntoBranchId = targetBranchId;
    this.branches.set(sourceBranchId, s);
    return this.emit({ type: 'branch_merged', sourceBranchId, targetBranchId }, actor, meta);
  }

  abandonBranch(branchId: BranchId, actor: Creator, meta?: { requestId?: string }): GraphEventEnvelope {
    const b = this.branches.get(branchId);
    if (!b) throw new Error(`BRANCH_NOT_FOUND:${branchId}`);
    b.status = 'abandoned';
    this.branches.set(branchId, b);
    return this.emit({ type: 'branch_abandoned', branchId }, actor, meta);
  }

  /** Apply events after initial load for replay */
  applyEnvelope(env: GraphEventEnvelope): void {
    const p = env.payload;
    switch (p.type) {
      case 'node_added':
        this.nodes.set(p.nodeId, p.node);
        break;
      case 'node_updated': {
        const n = this.nodes.get(p.nodeId);
        if (!n) break;
        Object.assign(n, p.patch, {
          position: p.patch.position ? { ...p.patch.position } : n.position,
          dimensions: p.patch.dimensions ? { ...p.patch.dimensions } : n.dimensions,
          updatedAt: nowIso(),
        });
        break;
      }
      case 'node_removed':
        this.nodes.delete(p.nodeId);
        for (const eid of p.affectedEdges) this.edges.delete(eid);
        break;
      case 'edge_added':
        this.edges.set(p.edgeId, p.edge);
        break;
      case 'edge_removed':
        this.edges.delete(p.edgeId);
        break;
      case 'branch_created':
        this.branches.set(p.branchId, p.branch);
        break;
      case 'branch_merged':
      case 'branch_abandoned':
        break;
      case 'graph_cleared':
        this.nodes.clear();
        this.edges.clear();
        this.branches.clear();
        break;
      case 'graph_restored':
        this.hydrateFromSnapshot(p.snapshot);
        break;
      default:
        break;
    }
    if (env.eventId > this.lastEventId) this.lastEventId = env.eventId;
  }
}

export function createGraphStore(opts: GraphStoreOptions): GraphStore {
  return new GraphStore(opts);
}
