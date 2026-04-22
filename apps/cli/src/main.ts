import { parseArgs } from 'node:util';

import { skillsCommand } from './commands/skills.js';
import { runsCommand } from './commands/runs.js';
import { schedulesCommand } from './commands/schedules.js';
import { webhooksCommand } from './commands/webhooks.js';
import { authCommand } from './commands/auth.js';
import { configCommand } from './commands/config.js';
import { UsageError } from './errors.js';

const USAGE = `cepage — run and manage your Cepage skills.

Usage:
  cepage <command> [subcommand] [options]

Commands:
  skills list              List available skills (filesystem + user)
  skills get <slug>        Show a skill's schema and metadata
  skills run <slug>        Run a skill. Accepts --input key=value, --inputs-file path
  runs list                List recent skill runs
  runs get <id>            Show a run's inputs/outputs/status
  runs cancel <id>         Cancel an in-flight run
  runs stream <id>         Tail SSE events for a run
  schedules list           List scheduled skill runs
  schedules create         Create a schedule (--skill, --cron, --inputs-file, --label)
  schedules delete <id>    Delete a schedule
  schedules run-now <id>   Force-run a schedule now
  webhooks list            List webhook subscriptions
  webhooks create          Create a webhook (--url, --event, --skill)
  webhooks delete <id>     Delete a webhook
  webhooks ping <id>       Send a test delivery (webhook.ping)
  webhooks rotate-secret <id>
                           Rotate the HMAC signing secret
  auth login               Save API URL + token to ~/.cepage/config.json
  auth logout              Remove the saved config
  config                   Print the effective config (tokens are redacted)

Global options:
  --api-url <url>          Override API base URL (default: http://localhost:31947/api/v1)
  --token <token>          Override API token
  --json                   Emit machine-readable JSON instead of formatted text
  --no-color               Disable ANSI colour output
  -h, --help               Show this help

Env overrides (take precedence over ~/.cepage/config.json):
  CEPAGE_API_URL, CEPAGE_TOKEN, CEPAGE_NO_COLOR, NO_COLOR
`;

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    const { VERSION } = await import('./version.js');
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Strip well-known global flags so subcommands don't have to.
  const { values: globalValues, remaining } = extractGlobals(argv);

  const [command, ...rest] = remaining;
  try {
    switch (command) {
      case 'skills':
        return await skillsCommand(rest, globalValues);
      case 'runs':
        return await runsCommand(rest, globalValues);
      case 'schedules':
        return await schedulesCommand(rest, globalValues);
      case 'webhooks':
        return await webhooksCommand(rest, globalValues);
      case 'auth':
        return await authCommand(rest, globalValues);
      case 'config':
        return await configCommand(rest, globalValues);
      default:
        process.stderr.write(`cepage: unknown command "${command ?? ''}"\n\n`);
        process.stderr.write(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`cepage: ${err.message}\n`);
      if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

export interface GlobalFlags {
  apiUrl?: string;
  token?: string;
  json: boolean;
  color: boolean;
}

function extractGlobals(argv: string[]): { values: GlobalFlags; remaining: string[] } {
  // We use parseArgs with ``strict: false`` to pluck only the global flags
  // we know about and leave the rest for subcommand parsers.
  const { values, tokens } = parseArgs({
    args: argv,
    options: {
      'api-url': { type: 'string' },
      token: { type: 'string' },
      json: { type: 'boolean' },
      color: { type: 'boolean', default: true },
      'no-color': { type: 'boolean' },
    },
    strict: false,
    tokens: true,
    allowPositionals: true,
  });

  const consumed = new Set<number>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (
      token.name === 'api-url' ||
      token.name === 'token' ||
      token.name === 'json' ||
      token.name === 'no-color' ||
      token.name === 'color'
    ) {
      consumed.add(token.index);
      if (token.inlineValue === false && typeof token.value === 'string') {
        // The value lives in the next argv slot for non-inline long options.
        consumed.add(token.index + 1);
      }
    }
  }

  const remaining = argv.filter((_, idx) => !consumed.has(idx));
  const colorEnabled =
    values['no-color'] === true
      ? false
      : process.env.NO_COLOR || process.env.CEPAGE_NO_COLOR
        ? false
        : values.color !== false;

  return {
    values: {
      apiUrl: typeof values['api-url'] === 'string' ? (values['api-url'] as string) : undefined,
      token: typeof values.token === 'string' ? (values.token as string) : undefined,
      json: values.json === true,
      color: colorEnabled,
    },
    remaining,
  };
}
