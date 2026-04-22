import type {
  WorkflowSkill,
  WorkflowSkillExecution,
  WorkflowSkillKind,
  WorkflowSkillSource,
} from '@cepage/shared-core';
import type { UserSkillRow } from './user-skills.dto';

// Turn a DB UserSkill row into the shared `WorkflowSkill` shape so the
// Library, MCP server, SDK, and CLI all see a single unified skill type.
export function userSkillRowToWorkflowSkill(row: UserSkillRow): WorkflowSkill {
  const source: WorkflowSkillSource = {
    kind: 'user',
    ownerId: row.ownerKey,
    createdFromSessionId: row.sourceSessionId ?? undefined,
    visibility: row.visibility,
  };
  const execution: WorkflowSkillExecution = row.execution ?? {
    mode: 'session',
    copilotFallback: true,
    autoRun: true,
  };
  return {
    id: row.slug,
    version: row.version,
    kind: (row.kind as WorkflowSkillKind) ?? 'workflow_template',
    title: row.title,
    summary: row.summary,
    tags: row.tags ?? [],
    routing: { keywords: [], intents: [] },
    validated: row.validated,
    capabilities: [],
    requiredInputs: [],
    producedOutputs: [],
    recommendedFollowups: [],
    compositionHints: [],
    simpleExamples: [],
    defaultModules: [],
    deprecated: row.deprecated,
    inputsSchema: row.inputsSchema,
    outputsSchema: row.outputsSchema,
    icon: row.icon ?? undefined,
    category: row.category ?? undefined,
    execution,
    source,
  };
}
