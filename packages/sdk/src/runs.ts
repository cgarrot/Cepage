import { CepageTimeoutError, type HttpTransport } from './http.js';
import type { ListRunsOptions, SkillRun, SkillRunEvent } from './types.js';

// Resource helper for `/skill-runs`, including the SSE streaming
// endpoint. It's intentionally tiny — the interesting work (shaping
// the request, surfacing validation errors) happens in HttpTransport.

export class RunsResource {
  constructor(private readonly http: HttpTransport) {}

  async list(options: ListRunsOptions = {}): Promise<SkillRun[]> {
    const result = await this.http.request<SkillRun[] | { items?: SkillRun[] }>(
      'GET',
      '/skill-runs',
      {
        query: {
          skillId: options.skillId,
          limit: options.limit,
        },
      },
    );
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.items) ? result.items : [];
  }

  async get(runId: string): Promise<SkillRun> {
    return this.http.request<SkillRun>('GET', `/skill-runs/${encodeURIComponent(runId)}`);
  }

  async cancel(runId: string): Promise<SkillRun> {
    return this.http.request<SkillRun>(
      'POST',
      `/skill-runs/${encodeURIComponent(runId)}/cancel`,
    );
  }

  stream(runId: string, signal?: AbortSignal): AsyncGenerator<SkillRunEvent> {
    return this.http.stream(`/skill-runs/${encodeURIComponent(runId)}/stream`, { signal });
  }

  async wait(runId: string, timeoutMs = 120_000): Promise<SkillRun> {
    return waitForTerminal(this.http, this, runId, timeoutMs);
  }
}

export async function waitForTerminal(
  http: HttpTransport,
  runs: { get(runId: string): Promise<SkillRun> },
  runId: string,
  timeoutMs: number,
): Promise<SkillRun> {
  const deadline = Date.now() + timeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(0, deadline - Date.now()));

  try {
    for await (const event of http.stream(
      `/skill-runs/${encodeURIComponent(runId)}/stream`,
      { signal: ctrl.signal },
    )) {
      if (isTerminalEvent(event)) {
        const terminal = await runs.get(runId);
        return terminal;
      }
      if (Date.now() >= deadline) throw new CepageTimeoutError(`Skill run ${runId} exceeded ${timeoutMs}ms wait budget.`);
    }
    return runs.get(runId);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('aborted'))
    ) {
      throw new CepageTimeoutError(`Skill run ${runId} exceeded ${timeoutMs}ms wait budget.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

function isTerminalEvent(event: SkillRunEvent): boolean {
  return (
    event.type === 'succeeded' ||
    event.type === 'failed' ||
    event.type === 'cancelled'
  );
}
