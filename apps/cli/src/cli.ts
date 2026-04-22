#!/usr/bin/env node

import { runCli } from './main.js';

const code = await runCli(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cepage: ${msg}\n`);
  return 1;
});

process.exit(code ?? 0);
