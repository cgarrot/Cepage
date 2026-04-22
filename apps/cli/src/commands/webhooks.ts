import { parseArgs } from 'node:util';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import { emitJson, emitLine, formatDate, makeColors, renderTable } from '../output.js';

// Keep this usage banner in sync with `apps/cli/README.md` and the
// rendered tables below. Each subcommand prints the same banner on
// `--help` so `cepage webhooks <cmd> --help` always works.
const SUBCOMMAND_USAGE = `Usage:
  cepage webhooks list
  cepage webhooks get <id>
  cepage webhooks create --url <url> [--event evt]... [--skill <slug>] [--description <text>] [--inactive]
  cepage webhooks update <id> [--url <url>] [--event evt]... [--description <text>] [--active|--inactive] [--rotate-secret]
  cepage webhooks delete <id>
  cepage webhooks ping <id>
  cepage webhooks rotate-secret <id>
`;

export async function webhooksCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
      return listWebhooks(rest, flags);
    case 'get':
      return getWebhook(rest, flags);
    case 'create':
      return createWebhook(rest, flags);
    case 'update':
      return updateWebhook(rest, flags);
    case 'delete':
      return deleteWebhook(rest, flags);
    case 'ping':
      return pingWebhook(rest, flags);
    case 'rotate-secret':
      return rotateSecret(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown webhooks subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function listWebhooks(_argv: string[], flags: GlobalFlags): Promise<number> {
  const ctx = await createContext(flags);
  const items = await ctx.client.webhooks.list();
  if (flags.json) {
    emitJson(items);
    return 0;
  }
  if (items.length === 0) {
    emitLine('No webhooks yet. Create one with `cepage webhooks create --url ...`.');
    return 0;
  }
  const rows = items.map((w) => ({
    id: w.id,
    active: w.active ? 'yes' : 'no',
    url: w.url,
    events: (w.events ?? []).join(', ') || '*',
    skill: w.skillId ?? '(all)',
    created: formatDate(w.createdAt),
  }));
  emitLine(renderTable(rows, ['id', 'active', 'url', 'events', 'skill', 'created']));
  return 0;
}

async function getWebhook(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('webhooks get requires an id');
  const ctx = await createContext(flags);
  const wh = await ctx.client.webhooks.get(id);
  if (flags.json) {
    emitJson(wh);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(`${colors.bold(wh.id)}  ${wh.active ? colors.green('active') : colors.dim('inactive')}`);
  emitLine(`  url:         ${wh.url}`);
  emitLine(`  events:      ${(wh.events ?? []).join(', ') || '*'}`);
  emitLine(`  skill:       ${wh.skillId ?? '(all)'}`);
  emitLine(`  description: ${wh.description ?? ''}`);
  emitLine(`  created:     ${formatDate(wh.createdAt)}`);
  emitLine(`  updated:     ${formatDate(wh.updatedAt)}`);
  return 0;
}

async function createWebhook(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      event: { type: 'string', multiple: true },
      skill: { type: 'string' },
      description: { type: 'string' },
      inactive: { type: 'boolean' },
      secret: { type: 'string' },
    },
    strict: true,
  });
  if (!parsed.values.url) throw new UsageError('webhooks create requires --url');
  const events = (parsed.values.event as string[] | undefined) ?? [];
  const ctx = await createContext(flags);
  const created = await ctx.client.webhooks.create({
    url: String(parsed.values.url),
    events: events.length > 0 ? events : undefined,
    skillId: parsed.values.skill ? String(parsed.values.skill) : null,
    description: parsed.values.description ? String(parsed.values.description) : undefined,
    active: parsed.values.inactive ? false : true,
    secret: parsed.values.secret ? String(parsed.values.secret) : undefined,
  });
  if (flags.json) {
    emitJson(created);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(`${colors.green('●')} created webhook ${colors.bold(created.id)}`);
  if (created.secret) {
    emitLine('');
    emitLine(
      colors.bold('Save this secret now — it will not be shown again:'),
    );
    emitLine(`  ${created.secret}`);
    emitLine('');
    emitLine(colors.dim('Use it to verify Cepage-Signature headers on incoming deliveries.'));
  }
  return 0;
}

async function updateWebhook(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('webhooks update requires an id');
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      url: { type: 'string' },
      event: { type: 'string', multiple: true },
      description: { type: 'string' },
      active: { type: 'boolean' },
      inactive: { type: 'boolean' },
      'rotate-secret': { type: 'boolean' },
    },
    strict: true,
  });

  if (parsed.values.active && parsed.values.inactive) {
    throw new UsageError('pass either --active or --inactive, not both');
  }

  const events = parsed.values.event as string[] | undefined;
  const ctx = await createContext(flags);
  // Keep the body narrow so we don't accidentally null out fields the
  // caller didn't mention. The service treats `undefined` as "leave
  // alone" and `null` as "clear" — we honour that here.
  const updated = await ctx.client.webhooks.update(id, {
    url: parsed.values.url ? String(parsed.values.url) : undefined,
    events: events && events.length > 0 ? events : undefined,
    description: parsed.values.description === undefined ? undefined : String(parsed.values.description),
    active: parsed.values.active ? true : parsed.values.inactive ? false : undefined,
    secretAction: parsed.values['rotate-secret'] ? 'rotate' : undefined,
  });
  if (flags.json) {
    emitJson(updated);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(`updated webhook ${colors.bold(updated.id)}`);
  if ('secret' in updated && typeof updated.secret === 'string' && updated.secret) {
    emitLine('');
    emitLine(colors.bold('New secret (save it now — shown once):'));
    emitLine(`  ${updated.secret}`);
  }
  return 0;
}

async function deleteWebhook(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('webhooks delete requires an id');
  const ctx = await createContext(flags);
  await ctx.client.webhooks.delete(id);
  if (flags.json) {
    emitJson({ deleted: id });
  } else {
    emitLine(`deleted ${id}`);
  }
  return 0;
}

async function pingWebhook(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('webhooks ping requires an id');
  const ctx = await createContext(flags);
  const result = await ctx.client.webhooks.ping(id);
  if (flags.json) {
    emitJson(result);
    return 0;
  }
  const colors = makeColors(flags.color);
  const statusColor =
    (result as { status?: string }).status === 'delivered' ? colors.green : colors.red;
  emitLine(
    `${statusColor((result as { status?: string }).status ?? 'unknown')}  id=${result.id ?? '—'}` +
      (typeof (result as { httpStatus?: number | null }).httpStatus === 'number'
        ? `  http=${(result as { httpStatus?: number }).httpStatus}`
        : ''),
  );
  return 0;
}

async function rotateSecret(argv: string[], flags: GlobalFlags): Promise<number> {
  const id = argv[0];
  if (!id) throw new UsageError('webhooks rotate-secret requires an id');
  const ctx = await createContext(flags);
  const rotated = await ctx.client.webhooks.rotateSecret(id);
  if (flags.json) {
    emitJson(rotated);
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(`${colors.green('●')} rotated secret for ${colors.bold(rotated.id)}`);
  emitLine('');
  emitLine(colors.bold('New secret (shown once):'));
  emitLine(`  ${rotated.secret}`);
  return 0;
}
