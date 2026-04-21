import { setTimeout as sleep } from 'node:timers/promises';
import type { AgentCatalogProvider } from '@cepage/shared-core';
import { DaemonApiClient, DaemonApiError } from './client.js';
import type { DaemonConfig } from './config.js';
import { HealthServer, type HealthState } from './health-server.js';
import { JobRunner } from './job-runner.js';
import { createLogger, type Logger } from './logger.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { WorkspaceManager } from './workspace.js';

// Refresh catalog at most once per minute regardless of heartbeat frequency:
// listing OpenCode/Cursor providers may spawn child processes, so we don't
// want every heartbeat (default 5s) to pay that cost.
const CATALOG_REFRESH_INTERVAL_MS = 60_000;

export type CatalogDiscoverer = () => Promise<AgentCatalogProvider[] | undefined>;

async function defaultDiscoverCatalog(): Promise<AgentCatalogProvider[] | undefined> {
  // Late-imported so unit tests using the in-process daemon don't pull the full
  // agent-core graph just to inject a fake discoverer.
  const { listAgentCatalog } = await import('@cepage/agent-core');
  const catalog = await listAgentCatalog();
  return catalog.providers;
}

export type DaemonDeps = {
  client?: DaemonApiClient;
  logger?: Logger;
  healthServer?: HealthServer;
  workspace?: WorkspaceManager;
  jobRunner?: JobRunner;
  runtimeRegistry?: RuntimeRegistry;
  discoverCatalog?: CatalogDiscoverer;
};

export class Daemon {
  private readonly client: DaemonApiClient;
  private readonly logger: Logger;
  private readonly healthServer: HealthServer;
  private readonly workspace: WorkspaceManager;
  private readonly runtimeRegistry: RuntimeRegistry;
  private readonly jobRunner: JobRunner;
  private readonly state: HealthState;
  private readonly discoverCatalog: CatalogDiscoverer;
  private pollIntervalMs: number;
  private heartbeatIntervalMs: number;
  private running = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollLoopPromise: Promise<void> | null = null;
  private activeJobAbort: AbortController | null = null;
  private cachedCatalog: AgentCatalogProvider[] | undefined;
  private lastCatalogRefreshAt = 0;

  constructor(
    private readonly config: DaemonConfig,
    deps: DaemonDeps = {},
  ) {
    this.logger = deps.logger ?? createLogger({ level: config.logLevel });
    this.client =
      deps.client
      ?? new DaemonApiClient({ baseUrl: config.apiBaseUrl, runtimeId: config.runtimeId });
    this.pollIntervalMs = config.pollIntervalMs;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs;
    this.state = {
      runtimeId: config.runtimeId,
      startedAt: new Date().toISOString(),
      apiBaseUrl: config.apiBaseUrl,
      status: 'starting',
    };
    this.healthServer =
      deps.healthServer
      ?? new HealthServer(config.healthPort, () => ({ ...this.state }), this.logger);
    this.workspace = deps.workspace ?? new WorkspaceManager(config.workspaceRoot);
    this.runtimeRegistry =
      deps.runtimeRegistry ?? new RuntimeRegistry({ logger: this.logger });
    this.jobRunner =
      deps.jobRunner
      ?? new JobRunner({
        client: this.client,
        workspace: this.workspace,
        logger: this.logger,
        runtimeRegistry: this.runtimeRegistry,
      });
    this.discoverCatalog = deps.discoverCatalog ?? defaultDiscoverCatalog;
  }

