import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { SessionAnalyzerService } from './session-analyzer.service';

export interface SimilarSessionMatch {
  sessionId: string;
  similarity: number;
  fingerprint: string;
}

type PatternHeuristic = {
  name: 'payment-integration' | 'auth-setup' | 'dockerization';
  prefixes?: string[];
  substrings?: string[];
};

type SessionMetadataReader = {
  findMany(args: { select: { id: true; metadata: true } }): Promise<Array<{ id: string; metadata: unknown }>>;
};

const PATTERN_HEURISTICS: PatternHeuristic[] = [
  { name: 'payment-integration', prefixes: ['c0ffee', 'feed'], substrings: ['beef', 'f00d'] },
  { name: 'auth-setup', prefixes: ['dead', 'fade'], substrings: ['face', 'a11f'] },
  { name: 'dockerization', prefixes: ['d0cc', 'cafe'], substrings: ['baad', 'c0de'] },
];

@Injectable()
export class SessionPatternService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyzer: SessionAnalyzerService,
  ) {}

  async findSimilar(sessionId: string, threshold: number): Promise<SimilarSessionMatch[]> {
    const { fingerprint } = await this.analyzer.analyze(sessionId);
    const sessionStore = this.prisma.session as unknown as SessionMetadataReader;
    const sessions = await sessionStore.findMany({
      select: {
        id: true,
        metadata: true,
      },
    });

    return sessions
      .map((session) => ({
        sessionId: session.id,
        fingerprint: this.readFingerprint(session.metadata),
      }))
      .filter(
        (session): session is { sessionId: string; fingerprint: string } =>
          session.sessionId !== sessionId && typeof session.fingerprint === 'string',
      )
      .map((session) => ({
        ...session,
        similarity: this.computeSimilarity(fingerprint, session.fingerprint),
      }))
      .filter((session) => session.similarity > threshold)
      .sort((left, right) => right.similarity - left.similarity || left.sessionId.localeCompare(right.sessionId));
  }

  getPatternName(fingerprint: string): PatternHeuristic['name'] | null {
    const normalized = this.normalizeFingerprint(fingerprint);
    if (!normalized) return null;

    for (const heuristic of PATTERN_HEURISTICS) {
      if (heuristic.prefixes?.some((prefix) => normalized.startsWith(prefix))) {
        return heuristic.name;
      }
      if (heuristic.substrings?.some((substring) => normalized.includes(substring))) {
        return heuristic.name;
      }
    }

    return null;
  }

  private computeSimilarity(left: string, right: string): number {
    const normalizedLeft = this.normalizeFingerprint(left);
    const normalizedRight = this.normalizeFingerprint(right);
    const total = Math.max(normalizedLeft.length, normalizedRight.length);
    if (total === 0) return 1;

    let differences = 0;
    for (let index = 0; index < total; index += 1) {
      if (normalizedLeft[index] !== normalizedRight[index]) {
        differences += 1;
      }
    }

    return 1 - differences / total;
  }

  private readFingerprint(metadataValue: unknown): string | null {
    if (!metadataValue || typeof metadataValue !== 'object' || Array.isArray(metadataValue)) {
      return null;
    }
    const metadata = metadataValue as Record<string, unknown>;
    const analysis = metadata.analysis;
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
      return null;
    }
    const fingerprint = (analysis as Record<string, unknown>).fingerprint;
    return typeof fingerprint === 'string' ? this.normalizeFingerprint(fingerprint) : null;
  }

  private normalizeFingerprint(fingerprint: string): string {
    return fingerprint.trim().toLowerCase();
  }
}
