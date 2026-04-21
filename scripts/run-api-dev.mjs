import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { applyDevCursorAgentBin } from './apply-dev-cursor-agent-bin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const appDir = path.join(rootDir, 'apps', 'api');
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

const rootExampleEnv = loadEnvFile(path.join(rootDir, '.env.example'));
const rootEnv = loadEnvFile(path.join(rootDir, '.env'));
const appEnv = loadEnvFile(path.join(appDir, '.env'));
const appLocalEnv = loadEnvFile(path.join(appDir, '.env.local'));

const childEnv = applyDevCursorAgentBin({
  ...process.env,
  ...rootExampleEnv,
  ...rootEnv,
  ...appEnv,
  ...appLocalEnv,
});

if (!childEnv.DATABASE_URL || childEnv.DATABASE_URL.trim() === '') {
  childEnv.DATABASE_URL = defaultDatabaseUrl;
}

if (childEnv.API_PORT) {
  childEnv.PORT = childEnv.API_PORT;
}

// Local development stays aligned with the latest Prisma schema even while
// migrations are still being refined. Committed schema changes should still
// be captured with `pnpm db:migrate:dev`.
const sync = spawnSync(
  process.execPath,
  [path.join(rootDir, 'scripts', 'run-prisma.mjs'), 'db', 'push'],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: childEnv,
  },
);

if ((sync.status ?? 1) !== 0) {
  process.exit(sync.status ?? 1);
}

const child = spawn('nest', ['start', '--watch'], {
  cwd: appDir,
  stdio: 'inherit',
  env: childEnv,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start API dev server:', error);
  process.exit(1);
});
