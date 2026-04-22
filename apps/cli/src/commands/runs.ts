import { parseArgs } from 'node:util';

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

const SUBCOMMAND_USAGE = `Usage:
  cepage runs list [--skill <slug>] [--limit <n>]
  cepage runs get <id>
  cepage runs cancel <id>
  cepage runs stream <id>
`;

export async function runsCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
      return listRuns(rest, flags);
    case 'get':
      return getRun(rest, flags);
    case 'cancel':
      return cancelRun(rest, flags);
    case 'stream':
      return streamRun(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown runs subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function listRuns(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      skill: { type: 'string' },
      limit: { type: 'string' },
    },
    strict: true,
  });
  const limit = parsed.values.limit ? Number.parseInt(String(parsed.values.limit), 10) : undefined;
  if (parsed.values.limit && (!Number.isFinite(limit) || limit === undefined || limit <= 0)) {
    throw new UsageError(`invalid --limit value "${parsed.values.limit}"`);
  }
  const ctx = await createContext(flags);
  const runs = await ctx.client.runs.list({
    skillId: parsed.values.skill as string | undefined,
    limit,
  });
  if (flags.json) {
    emitJson(runs);
    return 0;
  }
  if (runs.length === 0) {
    emitLine('No runs yet.');
    return 0;
  }
  const rows = runs.map((r) => ({
    id: r.id,
    status: r.status,
    skill: r.skillId,
    started: formatDate(r.startedAt ?? r.createdAt),
    duration: r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : '',
  }));
  emitLine(renderTable(rows, ['id', 'status', 'skill', 'started', 'duration']));
  return 0;
}

async function getRun(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('runs get requires a run id');
  const ctx = await createContext(flags);
  const run = await ctx.client.runs.get(id);
  if (flags.json) {
    emitJson(run);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(emitStatus(`${run.status}`, statusTone(run.status), colors));
  emitLine(`id: ${run.id}`);
  emitLine(`skill: ${run.skillId}${run.skillVersion ? `@${run.skillVersion}` : ''}`);
  emitLine(`trigger: ${run.triggeredBy ?? 'unknown'}`);
  emitLine(`created: ${formatDate(run.createdAt)}`);
  if (run.startedAt) emitLine(`started: ${formatDate(run.startedAt)}`);
  if (run.finishedAt) emitLine(`finished: ${formatDate(run.finishedAt)}`);
  if (run.durationMs != null) emitLine(`duration: ${(run.durationMs / 1000).toFixed(2)}s`);
  emitLine();
  emitLine(colors.bold('Inputs'));
  emitLine(JSON.stringify(run.inputs ?? {}, null, 2));
  if (run.outputs) {
    emitLine();
    emitLine(colors.bold('Outputs'));
    emitLine(JSON.stringify(run.outputs, null, 2));
  }
  if (run.error) {
    emitLine();
    emitLine(colors.red(`error (${run.error.code}): ${run.error.message}`));
  }
  return run.status === 'succeeded' ? 0 : run.status === 'failed' ? 1 : 0;
}

async function cancelRun(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('runs cancel requires a run id');
  const ctx = await createContext(flags);
  const run = await ctx.client.runs.cancel(id);
  if (flags.json) {
    emitJson(run);
  } else {
    const colors = makeColors(flags.color);
    emitLine(emitStatus(`cancelled ${trim(run.id, 24)}`, 'warn', colors));
  }
  return 0;
}

async function streamRun(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('runs stream requires a run id');
  const ctx = await createContext(flags);
  const colors = makeColors(flags.color);
  for await (const event of ctx.client.runs.stream(id)) {
    if (flags.json) {
      emitJson(event);
      continue;
    }
    const dataPreview =
      typeof event.data === 'object' && event.data !== null
        ? JSON.stringify(event.data)
        : String(event.data ?? '');
    emitLine(`${colors.dim(new Date().toISOString())} ${colors.cyan(event.type)} ${dataPreview}`);
    if (event.type === 'succeeded' || event.type === 'failed' || event.type === 'cancelled') break;
  }
  return 0;
}
