import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { WebPreviewInfo } from '@cepage/shared-core';
import { buildPreviewLaunchSpec } from './preview-detect.util';
import { RunArtifactsService } from './run-artifacts.service';

type PreviewChild = ReturnType<typeof spawn>;

type PreviewRuntimeState = {
  sessionId: string;
  runId: string;
  status: 'launching' | 'running' | 'error';
  preview: WebPreviewInfo;
  child?: PreviewChild;
  stderrTail: string;
};

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 1_000;

@Injectable()
export class PreviewRuntimeService implements OnModuleDestroy {
  private readonly runtimeByRun = new Map<string, PreviewRuntimeState>();

  constructor(private readonly artifacts: RunArtifactsService) {}

  async onModuleDestroy(): Promise<void> {
    for (const runtime of this.runtimeByRun.values()) {
      runtime.child?.kill('SIGTERM');
    }
    this.runtimeByRun.clear();
  }

  async getPreview(sessionId: string, runId: string): Promise<WebPreviewInfo> {
    const runtime = this.runtimeByRun.get(runId);
    if (runtime) {
      return runtime.preview;
    }
    const bundle = await this.artifacts.getRunArtifacts(sessionId, runId);
    return bundle.summary.preview;
  }

  async ensurePreview(sessionId: string, runId: string): Promise<WebPreviewInfo> {
    const bundle = await this.artifacts.getRunArtifacts(sessionId, runId);
    const existing = this.runtimeByRun.get(runId);
    if (existing && (existing.status === 'launching' || existing.status === 'running')) {
      return existing.preview;
    }

    const currentPreview = bundle.summary.preview;
    if (currentPreview.strategy === 'static' && currentPreview.status !== 'unavailable') {
      const preview = {
        ...currentPreview,
        status: 'running' as const,
      };
      await this.artifacts.updatePreviewInfo(sessionId, runId, preview);
      return preview;
    }

    const port = await reservePort();
    const launch = await buildPreviewLaunchSpec(bundle.summary.cwd, port);
    if (launch.preview.strategy !== 'script' || !launch.command || !launch.args || !launch.env) {
      const preview = {
        ...currentPreview,
        ...launch.preview,
      };
      await this.artifacts.updatePreviewInfo(sessionId, runId, preview);
      return preview;
    }

    const preview = {
      ...currentPreview,
      ...launch.preview,
      status: 'launching' as const,
    };
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const runtime: PreviewRuntimeState = {
      sessionId,
      runId,
      status: 'launching',
      preview,
      child,
      stderrTail: '',
    };
    this.runtimeByRun.set(runId, runtime);
    child.stderr.on('data', (chunk: Buffer | string) => {
      runtime.stderrTail = trimTail(`${runtime.stderrTail}${chunk.toString()}`);
    });
    child.stdout.on('data', () => {});
    child.on('error', (errorValue) => {
      void this.markError(runtime, errorValue instanceof Error ? errorValue.message : String(errorValue), true);
    });
    child.on('exit', (code, signal) => {
      if (runtime.status === 'error') {
        this.runtimeByRun.delete(runId);
        return;
      }
      if (runtime.status === 'running') {
        runtime.status = 'error';
        runtime.preview = {
          ...runtime.preview,
          status: 'error',
          error: `Preview stopped (${signal ?? code ?? 'unknown'})`,
        };
        this.runtimeByRun.delete(runId);
        void this.artifacts.updatePreviewInfo(sessionId, runId, runtime.preview);
      } else {
        void this.markError(
          runtime,
          runtime.stderrTail || `Preview failed to start (${signal ?? code ?? 'unknown'})`,
          false,
        );
      }
    });

    await this.artifacts.updatePreviewInfo(sessionId, runId, preview);
    void this.waitUntilReady(runtime);
    return preview;
  }

