import { parseArgs } from 'node:util';

import type { GlobalFlags } from '../main.js';
import {
  clearStoredConfig,
  configPath,
  loadStoredConfig,
  saveStoredConfig,
  DEFAULT_API_URL,
} from '../config.js';
import { UsageError } from '../errors.js';
import { emitJson, emitLine, makeColors } from '../output.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage auth login [--api-url <url>] [--token <token>]
  cepage auth logout
`;

export async function authCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'login':
      return login(rest, flags);
    case 'logout':
      return logout(flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown auth subcommand "${sub}"`, { hint: SUBCOMMAND_USAGE });
  }
}

async function login(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      'api-url': { type: 'string' },
      token: { type: 'string' },
    },
    strict: true,
  });

  const stored = await loadStoredConfig();
  const apiUrl =
    (parsed.values['api-url'] as string | undefined) ?? flags.apiUrl ?? stored.apiUrl ?? DEFAULT_API_URL;
  const token = (parsed.values.token as string | undefined) ?? flags.token ?? stored.token;

  const target = await saveStoredConfig({ apiUrl, token });

  if (flags.json) {
    emitJson({ configPath: target, apiUrl, tokenSet: Boolean(token) });
    return 0;
  }
  const colors = makeColors(flags.color);
  emitLine(`${colors.green('●')} saved ${target}`);
  emitLine(`api url: ${apiUrl}`);
  emitLine(`token: ${token ? colors.dim('(stored)') : colors.yellow('(not set)')}`);
  return 0;
}

async function logout(flags: GlobalFlags): Promise<number> {
  const removed = await clearStoredConfig();
  if (flags.json) {
    emitJson({ removed, configPath: configPath() });
    return 0;
  }
  emitLine(removed ? `removed ${configPath()}` : `no config file at ${configPath()}`);
  return 0;
}
