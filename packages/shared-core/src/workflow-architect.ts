import { z } from 'zod';

const textSchema = z.string().min(1);

export const workflowArchitectSkillRefSchema = z.object({
  id: textSchema,
  version: z.string().optional(),
  title: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type WorkflowArchitectSkillRef = z.infer<typeof workflowArchitectSkillRefSchema>;

export const workflowArchitectStatusSchema = z.enum(['draft', 'ready', 'review_required']);
export type WorkflowArchitectStatus = z.infer<typeof workflowArchitectStatusSchema>;

export const workflowArchitectSourceKindSchema = z.enum([
  'analysis_data',
  'video_analysis',
  'music_analysis',
  'tooling_docs',
  'web_research',
  'workspace_context',
  'user_goal',
  'other',
]);
export type WorkflowArchitectSourceKind = z.infer<typeof workflowArchitectSourceKindSchema>;

export const workflowArchitectSourceSchema = z.object({
  kind: workflowArchitectSourceKindSchema.default('other'),
  label: textSchema,
  details: z.string().optional(),
  required: z.boolean().default(false),
});
export type WorkflowArchitectSource = z.infer<typeof workflowArchitectSourceSchema>;

export const workflowArchitectModuleRoleSchema = z.enum([
  'analysis',
  'research',
  'synthesis',
  'generation',
  'validation',
  'integration',
  'planning',
  'other',
]);
export type WorkflowArchitectModuleRole = z.infer<typeof workflowArchitectModuleRoleSchema>;

export const workflowArchitectModuleExecutionSchema = z.enum(['single', 'iterative']);
export type WorkflowArchitectModuleExecution = z.infer<typeof workflowArchitectModuleExecutionSchema>;

export const workflowArchitectModuleSchema = z.object({
  id: textSchema,
  title: textSchema,
  role: workflowArchitectModuleRoleSchema.default('other'),
  summary: textSchema,
  skillIds: z.array(textSchema).default([]),
  requiredInputs: z.array(textSchema).default([]),
  producedOutputs: z.array(textSchema).default([]),
  execution: workflowArchitectModuleExecutionSchema.default('single'),
});
export type WorkflowArchitectModule = z.infer<typeof workflowArchitectModuleSchema>;

export const workflowArchitectJoinStrategySchema = z.enum(['artifact', 'context', 'manifest']);
export type WorkflowArchitectJoinStrategy = z.infer<typeof workflowArchitectJoinStrategySchema>;

export const workflowArchitectJoinSchema = z.object({
  fromModuleId: textSchema,
  toModuleId: textSchema,
  fromOutput: textSchema,
  toInput: textSchema,
  strategy: workflowArchitectJoinStrategySchema.default('artifact'),
  required: z.boolean().default(true),
});
export type WorkflowArchitectJoin = z.infer<typeof workflowArchitectJoinSchema>;

export const workflowArchitectureSpecSchema = z.object({
  goal: textSchema,
  domain: z.string().default('general'),
  requestedOutcome: z.string().optional(),
  needsWebResearch: z.boolean().default(false),
  sources: z.array(workflowArchitectSourceSchema).default([]),
  modules: z.array(workflowArchitectModuleSchema).min(1),
  joins: z.array(workflowArchitectJoinSchema).default([]),
  finalOutputs: z.array(textSchema).default([]),
  reviewRequired: z.boolean().default(false),
  reviewReason: z.string().optional(),
});
export type WorkflowArchitectureSpec = z.infer<typeof workflowArchitectureSpecSchema>;

export const workflowArchitectStateSchema = z.object({
  status: workflowArchitectStatusSchema.default('draft'),
  candidates: z.array(workflowArchitectSkillRefSchema).default([]),
  spec: workflowArchitectureSpecSchema.optional(),
  generatedAt: z.string().optional(),
});
export type WorkflowArchitectState = z.infer<typeof workflowArchitectStateSchema>;
