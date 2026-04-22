import type { JsonSchema } from '@cepage/shared-core';
import { apiPost } from './http';
import type { UserSkillRow } from './user-skills';

export type DetectInputsResult = {
  sessionId: string;
  detected: Array<{
    name: string;
    occurrences: number;
    inferredType: 'string';
    hint?: string;
  }>;
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  promptText: string | null;
};

export type SaveAsSkillBody = {
  slug?: string;
  title: string;
  summary: string;
  icon?: string;
  category?: string;
  tags?: string[];
  inputsSchema?: JsonSchema;
  outputsSchema?: JsonSchema;
  visibility?: 'private' | 'workspace' | 'public';
};

export async function detectSkillInputs(sessionId: string) {
  return apiPost<DetectInputsResult>(`/api/v1/sessions/${sessionId}/detect-inputs`, {});
}

export async function saveSessionAsSkill(sessionId: string, body: SaveAsSkillBody) {
  return apiPost<UserSkillRow>(`/api/v1/sessions/${sessionId}/save-as-skill`, body);
}