  async renderPreviewFrame(sessionId: string, runId: string): Promise<string> {
    await this.ensurePreview(sessionId, runId);
    const basePath = `/api/v1/sessions/${sessionId}/agents/${runId}/preview`;
    const statusPath = `${basePath}/status`;
    const startPath = `${basePath}/start`;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Workspace Preview</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #e8edf8; }
      .shell { height: 100vh; display: grid; grid-template-rows: auto 1fr; }
      .status { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); font-size: 13px; }
      iframe { width: 100%; height: 100%; border: 0; background: #fff; }
      .empty { display: grid; place-items: center; height: 100%; padding: 24px; text-align: center; color: rgba(232,237,248,0.82); }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="status" id="status">Starting preview…</div>
      <div id="content" class="empty">Preparing the local web preview.</div>
    </div>
    <script>
      const statusPath = ${JSON.stringify(statusPath)};
      const startPath = ${JSON.stringify(startPath)};
      let frameMounted = false;
      async function loadStatus() {
        await fetch(startPath, { method: 'POST', credentials: 'include' }).catch(() => null);
        const response = await fetch(statusPath, { credentials: 'include' });
        const payload = await response.json();
        if (!payload || payload.success !== true) {
          throw new Error('Failed to load preview status');
        }
        const info = payload.data;
        const status = document.getElementById('status');
        const content = document.getElementById('content');
        if (status) {
          status.textContent = info.status === 'running'
            ? (info.framework ? 'Preview running: ' + info.framework : 'Preview running')
            : info.status === 'launching'
              ? 'Starting preview…'
              : info.status === 'available'
                ? 'Preview available'
                : info.status === 'unavailable'
                  ? 'No web preview detected'
                  : info.error || 'Preview error';
        }
        if (info.status === 'running' && info.url) {
          if (!frameMounted && content) {
            const frame = document.createElement('iframe');
            frame.src = info.url;
            content.replaceWith(frame);
            frameMounted = true;
          }
          return;
        }
        if (content && !frameMounted) {
          content.textContent = info.error || (info.status === 'unavailable'
            ? 'No runnable web app was detected in this workspace.'
            : 'Preparing the local web preview.');
        }
        if (info.status === 'error' || info.status === 'unavailable') {
          return;
        }
        window.setTimeout(loadStatus, 1200);
      }
      loadStatus().catch((error) => {
        const status = document.getElementById('status');
        const content = document.getElementById('content');
        if (status) status.textContent = 'Preview error';
        if (content) content.textContent = error instanceof Error ? error.message : String(error);
      });
    </script>
  </body>
</html>`;
  }

  private async waitUntilReady(runtime: PreviewRuntimeState): Promise<void> {
    const url = runtime.preview.url;
    if (!url) {
      await this.markError(runtime, 'Preview URL missing.', true);
      return;
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (runtime.status !== 'launching') {
        return;
      }
      if (await isHttpReady(url)) {
        runtime.status = 'running';
        runtime.preview = {
          ...runtime.preview,
          status: 'running',
          error: undefined,
        };
        await this.artifacts.updatePreviewInfo(runtime.sessionId, runtime.runId, runtime.preview);
        return;
      }
      await sleep(READY_POLL_MS);
    }
    await this.markError(
      runtime,
      runtime.stderrTail || 'Preview timed out before the dev server became reachable.',
      true,
    );
  }

  private async markError(runtime: PreviewRuntimeState, message: string, killChild: boolean): Promise<void> {
    if (killChild) {
      runtime.child?.kill('SIGTERM');
    }
    runtime.status = 'error';
    runtime.preview = {
      ...runtime.preview,
      status: 'error',
      error: message,
    };
    this.runtimeByRun.delete(runtime.runId);
    try {
      await this.artifacts.updatePreviewInfo(runtime.sessionId, runtime.runId, runtime.preview);
    } catch {
      // Preserve the original preview failure even if metadata sync also fails.
    }
  }
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new NotFoundException('PREVIEW_PORT_UNAVAILABLE'));
        return;
      }
      const { port } = address;
      server.close((errorValue) => {
        if (errorValue) {
          reject(errorValue);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function isHttpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status > 0;
  } catch {
    return false;
  }
}

function trimTail(value: string): string {
  return value.length > 4000 ? value.slice(-4000) : value;
}
