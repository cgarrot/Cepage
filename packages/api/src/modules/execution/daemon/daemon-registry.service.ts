import { Injectable, Logger } from '@nestjs/common';
import {
  agentCatalogProviderSchema,
  type AgentCatalog,
  type AgentCatalogProvider,
  type AgentType,
} from '@cepage/shared-core';
import { ExecutionQueueService } from '../execution-queue.service';
import { WorkerRegistryService } from '../worker-registry.service';

/**
 * Bridge between the HTTP daemon protocol controller and the underlying
 * `WorkerRegistryService`. We persist daemon-side discoveries (notably the
 * agent catalog) inside `WorkerNode.metadata` so they survive restarts of the
 * API process and can be aggregated by other services without a side
 * datastore.
 */
@Injectable()
export class DaemonRegistryService {
  private readonly logger = new Logger(DaemonRegistryService.name);

  constructor(
    private readonly workers: WorkerRegistryService,
    private readonly queue: ExecutionQueueService,
  ) {}

  async register(input: {
    runtimeId: string;
    name?: string;
    supportedAgents: AgentType[];
    version?: string;
    catalog?: AgentCatalogProvider[];
  }): Promise<void> {
    await this.workers.registerWorker({
      workerId: input.runtimeId,
      kind: 'daemon',
      metadata: {
        mode: 'daemon',
        name: input.name,
        supportedAgents: input.supportedAgents,
        version: input.version,
        catalog: input.catalog,
      },
    });
  }

  async heartbeat(input: {
    runtimeId: string;
    activeJobId?: string;
    load?: Record<string, unknown>;
    catalog?: AgentCatalogProvider[];
  }): Promise<void> {
    await this.workers.heartbeat({
      workerId: input.runtimeId,
      activeJobId: input.activeJobId,
      load: input.load,
      // Catalog is optional on heartbeat: only refresh metadata when the daemon
      // actually shipped a fresh discovery, otherwise we keep the last known
      // value (e.g. transient catalog discovery failure shouldn't blank it).
      metadataPatch: input.catalog ? { catalog: input.catalog } : undefined,
    });
    // Long-running jobs (copilot/agent runs) routinely outlive
    // EXECUTION_JOB_LEASE_MS. Without this refresh, reclaimExpiredJobs() resets
    // the job to `queued` and invalidates the daemon's leaseToken, so the next
    // /messages or /complete POST gets 404. Use the daemon's per-runtime
    // heartbeat tick (every few seconds) to keep the active job's lease alive
    // for as long as the daemon believes it owns the job.
    if (input.activeJobId) {
      const refreshed = await this.queue.heartbeatJobByWorker(
        input.activeJobId,
        input.runtimeId,
      );
      if (!refreshed) {
        // The daemon thinks it owns this job but the API has no matching
        // running row (cancelled, completed, reclaimed, or owned by a different
        // worker). We surface this so the daemon can be inspected, but we don't
        // throw because a stale activeJobId shouldn't kill the heartbeat path.
        this.logger.warn(
          `daemon ${input.runtimeId} reports activeJobId=${input.activeJobId} but no matching running job found`,
        );
      }
    }
  }

  async deregister(runtimeId: string): Promise<void> {
    await this.workers.markStopped(runtimeId);
  }

  /**
   * Aggregate the catalog metadata across every daemon currently considered
   * "running" by the worker registry. The first daemon that exposes a given
   * `(agentType, providerID)` wins — daemons are returned newest-first by
   * `summarizeRunningWorkers`, so the freshest discovery takes precedence.
   *
   * Returns `null` when no daemon is online so callers can render a clear
   * "daemon offline" message instead of an empty catalog.
   */
  async getMergedCatalog(): Promise<AgentCatalog | null> {
    const summary = await this.workers.summarizeRunningWorkers('daemon');
    if (!summary.online) return null;
    const merged = new Map<string, AgentCatalogProvider>();
    for (const daemon of summary.runtimes) {
      const catalog = daemon.metadata?.catalog;
      if (!Array.isArray(catalog)) continue;
      for (const raw of catalog) {
        const parsed = agentCatalogProviderSchema.safeParse(raw);
        if (!parsed.success) continue;
        const key = `${parsed.data.agentType}:${parsed.data.providerID}`;
        if (!merged.has(key)) merged.set(key, parsed.data);
      }
    }
    if (merged.size === 0) return null;
    return {
      providers: [...merged.values()],
      fetchedAt: new Date().toISOString(),
    };
  }
}
