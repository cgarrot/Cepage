import { spawn, type ChildProcess } from 'node:child_process';
import type { RuntimeProcessSpec } from '@cepage/shared-core';
import type { Logger } from './logger.js';

export type RuntimeProcessHandlers = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onStatus: (status: 'started' | 'ready' | 'unready', detail?: { pid?: number; message?: string }) => void;
  onExit: (info: { exitCode: number | null; signal: NodeJS.Signals | null }) => void;
  onError: (message: string) => void;
};

export type RuntimeRegistryOptions = {
  logger: Logger;
  /** Override probe (used in tests). Resolves to true when the URL responds 2xx. */
  probeImpl?: (url: string, signal: AbortSignal) => Promise<boolean>;
  /** Override spawn implementation (used in tests). */
  spawnImpl?: typeof spawn;
};

type RegistryEntry = {
  runNodeId: string;
  child: ChildProcess;
  handlers: RuntimeProcessHandlers;
  readinessAbort?: AbortController;
  exited: boolean;
};

const READINESS_INITIAL_DELAY_MS = 250;
const READINESS_INTERVAL_MS = 500;
const READINESS_MAX_ATTEMPTS = 60; // ~30s
const STOP_GRACEFUL_TIMEOUT_MS = 5_000;

/**
 * Tracks runtime processes spawned by the daemon. One entry per runNodeId.
 * Survives across jobs so that a later runtime_stop / runtime_restart can
 * find the process started by an earlier runtime_start.
 */
export class RuntimeRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly probeImpl: (url: string, signal: AbortSignal) => Promise<boolean>;
  private readonly spawnImpl: typeof spawn;

  constructor(private readonly options: RuntimeRegistryOptions) {
    this.probeImpl = options.probeImpl ?? defaultProbe;
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  has(runNodeId: string): boolean {
    return this.entries.has(runNodeId);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Spawn a runtime process for the given runNodeId. Wires stdout/stderr to
   * the supplied handlers and reports lifecycle status (started, ready,
   * unready, exit, error).  If a previous process is still tracked for the
   * same runNodeId it is killed first.
   */
  start(input: {
    runNodeId: string;
    spec: RuntimeProcessSpec;
    handlers: RuntimeProcessHandlers;
  }): void {
    const existing = this.entries.get(input.runNodeId);
    if (existing && !existing.exited) {
      this.options.logger.warn('runtime registry replacing existing entry', {
        runNodeId: input.runNodeId,
        pid: existing.child.pid,
      });
      this.killEntry(existing, 'replaced');
    }
    let child: ChildProcess;
    try {
      child = this.spawnImpl(input.spec.command, input.spec.args, {
        cwd: input.spec.cwd,
        env: input.spec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.handlers.onError(`runtime_spawn_failed: ${detail}`);
      input.handlers.onExit({ exitCode: null, signal: null });
      return;
    }

    const entry: RegistryEntry = {
      runNodeId: input.runNodeId,
      child,
      handlers: input.handlers,
      exited: false,
    };
    this.entries.set(input.runNodeId, entry);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => entry.handlers.onStdout(chunk));
    child.stderr?.on('data', (chunk: string) => entry.handlers.onStderr(chunk));
    child.once('error', (error: Error) => {
      entry.handlers.onError(error.message);
    });
    child.once('exit', (code, signal) => {
      entry.exited = true;
      entry.readinessAbort?.abort();
      entry.handlers.onExit({ exitCode: code, signal });
      // Keep the entry briefly so a stop arriving in the same tick still
      // matches; clean it up afterwards.
      this.entries.delete(input.runNodeId);
    });
    entry.handlers.onStatus('started', { pid: child.pid });

    if (input.spec.readinessUrl) {
      entry.readinessAbort = new AbortController();
      void this.runReadinessProbe(entry, input.spec.readinessUrl);
    }
  }

  /**
   * Stop the runtime process for runNodeId, returning when the OS reports the
   * process gone (or after the graceful timeout, in which case SIGKILL is
   * issued).  Returns true if a process was tracked, false otherwise.
   */
  async stop(runNodeId: string): Promise<{ stopped: boolean; exitCode: number | null; signal: NodeJS.Signals | null }> {
    const entry = this.entries.get(runNodeId);
    if (!entry || entry.exited) {
      return { stopped: false, exitCode: null, signal: null };
    }
    return new Promise((resolve) => {
      let resolved = false;
      const finalize = (info: { exitCode: number | null; signal: NodeJS.Signals | null }): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(killTimer);
        resolve({ stopped: true, exitCode: info.exitCode, signal: info.signal });
      };
      entry.child.once('exit', (code, signal) => finalize({ exitCode: code, signal }));
      try {
        entry.child.kill('SIGTERM');
      } catch (error) {
        this.options.logger.warn('runtime registry SIGTERM failed', {
          runNodeId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const killTimer = setTimeout(() => {
        try {
          entry.child.kill('SIGKILL');
        } catch (error) {
          this.options.logger.warn('runtime registry SIGKILL failed', {
            runNodeId,
            detail: error instanceof Error ? error.message : String(error),
          });
          finalize({ exitCode: null, signal: null });
        }
      }, STOP_GRACEFUL_TIMEOUT_MS);
    });
  }

  async stopAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    for (const id of ids) {
      await this.stop(id).catch(() => undefined);
    }
  }

  private killEntry(entry: RegistryEntry, _reason: string): void {
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // best-effort
    }
    entry.exited = true;
    entry.readinessAbort?.abort();
    this.entries.delete(entry.runNodeId);
  }

  private async runReadinessProbe(entry: RegistryEntry, url: string): Promise<void> {
    const abort = entry.readinessAbort?.signal;
    if (!abort) return;
    if (READINESS_INITIAL_DELAY_MS > 0) {
      await delay(READINESS_INITIAL_DELAY_MS, abort);
      if (abort.aborted) return;
    }
    let lastError: string | undefined;
    for (let attempt = 0; attempt < READINESS_MAX_ATTEMPTS; attempt += 1) {
      if (abort.aborted || entry.exited) return;
      try {
        const ok = await this.probeImpl(url, abort);
        if (ok) {
          entry.handlers.onStatus('ready');
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(READINESS_INTERVAL_MS, abort);
    }
    if (!entry.exited && !abort.aborted) {
      entry.handlers.onStatus('unready', { message: lastError ?? 'readiness_timeout' });
    }
  }
}

async function defaultProbe(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { signal, method: 'GET' });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
