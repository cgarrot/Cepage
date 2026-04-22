import type { HttpTransport } from './http.js';
import type {
  CreateScheduleBody,
  ScheduledSkillRun,
  UpdateScheduleBody,
} from './types.js';

// Resource helper for `/scheduled-skill-runs`. Cepage already exposes
// a full CRUD surface; the SDK just needs typed wrappers.

export class SchedulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(): Promise<ScheduledSkillRun[]> {
    const result = await this.http.request<
      | ScheduledSkillRun[]
      | { items?: ScheduledSkillRun[] }
    >('GET', '/scheduled-skill-runs');
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.items) ? result.items : [];
  }

  async get(id: string): Promise<ScheduledSkillRun> {
    return this.http.request<ScheduledSkillRun>(
      'GET',
      `/scheduled-skill-runs/${encodeURIComponent(id)}`,
    );
  }

  async create(body: CreateScheduleBody): Promise<ScheduledSkillRun> {
    return this.http.request<ScheduledSkillRun>('POST', '/scheduled-skill-runs', {
      body,
    });
  }

  async update(id: string, body: UpdateScheduleBody): Promise<ScheduledSkillRun> {
    return this.http.request<ScheduledSkillRun>(
      'PATCH',
      `/scheduled-skill-runs/${encodeURIComponent(id)}`,
      { body },
    );
  }

  async delete(id: string): Promise<void> {
    await this.http.request('DELETE', `/scheduled-skill-runs/${encodeURIComponent(id)}`);
  }

  async runNow(id: string): Promise<ScheduledSkillRun> {
    return this.http.request<ScheduledSkillRun>(
      'POST',
      `/scheduled-skill-runs/${encodeURIComponent(id)}/run-now`,
    );
  }
}
