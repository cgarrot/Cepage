import { apiDelete, apiGet, apiPatch, apiPost } from './http';
import type { SessionFromSkillBody, SessionFromSkillResult } from './sessions';

export type ScheduledSkillRunRow = {
  id: string;
  label: string | null;
  skillId: string;
  cron: string;
  request: SessionFromSkillBody;
  status: 'active' | 'paused';
  nextRunAt: string;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastError: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduledSkillRunBody = {
  label?: string;
  skillId: string;
  cron: string;
  request: SessionFromSkillBody;
  status?: 'active' | 'paused';
  metadata?: Record<string, unknown> | null;
};

export type UpdateScheduledSkillRunBody = Partial<
  Omit<CreateScheduledSkillRunBody, 'skillId'>
> & {
  skillId?: string;
};

export async function listScheduledSkillRuns() {
  return apiGet<{ items: ScheduledSkillRunRow[] }>('/api/v1/scheduled-skill-runs');
}

export async function createScheduledSkillRun(body: CreateScheduledSkillRunBody) {
  return apiPost<ScheduledSkillRunRow>('/api/v1/scheduled-skill-runs', body);
}

export async function getScheduledSkillRun(id: string) {
  return apiGet<ScheduledSkillRunRow>(`/api/v1/scheduled-skill-runs/${id}`);
}

export async function updateScheduledSkillRun(id: string, body: UpdateScheduledSkillRunBody) {
  return apiPatch<ScheduledSkillRunRow>(`/api/v1/scheduled-skill-runs/${id}`, body);
}

export async function deleteScheduledSkillRun(id: string) {
  return apiDelete<{ deleted: true }>(`/api/v1/scheduled-skill-runs/${id}`);
}

export async function runScheduledSkillRunNow(id: string) {
  return apiPost<SessionFromSkillResult>(`/api/v1/scheduled-skill-runs/${id}/run-now`, {});
}
