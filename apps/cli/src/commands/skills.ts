import { parseArgs } from 'node:util';

import { CepageHttpError, CepageValidationError } from '@cepage/sdk';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import {
  emitJson,
  emitLine,
  emitStatus,
  formatDate,
  makeColors,
  renderTable,
  statusTone,
  trim,
} from '../output.js';
import { parseInputs } from '../parse-inputs.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage skills list [--kind workflow|prompt_only|workflow_template]
  cepage skills get <slug>
  cepage skills run <slug> [--input key=value]... [--inputs-file path] [--no-wait]
  cepage skills dry-run <slug> [--input key=value]... [--inputs-file path]
`;

export async function skillsCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
      return listSkills(rest, flags);
    case 'get':
      return getSkill(rest, flags);
    case 'run':
      return runSkill(rest, flags);
    case 'dry-run':
      return dryRun(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown skills subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function listSkills(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: { kind: { type: 'string', multiple: true } },
    strict: true,
  });
  const ctx = await createContext(flags);
  const skills = await ctx.client.skills.list({ kind: parsed.values.kind });

  if (flags.json) {
    emitJson(skills);
    return 0;
  }
  if (skills.length === 0) {
    emitLine('No skills found.');
    return 0;
  }
  const rows = skills.map((s) => ({
    id: s.id,
    kind: s.kind ?? 'workflow',
    title: trim(s.title, 40),
    summary: trim(s.summary, 80),
  }));
  emitLine(renderTable(rows, ['id', 'kind', 'title', 'summary']));
  return 0;
}

async function getSkill(argv: string[], flags: GlobalFlags): Promise<number> {
  const slug = argv[0];
  if (!slug) throw new UsageError('skills get requires a skill slug');
  const ctx = await createContext(flags);
  const skill = await ctx.client.skills.get(slug);

  if (flags.json) {
    emitJson(skill);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(colors.bold(`${skill.title}  ${colors.dim(`(${skill.id})`)}`));
  if (skill.summary) emitLine(skill.summary);
  emitLine();
  emitLine(`${colors.dim('version')}: ${skill.version ?? 'n/a'}`);
  emitLine(`${colors.dim('kind')}: ${skill.kind}`);
  if (skill.category) emitLine(`${colors.dim('category')}: ${skill.category}`);
  if (skill.tags?.length) emitLine(`${colors.dim('tags')}: ${skill.tags.join(', ')}`);
  if (skill.inputsSchema) {
    emitLine();
    emitLine(colors.bold('Inputs schema'));
    emitLine(JSON.stringify(skill.inputsSchema, null, 2));
  }
  if (skill.outputsSchema) {
    emitLine();
    emitLine(colors.bold('Outputs schema'));
    emitLine(JSON.stringify(skill.outputsSchema, null, 2));
  }
  return 0;
}

async function runSkill(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', multiple: true },
      'inputs-file': { type: 'string' },
      'no-wait': { type: 'boolean' },
      'idempotency-key': { type: 'string' },
      'correlation-id': { type: 'string' },
      timeout: { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  const slug = parsed.positionals[0];
  if (!slug) throw new UsageError('skills run requires a skill slug');

  const { inputs } = await parseInputs({
    inputsFile: parsed.values['inputs-file'] as string | undefined,
    rawInputs: (parsed.values.input as string[] | undefined) ?? [],
  });

  const timeoutMs = parsed.values.timeout
    ? Number.parseInt(String(parsed.values.timeout), 10) * 1000
    : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new UsageError(`invalid --timeout value "${parsed.values.timeout}"`);
  }

  const ctx = await createContext(flags);
  const colors = makeColors(flags.color);

  try {
    const run = await ctx.client.skills.run(slug, {
      inputs,
      triggeredBy: 'cli',
      idempotencyKey: parsed.values['idempotency-key'] as string | undefined,
      correlationId: parsed.values['correlation-id'] as string | undefined,
      wait: parsed.values['no-wait'] !== true,
      timeoutMs,
    });
    if (flags.json) {
      emitJson(run);
    } else {
      emitLine(emitStatus(`${run.status}`, statusTone(run.status), colors));
      emitLine(`run id: ${run.id}`);
      if (run.outputs) {
        emitLine();
        emitLine(colors.bold('Outputs'));
        emitLine(JSON.stringify(run.outputs, null, 2));
      }
      if (run.error) {
        emitLine();
        emitLine(colors.red(`error: ${run.error.message} (${run.error.code})`));
      }
    }
    return run.status === 'succeeded' || run.status === 'queued' || run.status === 'running'
      ? 0
      : 1;
  } catch (err) {
    if (err instanceof CepageValidationError) {
      const code = typeof err.body === 'object' && err.body ? err.body.code : undefined;
      if (flags.json) {
        emitJson({ error: { code, message: err.message, errors: err.errors } });
      } else {
        process.stderr.write(colors.red(`input validation failed:\n`));
        for (const detail of err.errors) {
          process.stderr.write(`  - ${detail.path ?? ''}: ${detail.message ?? ''}\n`);
        }
      }
      return 1;
    }
    throw err;
  }
}

async function dryRun(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', multiple: true },
      'inputs-file': { type: 'string' },
      mode: { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  const slug = parsed.positionals[0];
  if (!slug) throw new UsageError('skills dry-run requires a skill slug');

  const { inputs } = await parseInputs({
    inputsFile: parsed.values['inputs-file'] as string | undefined,
    rawInputs: (parsed.values.input as string[] | undefined) ?? [],
  });

  const mode = parsed.values.mode;
  if (
    mode !== undefined &&
    mode !== 'strict' &&
    mode !== 'permissive'
  ) {
    throw new UsageError(`invalid --mode value "${mode}" (expected "strict" or "permissive")`);
  }

  const ctx = await createContext(flags);
  const colors = makeColors(flags.color);

  try {
    const report = await ctx.client.http.request<{
      overall: 'PASS' | 'FAIL';
      checks: Record<string, 'PASS' | 'FAIL'>;
      warnings: string[];
      errors: Array<{ check: string; field?: string; message: string }>;
      estimatedCost: number;
    }>('POST', '/skill-compiler/dry-run', {
      body: {
        skillId: slug,
        inputs,
        mode,
      } as unknown,
    });

    if (flags.json) {
      emitJson(report);
      return report.overall === 'PASS' ? 0 : 1;
    }

    const overallTone = report.overall === 'PASS' ? 'ok' : 'err';
    emitLine(emitStatus(report.overall, overallTone, colors));

    if (Object.keys(report.checks).length > 0) {
      emitLine();
      for (const [name, result] of Object.entries(report.checks)) {
        const checkTone = result === 'PASS' ? 'ok' : 'err';
        emitLine(`  ${emitStatus(result, checkTone, colors)}  ${name}`);
      }
    }

    if (report.warnings.length > 0) {
      emitLine();
      emitLine(colors.yellow(`${report.warnings.length} warning(s)`));
      for (const w of report.warnings) {
        emitLine(`  - ${w}`);
      }
    }

    if (report.errors.length > 0) {
      emitLine();
      emitLine(colors.red(`${report.errors.length} error(s)`));
      for (const e of report.errors) {
        emitLine(`  - ${e.check}${e.field ? ` (${e.field})` : ''}: ${e.message}`);
      }
    }

    if (report.estimatedCost > 0) {
      emitLine();
      emitLine(`${colors.dim('estimated cost')}: ${report.estimatedCost}`);
    }

    return report.overall === 'PASS' ? 0 : 1;
  } catch (err) {
    if (err instanceof CepageHttpError && err.status === 404) {
      if (flags.json) {
        emitJson({ error: { code: 'SKILL_NOT_FOUND', message: err.message } });
      } else {
        process.stderr.write(colors.red(`skill not found: ${slug}\n`));
      }
      return 1;
    }
    throw err;
  }
}

export async function formatRunHeader(runId: string, createdAt?: string): Promise<string> {
  return `run ${runId}  ${formatDate(createdAt)}`.trim();
}
