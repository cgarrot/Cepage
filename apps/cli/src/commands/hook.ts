import { execSync } from 'node:child_process';
import { access, chmod, constants, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import { emitJson, emitLine, makeColors } from '../output.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage hook install claude-code [--uninstall]
`;

export async function hookCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'install':
      return installHook(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown hook subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function installHook(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      uninstall: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: true,
  });

  const agentType = parsed.positionals[0];
  if (!agentType) {
    throw new UsageError('missing agent type', { hint: SUBCOMMAND_USAGE });
  }
  if (agentType !== 'claude-code') {
    throw new UsageError('only "claude-code" hooks are supported');
  }

  const ctx = await createContext(flags);
  const hookDir = join(homedir(), '.claude', 'hooks');
  const hookPath = join(hookDir, 'cepage-compile.sh');

  if (parsed.values.uninstall === true) {
    try {
      await rm(hookPath);
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') throw err;
    }

    if (flags.json) {
      emitJson({ uninstalled: true, path: hookPath });
      return 0;
    }

    const colors = makeColors(flags.color);
    emitLine(`${colors.green('●')} uninstalled ${colors.dim(hookPath)}`);
    return 0;
  }

  try {
    execSync('command -v claude', { encoding: 'utf8' });
  } catch {
    throw new UsageError('claude CLI not found in PATH');
  }

  await mkdir(hookDir, { recursive: true });

  const script = buildHookScript(ctx.config.apiUrl);
  await writeFile(hookPath, script, { mode: 0o755 });

  try {
    await access(hookPath, constants.X_OK);
  } catch {
    await chmod(hookPath, 0o755);
  }

  if (flags.json) {
    emitJson({ installed: true, agent: agentType, apiUrl: ctx.config.apiUrl, path: hookPath });
    return 0;
  }

  const colors = makeColors(flags.color);
  emitLine(`${colors.green('●')} installed hook for ${agentType}`);
  emitLine(`  ${colors.dim(hookPath)}`);
  return 0;
}

function buildHookScript(apiUrl: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SESSION_DIR="\${1:-}"
if [ -z "$SESSION_DIR" ]; then
  echo "usage: $0 <session-directory>" >&2
  exit 2
fi

SESSION_ID="$(basename "$SESSION_DIR")"
TMP_TGZ="$(mktemp).tar.gz"
trap 'rm -f "$TMP_TGZ"' EXIT

tar -czf "$TMP_TGZ" -C "$(dirname "$SESSION_DIR")" "$(basename "$SESSION_DIR")"

API_URL="\${CEPAGE_API_URL:-${apiUrl}}"
TOKEN="\${CEPAGE_TOKEN:-}"

curl -fsSL \\
  -H "Authorization: Bearer \${TOKEN}" \\
  -F "sessionId=\${SESSION_ID}" \\
  -F "agentType=claude_code" \\
  -F "mode=publish" \\
  -F "sessionData=@\${TMP_TGZ};filename=session.tar.gz" \\
  "\${API_URL}/skill-compiler/compile"

echo "Skill compiled successfully."
`;
}
