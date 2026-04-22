import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import type { UserSkillRow } from '../../user-skills/user-skills.dto.js';
import { CompilerService } from '../compiler/compiler.service.js';
import { CursorExtractorService } from '../extractors/cursor-extractor.service.js';
import { OpencodeExtractorService } from '../extractors/opencode-extractor.service.js';
import { GraphMapperService } from '../graph-mapper.service.js';
import { ParametrizerService } from '../parametrizer/parametrizer.service.js';
import { SchemaInferenceService } from '../schema-inference/schema-inference.service.js';

function createCompiler(overrides?: {
  userSkills?: {
    getBySlug(slug: string): Promise<never>;
    create(input: Record<string, unknown>): Promise<UserSkillRow>;
  };
  cursorExtractor?: Pick<CursorExtractorService, 'parse'>;
}) {
  const opencodeExtractor = new OpencodeExtractorService();
  const cursorExtractor =
    overrides?.cursorExtractor ??
    ({
      parse: () => ({ nodes: [], edges: [], metadata: {}, warnings: [] }),
    } satisfies Pick<CursorExtractorService, 'parse'>);
  const userSkills =
    overrides?.userSkills ??
    ({
      async getBySlug(): Promise<never> {
        throw new NotFoundException('USER_SKILL_NOT_FOUND');
      },
      async create(): Promise<UserSkillRow> {
        throw new Error('create should not be called in draft mode');
      },
    } satisfies {
      getBySlug(slug: string): Promise<never>;
      create(input: Record<string, unknown>): Promise<UserSkillRow>;
    });

  return new CompilerService(
    opencodeExtractor,
    cursorExtractor as CursorExtractorService,
    new GraphMapperService(),
    new ParametrizerService(),
    new SchemaInferenceService(),
    userSkills as never,
  );
}

