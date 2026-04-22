import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '../packages/api/node_modules/@nestjs/common/index.js';

import { CompilerService } from '../packages/api/dist/modules/skill-compiler/compiler/compiler.service.js';
import { OpencodeExtractorService } from '../packages/api/dist/modules/skill-compiler/extractors/opencode-extractor.service.js';
import { CursorExtractorService } from '../packages/api/dist/modules/skill-compiler/extractors/cursor-extractor.service.js';
import { GraphMapperService } from '../packages/api/dist/modules/skill-compiler/graph-mapper.service.js';
import { ParametrizerService } from '../packages/api/dist/modules/skill-compiler/parametrizer/parametrizer.service.js';
import { SchemaInferenceService } from '../packages/api/dist/modules/skill-compiler/schema-inference/schema-inference.service.js';
import { DryRunService } from '../packages/api/dist/modules/skill-compiler/dry-run/dry-run.service.js';
import { SkillCompilerController } from '../packages/api/dist/modules/skill-compiler/skill-compiler.controller.js';
import type { UserSkillRow } from '../packages/api/dist/modules/user-skills/user-skills.dto.js';
import type { OpenCodeEvent } from '../packages/api/dist/modules/skill-compiler/extractors/opencode-extractor.service.js';

class InMemoryUserSkillsService {
  private skills = new Map<string, UserSkillRow>();
  private idCounter = 1;

  async getBySlug(slug: string): Promise<UserSkillRow> {
    const skill = this.skills.get(slug);
    if (!skill) throw new NotFoundException('USER_SKILL_NOT_FOUND');
    return skill;
  }

