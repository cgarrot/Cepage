import { apiGet, apiPost } from './http';
import { getApiBaseUrl } from './config';

export type SkillRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SkillRunError = {
  code: string;
  message: string;
  details?: unknown;
};

export type SkillRunRow = {
  id: string;
  skillId: string;
  skillVersion: string;
  skillKind: string;
  userSkillId: string | null;
  status: SkillRunStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error: SkillRunError | null;
  sessionId: string | null;
  triggeredBy: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillRunBody = {
  inputs: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
  triggeredBy?: 'api' | 'ui' | 'cli' | 'mcp' | 'schedule' | 'webhook' | 'sdk';
  workspace?: {
    parentDirectory?: string;
    directoryName?: string;
  };
};

export async function createSkillRun(
  slug: string,
  body: CreateSkillRunBody,
  opts: { wait?: boolean; timeoutMs?: number } = {},
) {
  const q = new URLSearchParams();
  if (opts.wait === false) q.set('wait', 'false');
  if (opts.timeoutMs) q.set('timeoutMs', String(opts.timeoutMs));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiPost<SkillRunRow>(`/api/v1/skills/${slug}/runs${suffix}`, body);
}

export async function listSkillRuns(opts: { skillId?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.skillId) q.set('skillId', opts.skillId);
  if (opts.limit) q.set('limit', String(opts.limit));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiGet<SkillRunRow[]>(`/api/v1/skill-runs${suffix}`);
}

export async function listSkillRunsForSkill(slug: string, limit?: number) {
  const q = limit ? `?limit=${limit}` : '';
  return apiGet<SkillRunRow[]>(`/api/v1/skills/${slug}/runs${q}`);
}

export async function getSkillRun(runId: string) {
  return apiGet<SkillRunRow>(`/api/v1/skill-runs/${runId}`);
}

export async function cancelSkillRun(runId: string) {
  return apiPost<SkillRunRow>(`/api/v1/skill-runs/${runId}/cancel`, {});
}

export type SkillRunStreamEvent =
  | { type: 'snapshot'; data: SkillRunRow }
  | { type: 'started'; data: { runId: string; skillId: string } }
  | { type: 'progress'; data: { runId: string; message: string } }
  | { type: 'succeeded'; data: { runId: string; outputs: unknown } }
  | { type: 'failed'; data: { runId: string; error: SkillRunError } }
  | { type: 'cancelled'; data: { runId: string } };

// Browser-side helper that consumes the SSE /stream endpoint. Returns a
// disposer that closes the event source.
export function streamSkillRun(
  runId: string,
  onEvent: (event: SkillRunStreamEvent) => void,
): () => void {
  const source = new EventSource(`${getApiBaseUrl()}/api/v1/skill-runs/${runId}/stream`, {
    withCredentials: true,
  });
  const types: SkillRunStreamEvent['type'][] = [
    'snapshot',
    'started',
    'progress',
    'succeeded',
    'failed',
    'cancelled',
  ];
  for (const type of types) {
    source.addEventListener(type, (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data ?? 'null');
        onEvent({ type, data: payload } as SkillRunStreamEvent);
      } catch {
        // ignore
      }
    });
  }
  return () => source.close();
}
