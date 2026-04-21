import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentType } from '@cepage/shared-core';

export type DaemonConfig = {
  apiBaseUrl: string;
  runtimeId: string;
  name: string;
  workspaceRoot: string;
  healthPort: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  supportedAgents: AgentType[];
  version: string;
};

const DEFAULT_SUPPORTED_AGENTS: AgentType[] = ['opencode', 'cursor_agent'];

function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function cepageHome(): string {
  return process.env.CEPAGE_HOME || path.join(homedir(), '.cepage');
}

export function daemonStatePath(): string {
  return path.join(cepageHome(), 'daemon-state.json');
}

export function daemonLogPath(): string {
  return path.join(cepageHome(), 'daemon.log');
}

export function daemonPidPath(): string {
  return path.join(cepageHome(), 'daemon.pid');
}

type PersistedState = {
  runtimeId: string;
};

function readOrCreateRuntimeId(): string {
  const existing = readJsonFile<PersistedState>(daemonStatePath());
  if (existing?.runtimeId && typeof existing.runtimeId === 'string') {
    return existing.runtimeId;
  }
  const runtimeId = `daemon-${randomUUID()}`;
  writeJsonFile(daemonStatePath(), { runtimeId } satisfies PersistedState);
  return runtimeId;
}

export function defaultWorkspaceRoot(): string {
  return process.env.CEPAGE_WORKSPACE_ROOT || path.join(homedir(), 'cepage_workspaces');
}

export function loadDaemonConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const apiBaseUrl = overrides.apiBaseUrl
    ?? process.env.CEPAGE_API_URL
    ?? 'http://localhost:31947';
  const runtimeId = overrides.runtimeId ?? readOrCreateRuntimeId();
  const workspaceRoot = overrides.workspaceRoot ?? defaultWorkspaceRoot();
  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
  }
  return {
    apiBaseUrl,
    runtimeId,
    name: overrides.name ?? `${hostname()} daemon`,
    workspaceRoot,
    healthPort: overrides.healthPort ?? Number(process.env.CEPAGE_DAEMON_HEALTH_PORT ?? 31982),
    pollIntervalMs: overrides.pollIntervalMs ?? Number(process.env.CEPAGE_DAEMON_POLL_MS ?? 500),
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? Number(process.env.CEPAGE_DAEMON_HEARTBEAT_MS ?? 5_000),
    logLevel: overrides.logLevel ?? ((process.env.CEPAGE_DAEMON_LOG_LEVEL as DaemonConfig['logLevel']) ?? 'info'),
    supportedAgents: overrides.supportedAgents ?? DEFAULT_SUPPORTED_AGENTS,
    version: overrides.version ?? '0.0.1',
  };
}
