import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(31947),
  CORS_ORIGIN: z.string().optional(),
  AGENT_WORKING_DIRECTORY: z.string().default('.'),
  WORKFLOW_SKILLS_EXTRA_PATHS: z.string().optional(),
  // OPENCODE_PORT / OPENCODE_HOST are deprecated. The native daemon
  // (`apps/daemon`) now owns all agent_run / runtime_* jobs and spawns
  // OpenCode locally. These env vars remain only for in-API synchronous
  // call sites that still call runAgentStream directly (workflow copilot,
  // file summarizer, agents catalog) when running outside Docker.
  OPENCODE_PORT: z.coerce.number().optional(),
  OPENCODE_HOST: z.string().optional(),
  SNAPSHOT_EVENT_INTERVAL: z.coerce.number().default(200),
  EXECUTION_WORKER_MODE: z.enum(['api', 'off']).default('api'),
  EXECUTION_WORKER_POLL_MS: z.coerce.number().default(400),
  EXECUTION_HEARTBEAT_MS: z.coerce.number().default(5_000),
  // 60s is generous enough that a single missed daemon heartbeat (every ~5s)
  // does not requeue an in-flight long-running job. Long copilot/agent runs
  // additionally rely on the daemon heartbeat to refresh this lease per tick.
  EXECUTION_JOB_LEASE_MS: z.coerce.number().default(60_000),
  EXECUTION_SCHEDULER_MS: z.coerce.number().default(1_000),
  AUTONOMY_DEFAULT_BUDGET: z.coerce.number().default(16),
  // CSV of CIDRs (or bare IPv4 = /32) that the daemon protocol guard trusts in
  // addition to loopback. Required when the API runs in Docker and the native
  // daemon hits it from the host: connections arrive via the bridge gateway IP
  // (typically 172.x.y.1) rather than 127.0.0.1. Leave empty for pure localhost
  // setups; we never authenticate the daemon protocol so only widen this on
  // trusted networks.
  DAEMON_TRUSTED_PEER_CIDRS: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cache: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (cache) return cache;
  cache = envSchema.parse(process.env);
  return cache;
}

export function resolveCorsOrigin(): boolean | string | string[] {
  const raw = getEnv().CORS_ORIGIN;
  if (!raw || raw === '*') return true;
  return raw.split(',').map((s) => s.trim());
}
