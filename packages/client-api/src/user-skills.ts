import type { JsonSchema } from '@cepage/shared-core';
import { apiDelete, apiGet, apiPatch, apiPost } from './http';

// Typed HTTP bindings for the Library (DB-backed user skills) and the
// skill-run runtime. One entry per endpoint exposed by the API — this is
// also the shape the generated SDK and CLI reuse in phase 2.

export type UserSkillRow = {
  id: string;
  slug: string;
  version: string;
  title: string;
  summary: string;
  icon: string | null;
  category: string | null;
  tags: string[];
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  kind: string;
  promptText: string | null;
  graphJson: Record<string, unknown> | null;
  execution: Record<string, unknown> | null;
  sourceSessionId: string | null;
  visibility: 'private' | 'workspace' | 'public';
  ownerKey: string;
  validated: boolean;
  deprecated: boolean;
  replacedBySlug: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateUserSkillBody = {
  slug?: string;
  title: string;
  summary: string;
  icon?: string;
  category?: string;
  tags?: string[];
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  kind?: string;
  promptText?: string;
  graphJson?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  sourceSessionId?: string;
  visibility?: 'private' | 'workspace' | 'public';
};

export type UpdateUserSkillBody = Partial<Omit<CreateUserSkillBody, 'slug'>> & {
  deprecated?: boolean;
  replacedBySlug?: string;
  version?: string;
};

export async function listUserSkills() {
  return apiGet<UserSkillRow[]>('/api/v1/skills');
}

export async function getUserSkill(slug: string) {
  return apiGet<UserSkillRow>(`/api/v1/skills/${slug}`);
}

export async function createUserSkill(body: CreateUserSkillBody) {
  return apiPost<UserSkillRow>('/api/v1/skills', body);
}

export async function updateUserSkill(slug: string, body: UpdateUserSkillBody) {
  return apiPatch<UserSkillRow>(`/api/v1/skills/${slug}`, body);
}

export async function deleteUserSkill(slug: string) {
  return apiDelete<{ deleted: true }>(`/api/v1/skills/${slug}`);
}

export async function listUserSkillVersions(slug: string) {
  return apiGet<Array<{ version: string; createdAt: string; runCount: number }>>(
    `/api/v1/skills/${encodeURIComponent(slug)}/versions`,
  );
}

export async function createUserSkillVersion(
  slug: string,
  body: UpdateUserSkillBody & { nextVersion: string },
) {
  return apiPost<UserSkillRow>(`/api/v1/skills/${slug}/versions`, body);
}

export type ValidateInputsResult = {
  ok: boolean;
  errors: Array<{
    path: string;
    message: string;
    keyword?: string;
    params?: Record<string, unknown>;
  }>;
};

export async function validateUserSkillInputs(slug: string, inputs: Record<string, unknown>) {
  return apiPost<ValidateInputsResult>(`/api/v1/skills/${slug}/validate`, { inputs });
}
