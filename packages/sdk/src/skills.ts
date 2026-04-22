import type { HttpTransport } from './http.js';
import type {
  ListSkillsOptions,
  RunSkillOptions,
  SkillRun,
  UserSkill,
  WorkflowSkill,
} from './types.js';
import { waitForTerminal } from './runs.js';

// Resource helper for the `/workflow-skills` + `/skills/{slug}/runs`
// endpoints. It also provides a typed-escape hatch (`run<T, O>`) so
// strongly-typed callers can reuse generated skill inputs/outputs
// without losing the runtime safety of the base client.

export class SkillsResource {
  constructor(
    private readonly http: HttpTransport,
    private readonly runs: { get(runId: string): Promise<SkillRun> },
  ) {}

  async list(options: ListSkillsOptions = {}): Promise<WorkflowSkill[]> {
    const kindQuery = Array.isArray(options.kind)
      ? options.kind.join(',')
      : options.kind ?? undefined;
    // GET /workflow-skills → WorkflowSkillCatalog ({ schemaVersion, generatedAt, skills[] })
    // (after the HttpTransport unwraps the { success, data } envelope).
    // We also tolerate a bare array in case a future revision drops the catalog wrapper.
    const result = await this.http.request<
      WorkflowSkill[] | { skills?: WorkflowSkill[] }
    >('GET', '/workflow-skills', { query: { kind: kindQuery } });
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.skills) ? result.skills : [];
  }

  async get(slug: string): Promise<WorkflowSkill> {
    return this.http.request<WorkflowSkill>('GET', `/workflow-skills/${encodeURIComponent(slug)}`);
  }

  async listUserSkills(): Promise<UserSkill[]> {
    const result = await this.http.request<
      UserSkill[] | { items?: UserSkill[] }
    >('GET', '/skills');
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.items) ? result.items : [];
  }

  async getUserSkill(slug: string): Promise<UserSkill> {
    return this.http.request<UserSkill>('GET', `/skills/${encodeURIComponent(slug)}`);
  }

  async run<TInputs extends Record<string, unknown> = Record<string, unknown>>(
    slug: string,
    options: RunSkillOptions<TInputs>,
  ): Promise<SkillRun> {
    if (!slug) throw new Error('SkillsResource.run: slug is required.');
    if (!options || typeof options !== 'object') {
      throw new Error('SkillsResource.run: options.inputs is required.');
    }
    const wait = options.wait ?? true;
    const timeoutMs = Math.max(1000, Math.min(30 * 60_000, options.timeoutMs ?? 120_000));

    const body = {
      inputs: options.inputs ?? {},
      triggeredBy: options.triggeredBy ?? 'sdk',
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
    };

    const created = await this.http.request<SkillRun>(
      'POST',
      `/skills/${encodeURIComponent(slug)}/runs`,
      { body },
    );

    if (!wait) return created;
    if (isTerminal(created.status)) return created;
    return waitForTerminal(this.http, this.runs, created.id, timeoutMs);
  }
}

function isTerminal(status: SkillRun['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}
