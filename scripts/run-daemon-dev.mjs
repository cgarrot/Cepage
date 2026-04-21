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
const appDir = path.join(rootDir, 'apps', 'daemon');

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

const build = spawnSync('pnpm', ['--filter', '@cepage/daemon', 'run', 'build'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: childEnv,
  shell: false,
});

if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1);
}

const child = spawn(process.execPath, [path.join(appDir, 'dist', 'cli.js'), 'start'], {
  cwd: appDir,
  stdio: 'inherit',
  env: childEnv,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start daemon dev:', error);
  process.exit(1);
});