test('compile drafts an opencode session through the full pipeline without persisting', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'compiler-opencode-'));
  try {
    const fixturePath = join(tempDir, 'session.json');
    await writeFile(
      fixturePath,
      JSON.stringify({
        sessionName: 'Stripe Weekly Report',
        events: [
          { type: 'message_start', messageId: 'm1' },
          {
            type: 'content_block_delta',
            blockType: 'text',
            delta: 'Create Stripe report and send summary to finance@example.com',
            messageId: 'm1',
          },
          {
            type: 'file_edit',
            path: 'src/report.ts',
            operation: 'write',
            content: 'const endpoint = "https://api.stripe.com/v1"; const secret = "sk_live_abc123";',
            messageId: 'm1',
          },
          {
            type: 'command_execution',
            command: 'pnpm test',
            exitCode: 0,
            stdout: 'ok',
            messageId: 'm1',
          },
          { type: 'message_stop', messageId: 'm1', stopReason: 'end_turn' },
        ],
      }),
      'utf8',
    );

    const service = createCompiler();
    const result = await service.compile({
      sessionId: 'sess-op-1',
      agentType: 'opencode',
      mode: 'draft',
      sessionData: fixturePath,
    });

    assert.equal(result.skill.slug, 'stripe-weekly-report');
    assert.equal(result.skill.title, 'Stripe Weekly Report');
    assert.equal(result.skill.sourceSessionId, 'sess-op-1');
    assert.equal(result.skill.execution?.mode, 'session');
    assert.equal(result.skill.execution?.graphRef, 'sess-op-1');
    assert.equal(result.skill.graphJson?.id, 'sess-op-1');
    assert.deepEqual(result.skill.tags, ['compiled', 'opencode']);
    assert.ok(result.skill.inputsSchema?.properties);
    assert.ok(result.skill.outputsSchema?.properties);
    assert.ok(result.report.graphStats.nodes > 0);
    assert.ok(result.report.graphStats.edges > 0);
    assert.ok(result.report.estimatedCost > 0);
    assert.deepEqual(
      result.report.parameters.map((parameter) => parameter.name).sort(),
      ['email_address', 'git_provider', 'path', 'stripe_api_key', 'stripe_api_url'],
    );
    assert.match(result.skill.summary ?? '', /5 detected parameters/);
    assert.ok(result.report.warnings.some((warning) => /draft mode/i.test(warning)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('compile publishes a cursor session and generates a unique slug', async () => {
  const createdPayloads: Array<Record<string, unknown>> = [];
  const tempDir = await mkdtemp(join(tmpdir(), 'compiler-cursor-'));
  try {
    const cursorDbPath = join(tempDir, 'cursor.db');
    await writeFile(cursorDbPath, 'stub', 'utf8');
    const service = createCompiler({
      cursorExtractor: {
        parse: (dbPath: string) => ({
          nodes: [
            {
              id: 'msg-1',
              type: 'agent_output',
              createdAt: '2026-04-22T10:00:00.000Z',
              updatedAt: '2026-04-22T10:00:00.000Z',
              content: {
                text: 'Email the release checklist to ops@example.com and deploy to https://preview.example.com',
                dbPath,
              },
              creator: { type: 'agent', agentType: 'cursor', agentId: 'cursor-test' },
              position: { x: 0, y: 0 },
              dimensions: { width: 0, height: 0 },
              metadata: {},
              status: 'active',
              branches: [],
            },
          ],
          edges: [],
          metadata: { sessionName: 'Release Checklist' },
          warnings: ['best-effort extraction'],
        }),
      },
      userSkills: {
        async getBySlug(slug: string): Promise<never> {
          if (slug === 'release-checklist') {
            return { id: 'existing' } as never;
          }
          throw new NotFoundException('USER_SKILL_NOT_FOUND');
        },
        async create(input: Record<string, unknown>): Promise<UserSkillRow> {
          createdPayloads.push(input);
          return {
            id: 'skill-1',
            slug: String(input.slug),
            version: '1.0.0',
            title: String(input.title),
            summary: String(input.summary),
            icon: null,
            category: (input.category as string) ?? null,
            tags: (input.tags as string[]) ?? [],
            inputsSchema: (input.inputsSchema as UserSkillRow['inputsSchema']) ?? {},
            outputsSchema: (input.outputsSchema as UserSkillRow['outputsSchema']) ?? {},
            kind: String(input.kind ?? 'workflow_template'),
            promptText: null,
            graphJson: (input.graphJson as Record<string, unknown>) ?? null,
            execution: (input.execution as UserSkillRow['execution']) ?? null,
            sourceSessionId: (input.sourceSessionId as string) ?? null,
            visibility: (input.visibility as UserSkillRow['visibility']) ?? 'private',
            ownerKey: 'local-user',
            validated: false,
            deprecated: false,
            replacedBySlug: null,
            createdAt: '2026-04-22T10:00:00.000Z',
            updatedAt: '2026-04-22T10:00:00.000Z',
          };
        },
      },
    });

    const result = await service.compile({
      sessionId: 'sess-cursor-1',
      agentType: 'cursor',
      mode: 'publish',
      sessionData: cursorDbPath,
    });

    assert.equal(result.skill.id, 'skill-1');
    assert.equal(result.skill.slug, 'release-checklist-2');
    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0]?.slug, 'release-checklist-2');
    assert.equal(createdPayloads[0]?.sourceSessionId, 'sess-cursor-1');
    assert.equal((createdPayloads[0]?.execution as { mode?: string }).mode, 'session');
    assert.ok(result.report.parameters.some((parameter) => parameter.name === 'email_address'));
    assert.ok(result.report.parameters.some((parameter) => parameter.name === 'service_url'));
    assert.ok(result.report.warnings.includes('best-effort extraction'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('compile rejects missing session data early', async () => {
  const service = createCompiler();

  await assert.rejects(
    () => service.compile({ sessionId: 'sess-1', agentType: 'cursor', mode: 'draft' }),
    /SKILL_COMPILER_SESSION_DATA_REQUIRED:cursor/,
  );
});

test('compile rejects session paths outside allowed roots', async () => {
  const service = createCompiler();

  await assert.rejects(
    () =>
      service.compile({
        sessionId: 'sess-unsafe',
        agentType: 'cursor',
        mode: 'draft',
        sessionData: '/etc/hosts',
      }),
    /SKILL_COMPILER_INVALID_SESSION_PATH/,
  );
});
