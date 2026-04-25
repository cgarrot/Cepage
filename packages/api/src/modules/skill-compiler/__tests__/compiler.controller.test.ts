import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as tar from 'tar';
import { NotFoundException } from '@nestjs/common';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';
import type { DryRunResult } from '../dry-run/dry-run.service';
import type { CompilationResult } from '../compiler/compiler.service';
import { SessionArchiveService } from '../session-archive.service.js';
import { SkillCompilerController } from '../skill-compiler.controller.js';

function createController(overrides?: {
  dryRun?: Pick<import('../dry-run/dry-run.service.js').DryRunService, 'validate'>;
  compiler?: Pick<import('../compiler/compiler.service.js').CompilerService, 'compile'>;
  userSkills?: Pick<import('../../user-skills/user-skills.service.js').UserSkillsService, 'getBySlug'>;
  sessionArchive?: Pick<SessionArchiveService, 'prepareClaudeCodeArchive'>;
}) {
  const dryRunService = overrides?.dryRun ?? {
    validate: (): DryRunResult => ({
      overall: 'PASS',
      checks: { parametric: 'PASS', schema: 'PASS', graph: 'PASS' },
      warnings: [],
      errors: [],
      estimatedCost: 1.5,
    }),
  };

  const compilerService = overrides?.compiler ?? {
    compile: async (): Promise<CompilationResult> => ({
      skill: { slug: 'test-skill' },
      report: {
        parameters: [],
        estimatedCost: 1.5,
        graphStats: { nodes: 2, edges: 1 },
        warnings: ['Draft mode generated a preview without saving.'],
      },
    }),
  };

  const userSkillsService = overrides?.userSkills ?? {
    async getBySlug(slug: string): Promise<UserSkillRow> {
      return {
        id: 'skill-1',
        slug,
        version: '1.0.0',
        title: 'Test Skill',
        summary: 'A test skill',
        icon: null,
        category: null,
        tags: [],
        inputsSchema: {},
        outputsSchema: {},
        kind: 'workflow_template',
        promptText: null,
        graphJson: null,
        execution: null,
        sourceSessionId: null,
        visibility: 'private',
        ownerKey: 'local-user',
        validated: false,
        deprecated: false,
        replacedBySlug: null,
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z',
      };
    },
  };

  return new SkillCompilerController(
    compilerService as never,
    dryRunService as never,
    userSkillsService as never,
    (overrides?.sessionArchive ?? new SessionArchiveService()) as never,
  );
}

test('dryRun returns PASS report for valid skill and inputs', async () => {
  const controller = createController();
  const result = await controller.dryRun({
    skillId: 'test-skill',
    inputs: { name: 'Alice' },
    mode: 'strict',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.overall, 'PASS');
  assert.equal(result.data.checks.parametric, 'PASS');
  assert.equal(result.data.checks.schema, 'PASS');
  assert.equal(result.data.checks.graph, 'PASS');
  assert.equal(result.data.errors.length, 0);
});

test('dryRun propagates NotFoundException when skill is missing', async () => {
  const controller = createController({
    userSkills: {
      async getBySlug(): Promise<never> {
        throw new NotFoundException('USER_SKILL_NOT_FOUND');
      },
    },
  });

  await assert.rejects(
    () =>
      controller.dryRun({
        skillId: 'missing-skill',
        inputs: {},
      }),
    NotFoundException,
  );
});

test('preview calls compiler with opencode and draft mode by default', async () => {
  let capturedArgs: Record<string, unknown> | undefined;
  const controller = createController({
    compiler: {
      async compile(args) {
        capturedArgs = args as unknown as Record<string, unknown>;
        return {
          skill: { slug: 'preview-skill' },
          report: {
            parameters: [],
            estimatedCost: 0,
            graphStats: { nodes: 0, edges: 0 },
            warnings: [],
          },
        };
      },
    },
  });

  const result = await controller.preview('sess-123', {});

  assert.equal(result.success, true);
  assert.equal(capturedArgs?.sessionId, 'sess-123');
  assert.equal(capturedArgs?.agentType, 'opencode');
  assert.equal(capturedArgs?.mode, 'draft');
});

test('preview passes cursor_agent agentType when provided', async () => {
  let capturedArgs: Record<string, unknown> | undefined;
  const controller = createController({
    compiler: {
      async compile(args) {
        capturedArgs = args as unknown as Record<string, unknown>;
        return {
          skill: { slug: 'preview-skill' },
          report: {
            parameters: [],
            estimatedCost: 0,
            graphStats: { nodes: 0, edges: 0 },
            warnings: [],
          },
        };
      },
    },
  });

  await controller.preview('sess-456', { agentType: 'cursor_agent' });

  assert.equal(capturedArgs?.agentType, 'cursor_agent');
  assert.equal(capturedArgs?.mode, 'draft');
});

test('compile accepts a Claude Code session archive upload', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'compiler-controller-'));
  try {
    const sessionDir = join(tempDir, 'session');
    await mkdir(sessionDir);
    await writeFile(
      join(sessionDir, 'transcript.jsonl'),
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Build the billing report' },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Report ready' }] },
        }),
      ].join('\n'),
      'utf8',
    );

    const archivePath = join(tempDir, 'session.tar.gz');
    await tar.c({ gzip: true, cwd: tempDir, file: archivePath }, ['session']);
    const buffer = await readFile(archivePath);

    let capturedArgs: Record<string, unknown> | undefined;
    let normalizedFixture: { events?: unknown[] } | undefined;
    const controller = createController({
      compiler: {
        async compile(args) {
          capturedArgs = args as unknown as Record<string, unknown>;
          normalizedFixture = JSON.parse(
            await readFile(String(capturedArgs.sessionData), 'utf8'),
          ) as { events?: unknown[] };
          return {
            skill: { slug: 'billing-report' },
            report: {
              parameters: [],
              estimatedCost: 0,
              graphStats: { nodes: 2, edges: 1 },
              warnings: [],
            },
          };
        },
      },
    });

    const result = await controller.compile(
      {
        sessionId: 'sess-claude-1',
        agentType: 'claude_code',
        mode: 'publish',
      },
      { originalname: 'session.tar.gz', buffer, size: buffer.length },
    );

    assert.equal(result.success, true);
    assert.equal(capturedArgs?.sessionId, 'sess-claude-1');
    assert.equal(capturedArgs?.agentType, 'claude_code');
    assert.equal(capturedArgs?.mode, 'publish');
    assert.equal(normalizedFixture?.events?.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
