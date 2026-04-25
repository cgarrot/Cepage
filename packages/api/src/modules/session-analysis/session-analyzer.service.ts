import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { GraphEdge, GraphNode, GraphSnapshot } from '@cepage/shared-core';
import { json } from '../../common/database/prisma-json';
import { PrismaService } from '../../common/database/prisma.service';

export interface SessionAnalysisSummary {
  nodeCount: number;
  edgeCount: number;
  topParameters: string[];
}

export interface SessionAnalysisResult {
  fingerprint: string;
  summary: SessionAnalysisSummary;
}

type SessionGraphRow = {
  id: string;
  createdAt: Date;
  metadata?: unknown;
  lastEventId: number;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  graphJson?: unknown;
  nodes: Array<{
    id: string;
    type: string;
    createdAt: Date;
    updatedAt: Date;
    content: unknown;
    creator: unknown;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    metadata: unknown;
    status: string;
    branchIds: string[];
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: string;
    direction: string;
    strength: number;
    createdAt: Date;
    creator: unknown;
    metadata: unknown;
  }>;
  branches: Array<{
    id: string;
    name: string;
    color: string;
    createdAt: Date;
    createdBy: unknown;
    headNodeId: string;
    nodeIds: unknown;
    parentBranchId: string | null;
    forkedFromNodeId: string | null;
    status: string;
    mergedIntoBranchId: string | null;
  }>;
};

type SessionMetadataWriter = {
  update(args: { where: { id: string }; data: { metadata: unknown } }): Promise<unknown>;
};

@Injectable()
export class SessionAnalyzerService {
  constructor(private readonly prisma: PrismaService) {}

  async analyze(sessionId: string): Promise<SessionAnalysisResult> {
    const session = (await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        nodes: true,
        edges: true,
        branches: true,
      },
    })) as SessionGraphRow | null;

    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    const snapshot = this.readSnapshot(session);
    const fingerprint = this.createFingerprint(snapshot);

    await this.persistFingerprint(sessionId, session.metadata, fingerprint);

    return {
      fingerprint,
      summary: {
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        topParameters: this.extractTopParameters(snapshot.nodes),
      },
    };
  }

  private readSnapshot(session: SessionGraphRow): GraphSnapshot {
    const graphJson = this.readGraphJson(session.graphJson);
    if (graphJson) {
      return graphJson;
    }

    return {
      version: 1,
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastEventId: session.lastEventId,
      nodes: session.nodes.map((node) => ({
        id: node.id,
        type: node.type as GraphNode['type'],
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        content: this.readRecord(node.content),
        creator: (node.creator ?? { type: 'system', reason: 'session-analysis' }) as GraphNode['creator'],
        position: { x: node.positionX, y: node.positionY },
        dimensions: { width: node.width, height: node.height },
        metadata: this.readRecord(node.metadata),
        status: node.status as GraphNode['status'],
        branches: Array.isArray(node.branchIds) ? node.branchIds : [],
      })),
      edges: session.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relation: edge.relation as GraphEdge['relation'],
        direction: edge.direction as GraphEdge['direction'],
        strength: edge.strength,
        createdAt: edge.createdAt.toISOString(),
        creator: (edge.creator ?? { type: 'system', reason: 'session-analysis' }) as GraphEdge['creator'],
        metadata: this.readRecord(edge.metadata),
      })),
      branches: session.branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        color: branch.color,
        createdAt: branch.createdAt.toISOString(),
        createdBy: (branch.createdBy ?? { type: 'system', reason: 'session-analysis' }) as GraphSnapshot['branches'][number]['createdBy'],
        headNodeId: branch.headNodeId,
        nodeIds: Array.isArray(branch.nodeIds) ? (branch.nodeIds as string[]) : [],
        parentBranchId: branch.parentBranchId ?? undefined,
        forkedFromNodeId: branch.forkedFromNodeId ?? undefined,
        status: branch.status as GraphSnapshot['branches'][number]['status'],
        mergedIntoBranchId: branch.mergedIntoBranchId ?? undefined,
      })),
      viewport: { x: session.viewportX, y: session.viewportY, zoom: session.viewportZoom },
    };
  }

  private async persistFingerprint(sessionId: string, metadataValue: unknown, fingerprint: string): Promise<void> {
    const metadata = this.readRecord(metadataValue);
    const analysis = this.readRecord(metadata.analysis);
    const sessionStore = this.prisma.session as unknown as SessionMetadataWriter;

    await sessionStore.update({
      where: { id: sessionId },
      data: {
        metadata: json({
          ...metadata,
          analysis: {
            ...analysis,
            fingerprint,
          },
        }),
      },
    });
  }

  private readGraphJson(value: unknown): GraphSnapshot | null {
    const record = this.readRecord(value);
    if (!record) return null;
    if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
    return record as unknown as GraphSnapshot;
  }

  private createFingerprint(snapshot: GraphSnapshot): string {
    const canonicalNodes = [...snapshot.nodes]
      .sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id))
      .map((node) =>
        this.sha256(
          [node.type, this.sortedContentKeys(node.content).join(','), node.creator?.type ?? 'unknown'].join('|'),
        ),
      )
      .join(',');

    const canonicalEdges = [...snapshot.edges]
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          left.relation.localeCompare(right.relation) ||
          left.target.localeCompare(right.target),
      )
      .map((edge) => `${edge.source}|${edge.relation}|${edge.target}`)
      .join(',');

    const canonical = `${snapshot.nodes.length}:${canonicalNodes}:${canonicalEdges}`;
    return this.sha256(canonical);
  }

  private sortedContentKeys(content: unknown): string[] {
    const record = this.readRecord(content);
    return Object.keys(record).sort((left, right) => left.localeCompare(right));
  }

  private extractTopParameters(nodes: GraphNode[]): string[] {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const text of this.collectStrings(node.content)) {
        for (const parameter of this.extractParameters(text)) {
          counts.set(parameter, (counts.get(parameter) ?? 0) + 1);
        }
      }
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([name]) => name);
  }

  private collectStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((entry) => this.collectStrings(entry));
    if (!value || typeof value !== 'object') return [];
    return Object.values(value).flatMap((entry) => this.collectStrings(entry));
  }

  private extractParameters(text: string): string[] {
    const matches = text.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g);
    return [...matches].map((match) => match[1]);
  }

  private readRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
