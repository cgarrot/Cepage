import { HttpTransport } from './http.js';
import { RunsResource } from './runs.js';
import { SchedulesResource } from './schedules.js';
import { SessionsResource } from './sessions.js';
import { SkillsResource } from './skills.js';
import { WebhooksResource } from './webhooks.js';

// Cepage client — the canonical entry point for the TypeScript SDK.
//
// Usage:
//   const client = new CepageClient({ apiUrl: 'https://api.cepage.dev/api/v1' });
//   const run = await client.skills.run('weekly-stripe-report', {
//     inputs: { startDate: '2026-04-14', endDate: '2026-04-21' },
//   });
//
// The client is dependency-free; pass a custom `fetchImpl` when running
// in restricted environments (Cloudflare Workers, browsers without
// credentials, tests, etc.).

export interface CepageClientOptions {
  /** Full base URL, e.g. "https://cepage.example.com/api/v1". */
  apiUrl: string;
  /** Optional bearer token used in the `Authorization` header. */
  token?: string;
  /** Custom fetch implementation. Defaults to global fetch (Node 20+). */
  fetchImpl?: typeof fetch;
  /** Extra headers applied to every request. Useful for tracing. */
  defaultHeaders?: Record<string, string>;
  /** Overrides the advertised `user-agent`. */
  userAgent?: string;
}

export class CepageClient {
  readonly apiUrl: string;
  readonly skills: SkillsResource;
  readonly runs: RunsResource;
  readonly schedules: SchedulesResource;
  readonly sessions: SessionsResource;
  readonly webhooks: WebhooksResource;
  readonly http: HttpTransport;

  constructor(options: CepageClientOptions) {
    this.http = new HttpTransport(options);
    this.apiUrl = this.http.apiUrl;
    this.runs = new RunsResource(this.http);
    this.skills = new SkillsResource(this.http, this.runs);
    this.schedules = new SchedulesResource(this.http);
    this.sessions = new SessionsResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
  }
}

export function createCepageClient(options: CepageClientOptions): CepageClient {
  return new CepageClient(options);
}
