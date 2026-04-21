import type {
  AgentCatalogProvider,
  DaemonClaimJob,
  DaemonHeartbeatResponse,
  DaemonJobStartResponse,
  DaemonMessage,
  DaemonRegisterResponse,
} from '@cepage/shared-core';
import { daemonJobStartResponseSchema, type AgentType } from '@cepage/shared-core';

export class DaemonApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'DaemonApiError';
  }
}

export type DaemonApiClientOptions = {
  baseUrl: string;
  runtimeId: string;
  fetchImpl?: typeof fetch;
};

export class DaemonApiClient {
  private readonly baseUrl: string;
  private readonly runtimeId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DaemonApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.runtimeId = options.runtimeId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/v1/daemon${path}`;
  }

  private async send(
    path: string,
    init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    const response = await this.fetchImpl(this.url(path), {
      method: init.method ?? 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      throw new DaemonApiError(
        `Daemon API ${init.method ?? 'POST'} ${path} failed with ${response.status}`,
        response.status,
        text,
      );
    }
    return response;
  }

  async register(input: {
    name?: string;
    supportedAgents: AgentType[];
    version?: string;
    catalog?: AgentCatalogProvider[];
  }): Promise<DaemonRegisterResponse> {
    const response = await this.send('/register', {
      body: {
        runtimeId: this.runtimeId,
        name: input.name,
        supportedAgents: input.supportedAgents,
        version: input.version,
        catalog: input.catalog,
      },
    });
    return (await response.json()) as DaemonRegisterResponse;
  }

  async heartbeat(input: {
    activeJobId?: string;
    load?: Record<string, unknown>;
    catalog?: AgentCatalogProvider[];
  }): Promise<DaemonHeartbeatResponse> {
    const response = await this.send(`/${this.runtimeId}/heartbeat`, {
      body: {
        activeJobId: input.activeJobId,
        load: input.load,
        catalog: input.catalog,
      },
    });
    return (await response.json()) as DaemonHeartbeatResponse;
  }

  async deregister(): Promise<void> {
    await this.send(`/${this.runtimeId}/deregister`, { body: {} });
  }

  async claim(supportedAgents: AgentType[]): Promise<DaemonClaimJob | null> {
    const response = await this.send(`/${this.runtimeId}/claim`, {
      body: { supportedAgents },
    });
    if (response.status === 204) {
      return null;
    }
    return (await response.json()) as DaemonClaimJob;
  }

  async markStarted(jobId: string, leaseToken: string): Promise<DaemonJobStartResponse> {
    const response = await this.send(`/${this.runtimeId}/jobs/${jobId}/start`, {
      body: { leaseToken },
    });
    if (response.status === 204) {
      // Legacy/no-content fallback (shouldn't happen with current API but keeps the
      // client robust if the server downgrades to an empty 204).
      return { kind: 'agent_run' };
    }
    const json = (await response.json()) as unknown;
    const parsed = daemonJobStartResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new DaemonApiError(
        `Daemon API POST /${this.runtimeId}/jobs/${jobId}/start returned invalid body: ${parsed.error.message}`,
        response.status,
        JSON.stringify(json),
      );
    }
    return parsed.data;
  }

  async reportMessages(jobId: string, leaseToken: string, messages: DaemonMessage[]): Promise<void> {
    await this.send(`/${this.runtimeId}/jobs/${jobId}/messages`, {
      body: { leaseToken, messages },
    });
  }

  async complete(jobId: string, leaseToken: string, result?: Record<string, unknown>): Promise<void> {
    await this.send(`/${this.runtimeId}/jobs/${jobId}/complete`, {
      body: { leaseToken, result },
    });
  }

  async fail(jobId: string, leaseToken: string, error: string): Promise<void> {
    await this.send(`/${this.runtimeId}/jobs/${jobId}/fail`, {
      body: { leaseToken, error },
    });
  }
}
