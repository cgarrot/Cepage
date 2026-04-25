import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { json } from '../../common/database/prisma-json';
import type { Parameter } from '../skill-compiler/parametrizer/parametrizer.service';
import { CompilerService, type CompilationResult } from '../skill-compiler/compiler/compiler.service';
import type { ValidCompilerAgentType } from '@cepage/shared-core';

export interface Proposal {
  id: string;
  sessionId: string;
  detectedParams: Parameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  detectedPattern: string | null;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

type MetadataWithProposals = Record<string, unknown> & { proposals?: Proposal[] };

@Injectable()
export class SkillMiningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: CompilerService,
  ) {}

  private readMetadata(row: { metadata: Prisma.JsonValue }): MetadataWithProposals {
    return (row.metadata ?? {}) as MetadataWithProposals;
  }

  async createProposal(
    sessionId: string,
    input: {
      detectedParams: Parameter[];
      estimatedCost: number;
      graphStats: { nodes: number; edges: number };
      detectedPattern: string | null;
      confidence: number;
    },
  ): Promise<Proposal> {
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    if (!row) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    const proposal: Proposal = {
      id: randomUUID(),
      sessionId,
      detectedParams: input.detectedParams,
      estimatedCost: input.estimatedCost,
      graphStats: input.graphStats,
      detectedPattern: input.detectedPattern,
      confidence: input.confidence,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const meta = this.readMetadata(row);
    const proposals: Proposal[] = Array.isArray(meta.proposals) ? [...meta.proposals] : [];
    proposals.push(proposal);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { metadata: json({ ...meta, proposals }) },
    });

    return proposal;
  }

  async listProposals(): Promise<Proposal[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sessions = await this.prisma.session.findMany({
      where: { updatedAt: { gte: since } },
      select: { metadata: true },
    });

    const all: Proposal[] = [];
    for (const row of sessions) {
      const meta = this.readMetadata(row);
      if (Array.isArray(meta.proposals)) {
        all.push(...meta.proposals);
      }
    }

    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getProposal(proposalId: string): Promise<Proposal> {
    const proposal = await this.findProposal(proposalId);
    if (!proposal) {
      throw new NotFoundException('PROPOSAL_NOT_FOUND');
    }
    return proposal;
  }

  async acceptProposal(proposalId: string): Promise<{ proposal: Proposal; compilation: CompilationResult }> {
    const proposal = await this.getProposal(proposalId);
    if (proposal.status !== 'pending') {
      throw new NotFoundException('PROPOSAL_NOT_PENDING');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: proposal.sessionId },
      include: {
        nodes: true,
        edges: true,
        agentRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    const agentType = (session.agentRuns[0]?.agentType ?? 'opencode') as ValidCompilerAgentType;

    const tempPath = await this.buildTempSessionData({
      id: session.id,
      name: session.name,
      nodes: session.nodes.map((n) => ({ type: n.type, content: n.content })),
      edges: session.edges.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'session' && k !== 'sessionId'))),
    });

    try {
      const result = await this.compiler.compile({
        sessionId: session.id,
        agentType,
        mode: 'publish',
        sessionData: tempPath,
      });

      const accepted = await this.updateProposalStatus(proposalId, 'accepted');
      return { proposal: accepted, compilation: result };
    } finally {
      await unlink(tempPath).catch(() => void 0);
    }
  }

  async rejectProposal(proposalId: string): Promise<Proposal> {
    return this.updateProposalStatus(proposalId, 'rejected');
  }

  private async updateProposalStatus(proposalId: string, status: 'accepted' | 'rejected'): Promise<Proposal> {
    const sessions = await this.prisma.session.findMany({
      where: { metadata: { path: ['proposals'], array_contains: [{ id: proposalId }] } },
      select: { id: true, metadata: true },
    });
    if (!sessions.length) {
      throw new NotFoundException('PROPOSAL_NOT_FOUND');
    }

    const session = sessions[0];
    const meta = this.readMetadata(session);
    const proposals: Proposal[] = Array.isArray(meta.proposals) ? [...meta.proposals] : [];
    const index = proposals.findIndex((p) => p.id === proposalId);
    if (index === -1) {
      throw new NotFoundException('PROPOSAL_NOT_FOUND');
    }

    const updated = { ...proposals[index], status };
    proposals[index] = updated;

    await this.prisma.session.update({
      where: { id: session.id },
      data: { metadata: json({ ...meta, proposals }) },
    });

    return updated;
  }

  private async findProposal(proposalId: string): Promise<Proposal | null> {
    const sessions = await this.prisma.session.findMany({
      where: { metadata: { path: ['proposals'], array_contains: [{ id: proposalId }] } },
      select: { metadata: true },
    });
    for (const row of sessions) {
      const meta = this.readMetadata(row);
      if (Array.isArray(meta.proposals)) {
        const found = meta.proposals.find((p: Proposal) => p.id === proposalId);
        if (found) return found;
      }
    }
    return null;
  }

  private async buildTempSessionData(session: {
    id: string;
    name: string;
    nodes: Array<{ type: string; content: Prisma.JsonValue }>;
    edges: Array<Record<string, unknown>>;
  }): Promise<string> {
    const events: Array<Record<string, unknown>> = [];
    let messageCounter = 0;

    for (const node of session.nodes) {
      const content = (node.content ?? {}) as Record<string, unknown>;
      const msgId = `msg-${messageCounter++}`;
      events.push({ type: 'message_start', messageId: msgId });

      if (node.type === 'file_diff' || node.type === 'file_edit') {
        events.push({
          type: 'file_edit',
          path: String(content.path ?? ''),
          operation: 'write',
          content: String(content.text ?? content.patch ?? content.content ?? ''),
          messageId: msgId,
        });
      } else if (node.type === 'runtime_run' || node.type === 'command_execution') {
        events.push({
          type: 'command_execution',
          command: String(content.command ?? ''),
          exitCode: typeof content.exitCode === 'number' ? content.exitCode : 0,
          stdout: String(content.stdout ?? ''),
          stderr: String(content.stderr ?? ''),
          messageId: msgId,
        });
      } else {
        const text = this.extractNodeText(node);
        if (text) {
          events.push({
            type: 'content_block_delta',
            blockType: 'text',
            delta: text,
            messageId: msgId,
          });
        }
      }

      events.push({ type: 'message_stop', messageId: msgId });
    }

    const payload = {
      sessionName: session.name,
      events,
    };

    const tmpFile = join(tmpdir(), `skill-mining-${session.id}-${Date.now()}.json`);
    await writeFile(tmpFile, JSON.stringify(payload), 'utf8');
    return tmpFile;
  }

  private extractNodeText(node: { type: string; content: Prisma.JsonValue }): string | null {
    const content = (node.content ?? {}) as Record<string, unknown>;
    for (const key of ['text', 'prompt', 'instructions', 'body', 'summary', 'label']) {
      const val = content[key];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
    }
    const parts = content.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p && typeof p === 'object' && 'text' in p) {
          const text = (p as { text?: unknown }).text;
          if (typeof text === 'string' && text.trim()) {
            return text.trim();
          }
        }
      }
    }
    return null;
  }
}
