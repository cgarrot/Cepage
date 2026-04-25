import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize } from 'node:path';
import * as tar from 'tar';
import type { ClaudeCodeEvent } from './extractors/claude-code-extractor.service';

export interface UploadedSessionArchive {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
}

export interface PreparedSessionData {
  sessionData: string;
  cleanup(): Promise<void>;
}

@Injectable()
export class SessionArchiveService {
  async prepareClaudeCodeArchive(file: UploadedSessionArchive): Promise<PreparedSessionData> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('SKILL_COMPILER_EMPTY_SESSION_ARCHIVE');
    }

    const rootDir = await mkdtemp(join(tmpdir(), 'cepage-session-archive-'));
    const archivePath = join(rootDir, file.originalname || 'session.tar.gz');
    const extractDir = join(rootDir, 'extracted');
    await mkdir(extractDir, { recursive: true });
    await writeFile(archivePath, file.buffer);

    try {
      await this.assertSafeArchiveEntries(archivePath);
      await tar.x({ file: archivePath, cwd: extractDir, strict: true });

      const sessionData = await this.findAndNormalizeSessionFile(extractDir, rootDir);
      return {
        sessionData,
        cleanup: async () => {
          await rm(rootDir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      await rm(rootDir, { recursive: true, force: true });
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('SKILL_COMPILER_INVALID_SESSION_ARCHIVE');
    }
  }

  private async assertSafeArchiveEntries(archivePath: string): Promise<void> {
    await tar.t({
      file: archivePath,
      onentry: (entry) => {
        if (!this.isSafeArchivePath(entry.path)) {
          throw new BadRequestException('SKILL_COMPILER_UNSAFE_SESSION_ARCHIVE_PATH');
        }
      },
    });
  }

  private isSafeArchivePath(entryPath: string): boolean {
    const normalized = normalize(entryPath).replace(/\\/g, '/');
    return (
      entryPath.trim().length > 0 &&
      !isAbsolute(entryPath) &&
      !/^[A-Za-z]:/.test(entryPath) &&
      normalized !== '..' &&
      !normalized.startsWith('../') &&
      !normalized.includes('/../')
    );
  }

  private async findAndNormalizeSessionFile(dir: string, outputDir: string): Promise<string> {
    const candidates = await this.collectSessionCandidates(dir);
    for (const candidate of candidates) {
      const normalized = await this.tryNormalizeCandidate(candidate, outputDir);
      if (normalized) return normalized;
    }
    throw new BadRequestException('SKILL_COMPILER_SESSION_ARCHIVE_MISSING_TRANSCRIPT');
  }

  private async collectSessionCandidates(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const candidates: string[] = [];

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        candidates.push(...await this.collectSessionCandidates(entryPath));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.json' || ext === '.jsonl') {
          candidates.push(entryPath);
        }
      }
    }

    return candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  }

  private async tryNormalizeCandidate(candidate: string, outputDir: string): Promise<string | undefined> {
    const raw = await readFile(candidate, 'utf8');
    if (extname(candidate).toLowerCase() === '.json') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (this.isCompilerFixture(parsed)) return candidate;
        const events = this.parseClaudeCodeJsonlValue(parsed);
        if (events.length > 0) {
          return this.writeNormalizedFixture(outputDir, candidate, events);
        }
      } catch {
        return undefined;
      }
    }

    if (extname(candidate).toLowerCase() === '.jsonl') {
      const events = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return this.parseClaudeCodeJsonlValue(JSON.parse(line) as unknown);
          } catch {
            return [];
          }
        });
      if (events.length > 0) {
        return this.writeNormalizedFixture(outputDir, candidate, events);
      }
    }

    return undefined;
  }

  private isCompilerFixture(value: unknown): boolean {
    return Array.isArray(value) || (
      value !== null &&
      typeof value === 'object' &&
      Array.isArray((value as { events?: unknown }).events)
    );
  }

  private async writeNormalizedFixture(
    outputDir: string,
    sourcePath: string,
    events: ClaudeCodeEvent[],
  ): Promise<string> {
    const outputPath = join(outputDir, `normalized-${basename(sourcePath, extname(sourcePath))}.json`);
    await writeFile(outputPath, JSON.stringify({ events }, null, 2), 'utf8');
    return outputPath;
  }

  private parseClaudeCodeJsonlValue(value: unknown): ClaudeCodeEvent[] {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const message = isRecord(record.message) ? record.message : undefined;
    const role = String(record.type ?? message?.role ?? '');
    const content = message?.content ?? record.content;

    if (role === 'user') return this.parseUserContent(content);
    if (role === 'assistant') return this.parseAssistantContent(content);
    if (role === 'tool_result') return [this.toToolResult(record)];
    if (role === 'error' && typeof record.message === 'string') {
      return [{ type: 'error', message: record.message, code: stringValue(record.code) }];
    }
    return [];
  }

  private parseUserContent(content: unknown): ClaudeCodeEvent[] {
    if (typeof content === 'string') return [{ type: 'user', content }];
    if (!Array.isArray(content)) return [];

    const events: ClaudeCodeEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ type: 'user', content: block.text });
      }
      if (block.type === 'tool_result') {
        events.push(this.toToolResult(block));
      }
    }
    return events;
  }

  private parseAssistantContent(content: unknown): ClaudeCodeEvent[] {
    if (typeof content === 'string') return [{ type: 'assistant', content }];
    if (!Array.isArray(content)) return [];

    const events: ClaudeCodeEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ type: 'assistant', content: block.text });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        events.push({ type: 'assistant', thinking: block.thinking });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        events.push({
          type: 'tool_use',
          name: block.name,
          input: isRecord(block.input) ? block.input : {},
          callId: stringValue(block.id),
        });
      }
    }
    return events;
  }

  private toToolResult(record: Record<string, unknown>): ClaudeCodeEvent {
    const rawContent = record.content ?? record.output;
    const output = typeof rawContent === 'string'
      ? rawContent
      : rawContent === undefined
        ? undefined
        : JSON.stringify(rawContent);
    return {
      type: 'tool_result',
      callId: stringValue(record.tool_use_id ?? record.callId ?? record.id),
      output,
      error: stringValue(record.error),
      isError: typeof record.is_error === 'boolean'
        ? record.is_error
        : typeof record.isError === 'boolean'
          ? record.isError
          : undefined,
    };
  }
}

function scoreCandidate(candidate: string): number {
  const name = basename(candidate).toLowerCase();
  if (name.endsWith('.jsonl')) return 3;
  if (name.includes('session') || name.includes('transcript')) return 2;
  return 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
