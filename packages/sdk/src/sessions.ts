import type { HttpTransport } from './http.js';
import type { DetectInputsResult, SaveAsSkillBody, UserSkill } from './types.js';

// Resource helper for the save-as-skill flow exposed on sessions.
// Kept separate from the skill resource so consumers don't import
// session machinery unless they actually need authoring.

export class SessionsResource {
  constructor(private readonly http: HttpTransport) {}

  async detectInputs(sessionId: string): Promise<DetectInputsResult> {
    return this.http.request<DetectInputsResult>(
      'POST',
      `/sessions/${encodeURIComponent(sessionId)}/detect-inputs`,
    );
  }

  async saveAsSkill(sessionId: string, body: SaveAsSkillBody): Promise<UserSkill> {
    return this.http.request<UserSkill>(
      'POST',
      `/sessions/${encodeURIComponent(sessionId)}/save-as-skill`,
      { body },
    );
  }
}