  /**
   * Best-effort agent catalog discovery — failures are logged and turn into
   * `undefined` so the rest of the daemon lifecycle keeps moving even when an
   * individual agent CLI is missing or misconfigured. The cached value is
   * returned when called more often than `CATALOG_REFRESH_INTERVAL_MS`.
   */
  private async refreshCatalog(force = false): Promise<AgentCatalogProvider[] | undefined> {
    const now = Date.now();
    if (!force && this.cachedCatalog && now - this.lastCatalogRefreshAt < CATALOG_REFRESH_INTERVAL_MS) {
      return this.cachedCatalog;
    }
    try {
      const providers = await this.discoverCatalog();
      this.cachedCatalog = providers;
      this.lastCatalogRefreshAt = now;
      this.logger.info('daemon catalog refreshed', {
        providerCount: providers?.length ?? 0,
      });
      return providers;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn('daemon catalog discovery failed', { detail });
      return this.cachedCatalog;
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.healthServer.start();
    this.logger.info('daemon registering', {
      apiBaseUrl: this.config.apiBaseUrl,
      runtimeId: this.config.runtimeId,
    });
    const catalog = await this.refreshCatalog(true);
    try {
      const registration = await this.client.register({
        name: this.config.name,
        supportedAgents: this.config.supportedAgents,
        version: this.config.version,
        catalog,
      });
      this.pollIntervalMs = registration.pollIntervalMs;
      this.heartbeatIntervalMs = registration.heartbeatIntervalMs;
      this.state.status = 'running';
      this.logger.info('daemon registered', {
        pollIntervalMs: this.pollIntervalMs,
        heartbeatIntervalMs: this.heartbeatIntervalMs,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.state.status = 'degraded';
      this.state.lastError = detail;
      this.logger.error('daemon register failed', { detail });
      await this.healthServer.stop().catch(() => undefined);
      throw error;
    }

    this.running = true;
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
    this.pollLoopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    const wasRunning = this.running;
    this.running = false;
    this.state.status = 'stopping';
    if (this.activeJobAbort) {
      this.activeJobAbort.abort();
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollLoopPromise) {
      try {
        await this.pollLoopPromise;
      } catch (error) {
        this.logger.warn('daemon poll loop exited with error during shutdown', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      this.pollLoopPromise = null;
    }
    if (wasRunning) {
      try {
        await this.client.deregister();
        this.logger.info('daemon deregistered');
      } catch (error) {
        this.logger.warn('daemon deregister failed', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.runtimeRegistry.stopAll().catch((error) => {
      this.logger.warn('daemon runtime registry shutdown failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    await this.healthServer.stop();
    this.state.status = 'stopped';
  }

  getState(): HealthState {
    return { ...this.state };
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running) return;
    try {
      const catalog = await this.refreshCatalog();
      await this.client.heartbeat({
        activeJobId: this.state.activeJobId,
        load: { supportedAgents: this.config.supportedAgents },
        catalog,
      });
      this.state.lastHeartbeatAt = new Date().toISOString();
      if (this.state.status === 'degraded') {
        this.state.status = 'running';
        this.state.lastError = undefined;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.state.status = 'degraded';
      this.state.lastError = detail;
      this.logger.warn('daemon heartbeat failed', { detail });
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.client.claim(this.config.supportedAgents);
        this.state.lastClaimAt = new Date().toISOString();
        if (!job) {
          await sleep(this.pollIntervalMs);
          continue;
        }
        await this.executeJob(job);
        // Yield between jobs even on success so the loop never busy-spins when
        // the API immediately hands back another job.
        if (this.running) {
          await sleep(this.pollIntervalMs);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const status = error instanceof DaemonApiError ? error.status : undefined;
        this.state.status = 'degraded';
        this.state.lastError = detail;
        this.logger.warn('daemon claim failed', { detail, status });
        await sleep(Math.max(this.pollIntervalMs, 1_000));
      }
    }
  }

  private async executeJob(job: { id: string; kind: string; leaseToken: string }): Promise<void> {
    const claimedJob = job as Parameters<JobRunner['run']>[0];
    this.activeJobAbort = new AbortController();
    this.state.activeJobId = job.id;
    this.logger.info('daemon executing job', { jobId: job.id, kind: job.kind });
    try {
      await this.jobRunner.run(claimedJob, this.activeJobAbort.signal);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn('daemon job runner threw', { jobId: job.id, detail });
      try {
        await this.client.fail(job.id, job.leaseToken, detail);
      } catch (failError) {
        this.logger.warn('daemon failed to record job failure', {
          jobId: job.id,
          detail: failError instanceof Error ? failError.message : String(failError),
        });
      }
    } finally {
      this.activeJobAbort = null;
      this.state.activeJobId = undefined;
    }
  }
}
