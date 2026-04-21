import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const defaultDatabaseUrl =
  'postgresql://postgres:postgres@localhost:31945/cepage?schema=public';

const loadEnvFile = (envPath) => {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const expand = dotenvExpand.expand ?? dotenvExpand;
  const expanded = expand({ parsed, ignoreProcessEnv: true });
  return expanded.parsed ?? parsed;
};

const rootEnv = loadEnvFile(path.join(rootDir, '.env'));
const merged = {
  ...process.env,
  ...rootEnv,
};

if (!merged.DATABASE_URL || merged.DATABASE_URL.trim() === '') {
  merged.DATABASE_URL = defaultDatabaseUrl;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-prisma.mjs <prisma-args…>');
  process.exit(1);
}

const result = spawnSync('pnpm', ['--filter', '@cepage/db', 'exec', 'prisma', ...args], {
  cwd: rootDir,
  stdio: 'inherit',
  env: merged,
  shell: false,
});

process.exit(result.status ?? 1);
