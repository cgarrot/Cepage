import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_API_URL = 'http://localhost:31947/api/v1';

export interface StoredConfig {
  apiUrl?: string;
  token?: string;
}

export interface ResolvedConfig {
  apiUrl: string;
  token?: string;
  source: 'cli' | 'env' | 'file' | 'default';
}

export function configPath(base: string = homedir()): string {
  return join(base, '.cepage', 'config.json');
}

export async function loadStoredConfig(base?: string): Promise<StoredConfig> {
  const target = configPath(base);
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    return {
      apiUrl: typeof obj.apiUrl === 'string' ? obj.apiUrl : undefined,
      token: typeof obj.token === 'string' ? obj.token : undefined,
    };
  } catch (err: unknown) {
    const node = err as NodeJS.ErrnoException;
    if (node.code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveStoredConfig(next: StoredConfig, base?: string): Promise<string> {
  const target = configPath(base);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify(next, null, 2) + '\n';
  await fs.writeFile(target, serialized, { mode: 0o600 });
  return target;
}

export async function clearStoredConfig(base?: string): Promise<boolean> {
  const target = configPath(base);
  try {
    await fs.unlink(target);
    return true;
  } catch (err: unknown) {
    const node = err as NodeJS.ErrnoException;
    if (node.code === 'ENOENT') return false;
    throw err;
  }
}

export interface ResolveConfigOptions {
  cliApiUrl?: string;
  cliToken?: string;
  env?: NodeJS.ProcessEnv;
  base?: string;
}

export async function resolveConfig(opts: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const env = opts.env ?? process.env;
  const stored = await loadStoredConfig(opts.base);

  const apiUrl = opts.cliApiUrl ?? env.CEPAGE_API_URL ?? stored.apiUrl ?? DEFAULT_API_URL;
  const token = opts.cliToken ?? env.CEPAGE_TOKEN ?? stored.token;
  const source: ResolvedConfig['source'] = opts.cliApiUrl
    ? 'cli'
    : env.CEPAGE_API_URL
      ? 'env'
      : stored.apiUrl
        ? 'file'
        : 'default';

  return { apiUrl, token, source };
}

export function redactToken(token?: string): string {
  if (!token) return '(none)';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export { DEFAULT_API_URL };
