import http from 'node:http';
import type { Logger } from './logger.js';

export type HealthState = {
  runtimeId: string;
  startedAt: string;
  lastHeartbeatAt?: string;
  lastClaimAt?: string;
  activeJobId?: string;
  apiBaseUrl: string;
  status: 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
  lastError?: string;
};

export class HealthServer {
  private server: http.Server | null = null;

  constructor(
    private readonly port: number,
    private readonly getState: () => HealthState,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/healthz' || req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(this.getState()));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      });
      server.once('error', (error) => reject(error));
      server.listen(this.port, '127.0.0.1', () => {
        this.logger.info('daemon health server listening', { port: this.port });
        resolve();
      });
      this.server = server;
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}
