import { parseArgs } from 'node:util';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import { emitJson, emitLine, formatDate, makeColors, renderTable, trim } from '../output.js';
import { parseInputs } from '../parse-inputs.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage schedules list
  cepage schedules create --skill <slug> --cron <expr> [--inputs-file path] [--input k=v]... [--label text] [--status active|paused]
  cepage schedules update <id> [--cron <expr>] [--label text] [--status active|paused]
  cepage schedules delete <id>
  cepage schedules run-now <id>
`;

export async function schedulesCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
      return listSchedules(rest, flags);
    case 'create':
      return createSchedule(rest, flags);
    case 'update':
      return updateSchedule(rest, flags);
    case 'delete':
      return deleteSchedule(rest, flags);
    case 'run-now':
      return runNow(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown schedules subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function listSchedules(_argv: string[], flags: GlobalFlags): Promise<number> {
  const ctx = await createContext(flags);
  const items = await ctx.client.schedules.list();
  if (flags.json) {
    emitJson(items);
    return 0;
  }
  if (items.length === 0) {
    emitLine('No schedules yet.');
    return 0;
  }
  const rows = items.map((s) => ({
    id: s.id,
    status: s.status,
    skill: s.skillId,
    cron: s.cron,
    label: trim(s.label ?? '', 24),
    next: formatDate(s.nextRunAt),
    lastRun: formatDate(s.lastRunAt ?? ''),
  }));
  emitLine(renderTable(rows, ['id', 'status', 'skill', 'cron', 'label', 'next', 'lastRun']));
  return 0;
}

async function createSchedule(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      skill: { type: 'string' },
      cron: { type: 'string' },
      label: { type: 'string' },
      status: { type: 'string' },
      'inputs-file': { type: 'string' },
      input: { type: 'string', multiple: true },
    },
    strict: true,
  });

  if (!parsed.values.skill) throw new UsageError('schedules create requires --skill');
  if (!parsed.values.cron) throw new UsageError('schedules create requires --cron');

  const { inputs } = await parseInputs({
    inputsFile: parsed.values['inputs-file'] as string | undefined,
    rawInputs: (parsed.values.input as string[] | undefined) ?? [],
  });

  const status = parsed.values.status as 'active' | 'paused' | undefined;
  if (status && status !== 'active' && status !== 'paused') {
    throw new UsageError(`--status must be "active" or "paused", got "${status}"`);
  }

  const ctx = await createContext(flags);
  const created = await ctx.client.schedules.create({
    skillId: String(parsed.values.skill),
    cron: String(parsed.values.cron),
    label: parsed.values.label ? String(parsed.values.label) : undefined,
    status,
    request: { inputs, triggeredBy: 'schedule' },
  });

  if (flags.json) {
    emitJson(created);
  } else {
    const colors = makeColors(flags.color);
    emitLine(`${colors.green('●')} created schedule ${colors.bold(created.id)}`);
    emitLine(`next run: ${formatDate(created.nextRunAt)}`);
  }
  return 0;
}

async function updateSchedule(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('schedules update requires a schedule id');
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      cron: { type: 'string' },
      label: { type: 'string' },
      status: { type: 'string' },
    },
    strict: true,
  });
  const status = parsed.values.status as 'active' | 'paused' | undefined;
  if (status && status !== 'active' && status !== 'paused') {
    throw new UsageError(`--status must be "active" or "paused", got "${status}"`);
  }

  const ctx = await createContext(flags);
  const updated = await ctx.client.schedules.update(id, {
    cron: parsed.values.cron as string | undefined,
    label: parsed.values.label as string | undefined,
    status,
  });
  if (flags.json) {
    emitJson(updated);
  } else {
    emitLine(`updated ${updated.id} (status: ${updated.status})`);
  }
  return 0;
}

async function deleteSchedule(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('schedules delete requires a schedule id');
  const ctx = await createContext(flags);
  await ctx.client.schedules.delete(id);
  if (flags.json) {
    emitJson({ deleted: id });
  } else {
    emitLine(`deleted ${id}`);
  }
  return 0;
}

async function runNow(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('schedules run-now requires a schedule id');
  const ctx = await createContext(flags);
  const result = await ctx.client.schedules.runNow(id);
  if (flags.json) {
    emitJson(result);
  } else {
    emitLine(`triggered schedule ${id}`);
  }
  return 0;
}
