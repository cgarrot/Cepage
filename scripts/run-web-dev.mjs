import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const appDir = path.join(rootDir, 'apps', 'web');
const appBin = path.join(appDir, 'node_modules', '.bin');

const loadEnvFile = (envPath) => {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const expand = dotenvExpand.expand ?? dotenvExpand;
  const expanded = expand({ parsed, ignoreProcessEnv: true });
  return expanded.parsed ?? parsed;
};

const applyAllowedEnv = (source, target) => {
  if (!source) return;
  Object.entries(source).forEach(([key, value]) => {
    if (
      key.startsWith('NEXT_PUBLIC_') ||
      key === 'PORT' ||
      key === 'NODE_ENV' ||
      key === 'HOSTNAME'
    ) {
      target[key] = value;
    }
  });
  if (!target.PORT && source.WEB_PORT) {
    target.PORT = source.WEB_PORT;
  }
};

const rootExampleEnv = loadEnvFile(path.join(rootDir, '.env.example'));
const rootEnv = loadEnvFile(path.join(rootDir, '.env'));
const appEnv = loadEnvFile(path.join(appDir, '.env'));
const appLocalEnv = loadEnvFile(path.join(appDir, '.env.local'));

const childEnv = { ...process.env };
applyAllowedEnv(rootExampleEnv, childEnv);
applyAllowedEnv(rootEnv, childEnv);
applyAllowedEnv(appEnv, childEnv);
applyAllowedEnv(appLocalEnv, childEnv);

const mergedEnv = {
  ...rootExampleEnv,
  ...rootEnv,
  ...appEnv,
  ...appLocalEnv,
};

if (mergedEnv.WEB_PORT) childEnv.PORT = mergedEnv.WEB_PORT;
if (mergedEnv.NEXT_PUBLIC_API_URL) childEnv.NEXT_PUBLIC_API_URL = mergedEnv.NEXT_PUBLIC_API_URL;
if (mergedEnv.NEXT_PUBLIC_WS_URL) childEnv.NEXT_PUBLIC_WS_URL = mergedEnv.NEXT_PUBLIC_WS_URL;
if (mergedEnv.API_PORT && !childEnv.NEXT_PUBLIC_API_URL) {
  childEnv.NEXT_PUBLIC_API_URL = `http://localhost:${mergedEnv.API_PORT}`;
}
if (mergedEnv.API_PORT && !childEnv.NEXT_PUBLIC_WS_URL) {
  childEnv.NEXT_PUBLIC_WS_URL = `http://localhost:${mergedEnv.API_PORT}`;
}

childEnv.PATH = `${appBin}${path.delimiter}${childEnv.PATH ?? ''}`;

/* @cepage/i18n resolves message tables from dist; keep dist in sync with src before dev. */
const i18n = spawnSync('pnpm', ['--filter', '@cepage/i18n', 'build'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (i18n.status !== 0) {
  process.exit(i18n.status ?? 1);
}

const child = spawn('next', ['dev'], {
  cwd: appDir,
  stdio: 'inherit',
  env: childEnv,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start web dev server:', error);
  process.exit(1);
});
