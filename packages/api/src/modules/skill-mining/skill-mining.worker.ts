import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import type { Parameter } from '../skill-compiler/parametrizer/parametrizer.service';
import { SkillMiningService } from './skill-mining.service';

interface MiningSession {
  id: string;
  metadata: Prisma.JsonValue;
  nodes: Array<{
    type: string;
    content: Prisma.JsonValue;
  }>;
  edges: Array<Record<string, unknown>>;
}

interface MiningMetadata {
  miningMinedAt?: string;
}

interface EvaluationResult {
  detectedParams: Parameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  detectedPattern: string | null;
  confidence: number;
}

const DEFAULT_POLL_MS = 30_000;
const LOOKBACK_MINUTES = 60;
const MIN_MEANINGFUL_NODE_COUNT = 5;
const MIN_NODE_THRESHOLD = 3;
const MIN_EDGE_THRESHOLD = 2;

const SENSITIVE_KEYWORDS = /(sk_live|sk_test|pk_|stripe|paypal|api_key)/i;
const PHASE_KEYWORDS = ['design', 'build', 'test', 'deploy', 'implement', 'refactor', 'review'];

const URL_RE = /https?:\/\/[^\s"'`<>]+/g;
const API_KEY_RE = /\b(?:sk_(?:live|test)_[A-Za-z0-9]+|pk_[A-Za-z0-9]+)\b/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const FILE_PATH_RE = /\/[a-zA-Z0-9_/\-.]+/g;
const ENTITY_RE = /\b(?:Stripe|PayPal|GitHub)\b/g;

@Injectable()
export class SkillMiningWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SkillMiningWorker.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private readonly processed = new Set<string>();
  private readonly pollMs = resolvePollMs();

  constructor(
    private readonly prisma: PrismaService,
    private readonly miningService: SkillMiningService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.pollMs <= 0) {
      this.log.log('SkillMiningWorker disabled (pollMs <= 0)');
      return;
    }
    this.intervalHandle = setInterval(() => void this.tick(), this.pollMs);
    this.intervalHandle.unref?.();
    this.log.log(`SkillMiningWorker started (pollMs=${this.pollMs})`);
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.log.log('SkillMiningWorker stopped');
  }

  async detectCompilable(sessionId?: string): Promise<string[]> {
    if (sessionId) {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { nodes: true, edges: true },
      }) as unknown as MiningSession | null;
      if (!session) {
        this.log.warn(`Session ${sessionId} not found`);
        return [];
      }
      if (this.isAlreadyProcessed(session)) return [];
      const existingSkill = await this.prisma.userSkill.count({ where: { sourceSessionId: sessionId } });
      if (existingSkill > 0) return [];
      const result = await this.evaluate(session);
      if (result) await this.mark(session.id, result);
      return result ? [session.id] : [];
    }
    return this.tick();
  }

  getQueue(): string[] {
    return Array.from(this.processed);
  }

  private async tick(): Promise<string[]> {
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: {
        updatedAt: { gte: since },
        nodes: { some: {} },
      },
      include: { nodes: true, edges: true },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    }) as unknown as MiningSession[];

    const found: string[] = [];

    for (const session of sessions) {
      if (this.isAlreadyProcessed(session)) continue;
      const existingSkill = await this.prisma.userSkill.count({ where: { sourceSessionId: session.id } });
      if (existingSkill > 0) continue;
      const result = await this.evaluate(session);
      if (result) {
        found.push(session.id);
        await this.mark(session.id, result);
      }
    }

    if (found.length > 0) {
      this.log.log(`SkillMiningWorker tick found ${found.length} compilable session(s)`);
    }

    return found;
  }

  private isAlreadyProcessed(session: MiningSession): boolean {
    if (this.processed.has(session.id)) return true;
    const meta = session.metadata as unknown as MiningMetadata | undefined;
    if (meta?.miningMinedAt) return true;
    return false;
  }

  private async evaluate(session: MiningSession): Promise<EvaluationResult | null> {
    const nodes = session.nodes;
    const edges = session.edges;

    if (nodes.length <= MIN_NODE_THRESHOLD || edges.length <= MIN_EDGE_THRESHOLD) {
      return null;
    }

    const meaningfulCount = nodes.filter(
      (n) => n.type === 'agent_step' || n.type === 'runtime_run',
    ).length;
    if (meaningfulCount < MIN_MEANINGFUL_NODE_COUNT) {
      return null;
    }

    const fullText = this.extractText(nodes);
    if (!SENSITIVE_KEYWORDS.test(fullText)) {
      return null;
    }

    const phases = this.detectPhases(fullText);
    if (phases < 2) {
      return null;
    }

    const graphStats = { nodes: nodes.length, edges: edges.length };
    const estimatedCost = this.estimateCost(nodes, edges);
    const detectedParams = this.detectParams(nodes);
    const detectedPattern = this.inferPattern(phases);
    const confidence = Math.min(0.95, 0.5 + meaningfulCount * 0.02 + phases * 0.05);

    return { detectedParams, estimatedCost, graphStats, detectedPattern, confidence };
  }

  private extractText(nodes: MiningSession['nodes']): string {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.content && typeof node.content === 'object') {
        const json = node.content as Record<string, unknown>;
        for (const value of Object.values(json)) {
          if (typeof value === 'string') {
            parts.push(value);
          }
        }
      }
    }
    return parts.join(' \n ');
  }

  private detectPhases(text: string): number {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const keyword of PHASE_KEYWORDS) {
      if (lower.includes(keyword)) {
        hits++;
      }
    }
    return hits;
  }

  private estimateCost(
    nodes: MiningSession['nodes'],
    edges: MiningSession['edges'],
  ): number {
    const nodeWeight = nodes.reduce((total, node) => {
      switch (node.type) {
        case 'runtime_target':
          return total + 4;
        case 'runtime_run':
          return total + 2;
        case 'file_diff':
          return total + 1.5;
        case 'agent_step':
          return total + 1;
        case 'agent_output':
          return total + 0.5;
        default:
          return total + 0.25;
      }
    }, 0);
    return Number((nodeWeight + edges.length * 0.2).toFixed(2));
  }

  private detectParams(nodes: MiningSession['nodes']): Parameter[] {
    const params: Parameter[] = [];
    const usedNames = new Set<string>();
    const seenValues = new Set<string>();

    for (const node of nodes) {
      if (!node.content || typeof node.content !== 'object') continue;
      const content = node.content as Record<string, unknown>;
      for (const value of Object.values(content)) {
        if (typeof value !== 'string') continue;
        const matches = this.matchAllPatterns(value);
        for (const m of matches) {
          if (seenValues.has(m.value)) continue;
          seenValues.add(m.value);
          const name = this.ensureUniqueName(this.inferParamName(m), usedNames);
          const inferredType = m.isSecret ? 'secret' : 'string';
          params.push({
            name,
            originalValue: m.isSecret ? '[REDACTED]' : m.value,
            inferredType,
            isSecret: m.isSecret,
            suggestedDefault: m.isSecret ? '' : m.value,
          });
        }
      }
    }

    return params;
  }

  private matchAllPatterns(text: string): Array<{ value: string; isSecret: boolean }> {
    const out: Array<{ value: string; isSecret: boolean }> = [];
    const add = (re: RegExp, isSecret: boolean) => {
      re.lastIndex = 0;
      let result: RegExpExecArray | null;
      while ((result = re.exec(text)) != null) {
        out.push({ value: result[0], isSecret });
      }
    };
    add(API_KEY_RE, true);
    add(URL_RE, false);
    add(EMAIL_RE, false);
    add(FILE_PATH_RE, false);
    add(ENTITY_RE, false);
    return out;
  }

  private inferParamName(match: { value: string; isSecret: boolean }): string {
    const value = match.value;
    if (match.isSecret) {
      if (value.toLowerCase().includes('stripe')) return 'stripe_api_key';
      if (value.toLowerCase().includes('paypal')) return 'paypal_api_key';
      return 'api_key';
    }
    if (EMAIL_RE.test(value)) return 'email_address';
    if (URL_RE.test(value)) return 'service_url';
    if (FILE_PATH_RE.test(value)) return 'file_path';
    if (ENTITY_RE.test(value)) return 'service_name';
    return 'parameter';
  }

  private ensureUniqueName(base: string, used: Set<string>): string {
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let index = 2;
    let candidate = `${base}_${index}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${base}_${index}`;
    }
    used.add(candidate);
    return candidate;
  }

  private inferPattern(phases: number): string | null {
    if (phases >= 4) return 'full_pipeline';
    if (phases === 3) return 'build_test_deploy';
    if (phases === 2) return 'design_build';
    return 'mixed';
  }

  private async mark(sessionId: string, result: EvaluationResult): Promise<void> {
    this.processed.add(sessionId);
    const row = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { metadata: true } });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        metadata: {
          ...(row?.metadata as Record<string, unknown> | undefined),
          miningMinedAt: new Date().toISOString(),
        },
      },
    });
    await this.miningService.createProposal(sessionId, result).catch((err: Error) => {
      this.log.error(`Failed to create proposal for ${sessionId}: ${err.message}`);
    });
  }
}

function resolvePollMs(): number {
  const raw = process.env.SKILL_MINING_POLL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_POLL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_POLL_MS;
}
