import type { WorkflowSkill, WorkflowSkillCatalog } from '@cepage/shared-core';
import { apiGet } from './http';

export async function getWorkflowSkills() {
  return apiGet<WorkflowSkillCatalog>('/api/v1/workflow-skills');
}

export async function getWorkflowSkill(skillId: string) {
  return apiGet<WorkflowSkill>(`/api/v1/workflow-skills/${skillId}`);
}
