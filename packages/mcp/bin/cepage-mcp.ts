#!/usr/bin/env node
import { createCepageMcpServer } from '../src/server.js';

// Cepage MCP stdio binary. Wired from package.json → "bin": "cepage-mcp".
// Run via:
//   npx @cepage/mcp
//   npx @cepage/mcp --api http://localhost:31947 --token $CEPAGE_TOKEN
//   CEPAGE_URL=... CEPAGE_TOKEN=... CEPAGE_MCP_SKILL_FILTER=a,b npx @cepage/mcp

type ParsedArgs = {
  apiUrl?: string;
  token?: string | null;
  filter?: string[];
  timeoutMs?: number;
  help?: boolean;
  version?: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [flag, inlineValue] = raw.includes('=') ? raw.split('=', 2) : [raw, undefined];
    const next = () => inlineValue ?? argv[++i];
    switch (flag) {
      case '--api':
      case '--api-url':
      case '-a':
        out.apiUrl = next();
        break;
      case '--token':
      case '-t':
        out.token = next();
        break;
      case '--filter':
      case '-f':
        out.filter = (next() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--timeout':
        out.timeoutMs = Number(next());
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--version':
      case '-v':
        out.version = true;
        break;
      default:
        break;
    }
  }
  return out;
}

const HELP = `Cepage MCP stdio server

Usage:
  cepage-mcp [options]

Options:
  -a, --api <url>        Cepage API base URL (default: $CEPAGE_URL or http://localhost:31947)
  -t, --token <token>    Bearer token (default: $CEPAGE_TOKEN)
  -f, --filter <slugs>   Comma-separated list of skill slugs to expose
                         (default: $CEPAGE_MCP_SKILL_FILTER, all skills if unset)
      --timeout <ms>     Per-run timeout in milliseconds (default: 300000)
  -h, --help             Print this message
  -v, --version          Print the package version

This binary reads MCP requests from stdin and writes responses to stdout.
Do not print anything else to stdout — diagnostics go to stderr.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (args.version) {
    process.stdout.write(`${await readPackageVersion()}\n`);
    process.exit(0);
  }

  const { start } = createCepageMcpServer({
    apiUrl: args.apiUrl,
    token: args.token ?? undefined,
    filter: args.filter ?? null,
    runTimeoutMs: args.timeoutMs,
  });

  await start();
}

async function readPackageVersion(): Promise<string> {
  try {
    const mod = await import('../package.json', { assert: { type: 'json' } } as never);
    const pkg = (mod.default ?? mod) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.1.0';
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[cepage-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