  async create(input: Record<string, unknown>): Promise<UserSkillRow> {
    const slug = String(input.slug);
    const skill: UserSkillRow = {
      id: `skill-${this.idCounter++}`,
      slug,
      version: '1.0.0',
      title: String(input.title ?? 'Compiled skill'),
      summary: String(input.summary ?? 'Compiled skill'),
      icon: (input.icon as string | null) ?? null,
      category: (input.category as string | null) ?? null,
      tags: (input.tags as string[]) ?? [],
      inputsSchema: (input.inputsSchema as UserSkillRow['inputsSchema']) ?? {},
      outputsSchema: (input.outputsSchema as UserSkillRow['outputsSchema']) ?? {},
      kind: String(input.kind ?? 'workflow_template'),
      promptText: (input.promptText as string | null) ?? null,
      graphJson: (input.graphJson as Record<string, unknown> | null) ?? null,
      execution: (input.execution as UserSkillRow['execution']) ?? null,
      sourceSessionId: (input.sourceSessionId as string | null) ?? null,
      visibility: (input.visibility as UserSkillRow['visibility']) ?? 'private',
      ownerKey: 'local-user',
      validated: false,
      deprecated: false,
      replacedBySlug: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.skills.set(slug, skill);
    return skill;
  }

  list(): UserSkillRow[] {
    return Array.from(this.skills.values());
  }
}

interface Pipeline {
  compiler: CompilerService;
  dryRun: DryRunService;
  controller: SkillCompilerController;
  userSkills: InMemoryUserSkillsService;
}

function createPipeline(): Pipeline {
  const userSkills = new InMemoryUserSkillsService();

  const compiler = new CompilerService(
    new OpencodeExtractorService(),
    new CursorExtractorService(),
    new GraphMapperService(),
    new ParametrizerService(),
    new SchemaInferenceService(),
    userSkills as never,
  );

  const dryRun = new DryRunService();

  const controller = new SkillCompilerController(
    compiler,
    dryRun,
    userSkills as never,
  );

  return { compiler, dryRun, controller, userSkills };
}

async function writeFixture(
  tempDir: string,
  data: { events: OpenCodeEvent[]; sessionName?: string; name?: string; title?: string },
): Promise<string> {
  const filePath = join(tempDir, 'session.json');
  await writeFile(filePath, JSON.stringify(data), 'utf8');
  return filePath;
}

function stripeSession(): { events: OpenCodeEvent[]; sessionName: string } {
  return {
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
  };
}

function paypalSession(): { events: OpenCodeEvent[]; sessionName: string } {
  return {
    sessionName: 'PayPal Invoice Fetch',
    events: [
      { type: 'message_start', messageId: 'm2' },
      {
        type: 'content_block_delta',
        blockType: 'text',
        delta: 'Fetch PayPal invoices for accounting@example.com',
        messageId: 'm2',
      },
      {
        type: 'file_edit',
        path: 'src/paypal.ts',
        operation: 'write',
        content: 'const url = "https://api.paypal.com/v2"; const key = "sk_live_paypal456";',
        messageId: 'm2',
      },
      { type: 'message_stop', messageId: 'm2', stopReason: 'end_turn' },
    ],
  };
}

function emptySession(): { events: OpenCodeEvent[]; sessionName: string } {
  return {
    sessionName: 'Empty Session',
    events: [],
  };
}

function noParamsSession(): { events: OpenCodeEvent[]; sessionName: string } {
  return {
    sessionName: 'Generic Chat',
    events: [
      { type: 'message_start', messageId: 'm3' },
      {
        type: 'content_block_delta',
        blockType: 'text',
        delta: 'Hello, how can I help you today?',
        messageId: 'm3',
      },
      { type: 'message_stop', messageId: 'm3', stopReason: 'end_turn' },
    ],
  };
}

test('happy path: compile OpenCode session → publish → dry-run', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-'));
  try {
    const { compiler, dryRun, controller, userSkills } = createPipeline();
    const fixture = stripeSession();
    const fixturePath = await writeFixture(tempDir, fixture);

    const compileResult = await compiler.compile({
      sessionId: 'sess-stripe-001',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: fixturePath,
    });

    const skill = await userSkills.getBySlug(compileResult.skill.slug!);
    assert.ok(skill);
    assert.equal(skill.title, 'Stripe Weekly Report');
    assert.equal(skill.sourceSessionId, 'sess-stripe-001');
    assert.equal(skill.kind, 'workflow_template');
    assert.deepEqual(skill.tags, ['compiled', 'opencode']);
    assert.equal(skill.visibility, 'private');

    assert.ok(skill.inputsSchema);
    assert.ok(skill.inputsSchema.properties);
    assert.ok(skill.outputsSchema);
    assert.ok(skill.outputsSchema.properties);

    assert.ok(compileResult.report.graphStats.nodes > 0);
    assert.ok(compileResult.report.graphStats.edges > 0);
    assert.ok(compileResult.report.estimatedCost > 0);

    const paramNames = compileResult.report.parameters.map((p) => p.name).sort();
    assert.ok(paramNames.length > 0);
    assert.ok(paramNames.includes('stripe_api_key'));
    assert.ok(paramNames.includes('email_address'));

    const validInputs: Record<string, unknown> = {};
    for (const param of compileResult.report.parameters) {
      validInputs[param.name] = param.isSecret ? 'fake-secret' : param.suggestedDefault || 'test-value';
    }

    const dryRunResult = dryRun.validate(skill, validInputs, 'strict');
    assert.equal(dryRunResult.overall, 'PASS');
    assert.equal(dryRunResult.checks.parametric, 'PASS');
    assert.equal(dryRunResult.checks.schema, 'PASS');
    assert.equal(dryRunResult.checks.graph, 'PASS');
    assert.equal(dryRunResult.errors.length, 0);

    const controllerResult = await controller.dryRun({
      skillId: skill.slug,
      inputs: validInputs,
      mode: 'strict',
    });
    assert.equal(controllerResult.success, true);
    assert.equal(controllerResult.data.overall, 'PASS');

    const missingInputResult = dryRun.validate(skill, {}, 'strict');
    assert.equal(missingInputResult.overall, 'FAIL');
    assert.equal(missingInputResult.checks.parametric, 'FAIL');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('failure: empty session is rejected', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-empty-'));
  try {
    const { compiler } = createPipeline();
    const fixture = emptySession();
    const fixturePath = await writeFixture(tempDir, fixture);

    await assert.rejects(
      () =>
        compiler.compile({
          sessionId: 'sess-empty-001',
          agentType: 'opencode',
          mode: 'publish',
          sessionData: fixturePath,
        }),
      (err: unknown) =>
        /SKILL_COMPILER_EMPTY_SESSION/.test(String((err as Error).message)),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('failure: no parameterizable values → empty parameter list', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-noparams-'));
  try {
    const { compiler, dryRun, userSkills } = createPipeline();
    const fixture = noParamsSession();
    const fixturePath = await writeFixture(tempDir, fixture);

    const result = await compiler.compile({
      sessionId: 'sess-noparams-001',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: fixturePath,
    });

    assert.equal(result.report.parameters.length, 0);
    assert.ok(
      !result.report.warnings.some((w) => /draft mode/i.test(w)),
      'Publish mode should not have draft warning',
    );

    const skill = await userSkills.getBySlug(result.skill.slug!);
    assert.ok(skill);

    assert.deepEqual(
      result.skill.inputsSchema?.required ?? [],
      [],
      'No required inputs when no parameters detected',
    );

    const dryRunResult = dryRun.validate(skill, {}, 'strict');
    assert.equal(dryRunResult.overall, 'PASS');
    assert.equal(dryRunResult.checks.parametric, 'PASS');
    assert.equal(dryRunResult.checks.schema, 'PASS');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('skill runs with different parameters (Stripe vs PayPal)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-params-'));
  try {
    const { compiler, dryRun, userSkills } = createPipeline();

    const stripeFixture = stripeSession();
    const stripePath = await writeFixture(tempDir, stripeFixture);
    const stripeResult = await compiler.compile({
      sessionId: 'sess-stripe-002',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: stripePath,
    });
    const stripeSkill = await userSkills.getBySlug(stripeResult.skill.slug!);

    const paypalFixture = paypalSession();
    const paypalPath = await writeFixture(tempDir, paypalFixture);
    const paypalResult = await compiler.compile({
      sessionId: 'sess-paypal-002',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: paypalPath,
    });
    const paypalSkill = await userSkills.getBySlug(paypalResult.skill.slug!);

    assert.notEqual(stripeSkill.slug, paypalSkill.slug);

    const stripeParams = stripeResult.report.parameters.map((p) => p.name).sort();
    const paypalParams = paypalResult.report.parameters.map((p) => p.name).sort();
    assert.ok(stripeParams.includes('stripe_api_key'));
    assert.ok(paypalParams.includes('paypal_api_key'));

    const stripeInputs: Record<string, unknown> = {};
    for (const param of stripeResult.report.parameters) {
      stripeInputs[param.name] = param.isSecret ? 'sk_live_stripe_test' : param.suggestedDefault || 'stripe-test-value';
    }
    const stripeDryRun = dryRun.validate(stripeSkill, stripeInputs, 'strict');
    assert.equal(stripeDryRun.overall, 'PASS');

    const paypalInputs: Record<string, unknown> = {};
    for (const param of paypalResult.report.parameters) {
      paypalInputs[param.name] = param.isSecret ? 'sk_live_paypal_test' : param.suggestedDefault || 'paypal-test-value';
    }
    const paypalDryRun = dryRun.validate(paypalSkill, paypalInputs, 'strict');
    assert.equal(paypalDryRun.overall, 'PASS');

    const stripeWithPaypalInputs = dryRun.validate(stripeSkill, paypalInputs, 'strict');
    assert.equal(stripeWithPaypalInputs.overall, 'FAIL');

    const allSkills = userSkills.list();
    assert.equal(allSkills.length, 2);
    assert.ok(allSkills.some((s) => s.title === 'Stripe Weekly Report'));
    assert.ok(allSkills.some((s) => s.title === 'PayPal Invoice Fetch'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('preview endpoint returns draft without persisting', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-preview-'));
  try {
    const { controller, userSkills } = createPipeline();
    const fixture = stripeSession();
    const fixturePath = await writeFixture(tempDir, fixture);

    const result = await controller.compile({
      sessionId: 'sess-preview-001',
      agentType: 'opencode',
      mode: 'draft',
      sessionData: fixturePath,
    });

    assert.equal(result.success, true);
    assert.ok(result.data.skill.slug);
    assert.ok(result.data.report.warnings.some((w) => /draft mode/i.test(w)));

    assert.equal(userSkills.list().length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('compile rejects unsupported agent type', async () => {
  const { compiler } = createPipeline();

  await assert.rejects(
    () =>
      compiler.compile({
        sessionId: 'sess-bad-agent',
        agentType: 'unsupported' as never,
        mode: 'draft',
        sessionData: '/tmp/fake.json',
      }),
      (err: unknown) =>
        /SKILL_COMPILER_UNSUPPORTED_AGENT/.test(String((err as Error).message)),
  );
});

test('compile rejects unsupported mode', async () => {
  const { compiler } = createPipeline();

  await assert.rejects(
    () =>
      compiler.compile({
        sessionId: 'sess-bad-mode',
        agentType: 'opencode',
        mode: 'unsupported' as never,
        sessionData: '/tmp/fake.json',
      }),
      (err: unknown) =>
        /SKILL_COMPILER_UNSUPPORTED_MODE/.test(String((err as Error).message)),
  );
});

test('compile rejects missing session data', async () => {
  const { compiler } = createPipeline();

  await assert.rejects(
    () =>
      compiler.compile({
        sessionId: 'sess-no-data',
        agentType: 'opencode',
        mode: 'draft',
      }),
      (err: unknown) =>
        /SKILL_COMPILER_SESSION_DATA_REQUIRED/.test(String((err as Error).message)),
  );
});

test('dry-run detects schema type mismatch', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-schema-'));
  try {
    const { compiler, dryRun, userSkills } = createPipeline();
    const fixture = stripeSession();
    const fixturePath = await writeFixture(tempDir, fixture);

    const result = await compiler.compile({
      sessionId: 'sess-schema-001',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: fixturePath,
    });
    const skill = await userSkills.getBySlug(result.skill.slug!);

    const stringParam = result.report.parameters.find(
      (p) => p.inferredType === 'string' && !p.isSecret,
    );
    if (stringParam) {
      const badInputs: Record<string, unknown> = {};
      for (const param of result.report.parameters) {
        badInputs[param.name] = param.name === stringParam.name ? 42 : 'valid-string';
      }
      const badResult = dryRun.validate(skill, badInputs, 'strict');
      assert.equal(badResult.checks.schema, 'FAIL');
      assert.ok(
        badResult.errors.some(
          (e) => e.check === 'schema' && e.field === stringParam.name,
        ),
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('dry-run detects dangling edge in corrupted graph', async () => {
  const { dryRun } = createPipeline();

  const skill: UserSkillRow = {
    id: 'skill-corrupt',
    slug: 'corrupt-skill',
    version: '1.0.0',
    title: 'Corrupt Skill',
    summary: 'Test',
    icon: null,
    category: null,
    tags: [],
    inputsSchema: {},
    outputsSchema: {},
    kind: 'workflow_template',
    promptText: null,
    graphJson: {
      version: 1,
      id: 'sess-corrupt',
      createdAt: '2026-04-22T10:00:00.000Z',
      nodes: [
        {
          id: 'n1',
          type: 'agent_step',
          createdAt: '2026-04-22T10:00:00.000Z',
          updatedAt: '2026-04-22T10:00:00.000Z',
          content: {},
          creator: { type: 'agent', agentType: 'opencode', agentId: 'test' },
          position: { x: 0, y: 0 },
          dimensions: { width: 0, height: 0 },
          metadata: {},
          status: 'active',
          branches: [],
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'missing-node',
          relation: 'spawns',
          direction: 'source_to_target',
          strength: 1,
          createdAt: '2026-04-22T10:00:00.000Z',
          creator: { type: 'agent', agentType: 'opencode', agentId: 'test' },
          metadata: {},
        },
      ],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as Record<string, unknown>,
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

  const result = dryRun.validate(skill, {});
  assert.equal(result.checks.graph, 'FAIL');
  assert.ok(result.errors.some((e) => e.message.includes('Dangling edge')));
});

test('dry-run permissive mode passes with extra inputs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'skill-compiler-e2e-perm-'));
  try {
    const { compiler, dryRun, userSkills } = createPipeline();
    const fixture = noParamsSession();
    const fixturePath = await writeFixture(tempDir, fixture);

    const result = await compiler.compile({
      sessionId: 'sess-perm-001',
      agentType: 'opencode',
      mode: 'publish',
      sessionData: fixturePath,
    });
    const skill = await userSkills.getBySlug(result.skill.slug!);

    skill.inputsSchema = { ...skill.inputsSchema, additionalProperties: true };

    const permissiveResult = dryRun.validate(skill, { unexpectedField: 'value' }, 'permissive');
    assert.equal(permissiveResult.overall, 'PASS');
    assert.ok(permissiveResult.warnings.some((w) => w.includes('unexpectedField')));

    const strictResult = dryRun.validate(skill, { unexpectedField: 'value' }, 'strict');
    assert.equal(strictResult.overall, 'FAIL');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('graph integrity: empty graph warns but passes', async () => {
  const { dryRun } = createPipeline();

  const skill: UserSkillRow = {
    id: 'skill-empty-graph',
    slug: 'empty-graph-skill',
    version: '1.0.0',
    title: 'Empty Graph',
    summary: 'Test',
    icon: null,
    category: null,
    tags: [],
    inputsSchema: {},
    outputsSchema: {},
    kind: 'workflow_template',
    promptText: null,
    graphJson: {
      version: 1,
      id: 'sess-empty',
      createdAt: '2026-04-22T10:00:00.000Z',
      nodes: [],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as Record<string, unknown>,
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

  const result = dryRun.validate(skill, {});
  assert.equal(result.checks.graph, 'PASS');
  assert.ok(result.warnings.some((w) => /no nodes/i.test(w)));
});
