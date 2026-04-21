import { z } from 'zod';

const textSchema = z.string().min(1);

export const workflowSkillKindSchema = z.enum([
  'workflow_template',
  'operator_playbook',
  'context_doc',
]);
export type WorkflowSkillKind = z.infer<typeof workflowSkillKindSchema>;

export const workflowSkillPromptSchema = z.object({
  path: textSchema,
});
export type WorkflowSkillPrompt = z.infer<typeof workflowSkillPromptSchema>;

export const workflowSkillRoutingSchema = z.object({
  keywords: z.array(textSchema).default([]),
  intents: z.array(textSchema).default([]),
});
export type WorkflowSkillRouting = z.infer<typeof workflowSkillRoutingSchema>;

export const workflowSkillExpectedWorkflowSchema = z.object({
  orchestration: textSchema,
  phases: z.array(textSchema).default([]),
  intermediateOutputs: z.array(textSchema).default([]),
  publishedOutputs: z.array(textSchema).default([]),
});
export type WorkflowSkillExpectedWorkflow = z.infer<typeof workflowSkillExpectedWorkflowSchema>;

export const workflowSkillCompatSchema = z.object({
  minApi: z.string().optional(),
  surfaces: z.array(z.enum(['simple', 'studio'])).default(['simple', 'studio']),
});
export type WorkflowSkillCompat = z.infer<typeof workflowSkillCompatSchema>;

export const workflowSkillRefSchema = z.object({
  id: textSchema,
  version: z.string().optional(),
  title: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type WorkflowSkillRef = z.infer<typeof workflowSkillRefSchema>;

export const workflowSkillModuleRoleSchema = z.enum([
  'analysis',
  'research',
  'synthesis',
  'generation',
  'validation',
  'integration',
  'planning',
  'other',
]);
export type WorkflowSkillModuleRole = z.infer<typeof workflowSkillModuleRoleSchema>;

export const workflowSkillModuleExecutionSchema = z.enum(['single', 'iterative']);
export type WorkflowSkillModuleExecution = z.infer<typeof workflowSkillModuleExecutionSchema>;

export const workflowSkillModuleSchema = z.object({
  id: textSchema,
  title: textSchema,
  role: workflowSkillModuleRoleSchema.default('other'),
  summary: textSchema,
  requiredInputs: z.array(textSchema).default([]),
  producedOutputs: z.array(textSchema).default([]),
  execution: workflowSkillModuleExecutionSchema.default('single'),
});
export type WorkflowSkillModule = z.infer<typeof workflowSkillModuleSchema>;

export const workflowSkillSchema = z.object({
  id: textSchema,
  version: z.string().default('1.0.0'),
  kind: workflowSkillKindSchema.default('workflow_template'),
  title: textSchema,
  summary: textSchema,
  promptFile: textSchema.optional(),
  prompt: workflowSkillPromptSchema.optional(),
  tags: z.array(textSchema).default([]),
  routing: workflowSkillRoutingSchema.default({
    keywords: [],
    intents: [],
  }),
  validated: z.boolean().optional(),
  expectedWorkflow: workflowSkillExpectedWorkflowSchema.optional(),
  capabilities: z.array(textSchema).default([]),
  requiredInputs: z.array(textSchema).default([]),
  producedOutputs: z.array(textSchema).default([]),
  recommendedFollowups: z.array(workflowSkillRefSchema).default([]),
  compositionHints: z.array(textSchema).default([]),
  simpleExamples: z.array(textSchema).default([]),
  defaultModules: z.array(workflowSkillModuleSchema).default([]),
  compat: workflowSkillCompatSchema.optional(),
  deprecated: z.boolean().optional(),
  replacedBy: workflowSkillRefSchema.optional(),
});
export type WorkflowSkill = z.infer<typeof workflowSkillSchema>;

export const workflowSkillCatalogSchema = z.object({
  schemaVersion: z.string().default('1'),
  generatedAt: z.string().optional(),
  skills: z.array(workflowSkillSchema),
});
export type WorkflowSkillCatalog = z.infer<typeof workflowSkillCatalogSchema>;
