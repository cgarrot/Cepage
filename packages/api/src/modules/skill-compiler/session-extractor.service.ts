import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { GraphNode, GraphEdge } from '@cepage/shared-core';
import { ClaudeCodeExtractorService, type ClaudeCodeEvent } from './extractors/claude-code-extractor.service';
import { CursorExtractorService } from './extractors/cursor-extractor.service';
import { OpencodeExtractorService, type OpenCodeEvent } from './extractors/opencode-extractor.service';

export interface ExtractedSession {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

type OpencodeFixture =
  | OpenCodeEvent[]
  | {
      events: OpenCodeEvent[];
      sessionName?: string;
      name?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };

type ClaudeCodeFixture =
  | ClaudeCodeEvent[]
  | {
      events: ClaudeCodeEvent[];
      sessionName?: string;
      name?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };

@Injectable()
export class SessionExtractorService {
  constructor(
    private readonly opencodeExtractor: OpencodeExtractorService,
    private readonly cursorExtractor: CursorExtractorService,
    private readonly claudeCodeExtractor: ClaudeCodeExtractorService,
  ) {}

  async extract(agentType: string, sessionData: string, sessionId: string): Promise<ExtractedSession> {
    const extractorType = agentType === 'cursor_agent' ? 'cursor' : agentType === 'claude_code' ? 'claude-code' : agentType;

    if (extractorType === 'cursor') {
      const sessionPath = this.resolveAllowedSessionPath(sessionData);
      const extracted = this.cursorExtractor.parse(sessionPath);
      return {
        ...extracted,
        metadata: {
          ...(extracted.metadata ?? {}),
          sessionId,
          sessionDataPath: sessionPath,
        },
        warnings: extracted.warnings ?? [],
      };
    }

    if (extractorType === 'opencode') {
      const fixture = await this.readOpencodeFixture(sessionData);
      const events = Array.isArray(fixture) ? fixture : fixture.events;
      const extracted = this.opencodeExtractor.parse(events);
      const fixtureMetadata = Array.isArray(fixture)
        ? {}
        : {
            ...(fixture.metadata ?? {}),
            ...(fixture.sessionName ? { sessionName: fixture.sessionName } : {}),
            ...(fixture.name ? { name: fixture.name } : {}),
            ...(fixture.title ? { title: fixture.title } : {}),
          };

      return {
        ...extracted,
        metadata: {
          ...(extracted.metadata ?? {}),
          ...fixtureMetadata,
          sessionId,
        },
        warnings: [],
      };
    }

    if (extractorType === 'claude-code') {
      const fixture = await this.readClaudeCodeFixture(sessionData);
      const events = Array.isArray(fixture) ? fixture : fixture.events;
      const extracted = this.claudeCodeExtractor.parse(events);
      const fixtureMetadata = Array.isArray(fixture)
        ? {}
        : {
            ...(fixture.metadata ?? {}),
            ...(fixture.sessionName ? { sessionName: fixture.sessionName } : {}),
            ...(fixture.name ? { name: fixture.name } : {}),
            ...(fixture.title ? { title: fixture.title } : {}),
          };

      return {
        ...extracted,
        metadata: {
          ...(extracted.metadata ?? {}),
          ...fixtureMetadata,
          sessionId,
        },
        warnings: [],
      };
    }

    throw new BadRequestException(`SKILL_COMPILER_UNSUPPORTED_AGENT:${agentType}`);
  }

  private async readOpencodeFixture(source: string): Promise<OpencodeFixture> {
    const raw = await this.readSourceText(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('SKILL_COMPILER_INVALID_OPENCODE_SESSION');
    }

    if (Array.isArray(parsed)) {
      return parsed as OpenCodeEvent[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
      return parsed as OpencodeFixture;
    }

    throw new BadRequestException('SKILL_COMPILER_INVALID_OPENCODE_SESSION:expected event array');
  }

  private async readClaudeCodeFixture(source: string): Promise<ClaudeCodeFixture> {
    const raw = await this.readSourceText(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('SKILL_COMPILER_INVALID_CLAUDE_CODE_SESSION');
    }

    if (Array.isArray(parsed)) {
      return parsed as ClaudeCodeEvent[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
      return parsed as ClaudeCodeFixture;
    }

    throw new BadRequestException('SKILL_COMPILER_INVALID_CLAUDE_CODE_SESSION:expected event array');
  }

  private async readSourceText(source: string): Promise<string> {
    try {
      return await readFile(this.resolveAllowedSessionPath(source), 'utf8');
    } catch {
      throw new BadRequestException('SKILL_COMPILER_SESSION_DATA_UNREADABLE');
    }
  }

  private resolveAllowedSessionPath(source: string): string {
    const resolvedPath = resolve(source);
    const allowedRoots = [resolve(process.cwd()), resolve(tmpdir())];

    const isAllowed = allowedRoots.some((root) => {
      const pathRelative = relative(root, resolvedPath);
      return pathRelative === '' || (!pathRelative.startsWith('..') && !pathRelative.includes(`..`));
    });

    if (!isAllowed) {
      throw new BadRequestException('SKILL_COMPILER_INVALID_SESSION_PATH');
    }

    return resolvedPath;
  }
}
