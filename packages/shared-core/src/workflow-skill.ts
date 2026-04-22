import { z } from 'zod';

const textSchema = z.string().min(1);

export const workflowSkillKindSchema = z.enum([
  'workflow_template',
  'operator_playbook',
  'context_doc',
]);
export type WorkflowSkillKind = z.infer<typeof workflowSkillKindSchema>;

// JSON Schema (Draft 2020-12 subset) used to describe typed inputs and
// outputs of a skill. Kept intentionally permissive: we accept any shape
// that ajv can consume and derive forms / SDK types from. This is the
// central contract that unlocks auto-forms, codegen, OpenAPI, MCP, and
// chaining — see docs/product-plan/03-typed-skill-contract.md.
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  examples?: unknown[];
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  [key: string]: unknown;
};

export const jsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      properties: z.record(jsonSchemaSchema).optional(),
      items: z.union([jsonSchemaSchema, z.array(jsonSchemaSchema)]).optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(z.unknown()).optional(),
      const: z.unknown().optional(),
      default: z.unknown().optional(),
      format: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
      oneOf: z.array(jsonSchemaSchema).optional(),
      anyOf: z.array(jsonSchemaSchema).optional(),
      allOf: z.array(jsonSchemaSchema).optional(),
      additionalProperties: z.union([z.boolean(), jsonSchemaSchema]).optional(),
      examples: z.array(z.unknown()).optional(),
      deprecated: z.boolean().optional(),
      readOnly: z.boolean().optional(),
      writeOnly: z.boolean().optional(),
    })
    .passthrough(),
);

export const workflowSkillExecutionModeSchema = z.enum(['session', 'direct', 'chain']);
export type WorkflowSkillExecutionMode = z.infer<typeof workflowSkillExecutionModeSchema>;

export const workflowSkillExecutionSchema = z.object({
  mode: workflowSkillExecutionModeSchema.default('session'),
  graphRef: z.string().optional(),
  copilotFallback: z.boolean().default(true),
  autoRun: z.boolean().default(true),
  timeoutSeconds: z.number().int().positive().optional(),
});
export type WorkflowSkillExecution = z.infer<typeof workflowSkillExecutionSchema>;

export const workflowSkillSourceKindSchema = z.enum(['builtin', 'user', 'imported']);
export type WorkflowSkillSourceKind = z.infer<typeof workflowSkillSourceKindSchema>;

export const workflowSkillVisibilitySchema = z.enum(['private', 'workspace', 'public']);
export type WorkflowSkillVisibility = z.infer<typeof workflowSkillVisibilitySchema>;

export const workflowSkillSourceSchema = z.object({
  kind: workflowSkillSourceKindSchema.default('builtin'),
  ownerId: z.string().optional(),
  createdFromSessionId: z.string().optional(),
  visibility: workflowSkillVisibilitySchema.default('private'),
});
export type WorkflowSkillSource = z.infer<typeof workflowSkillSourceSchema>;

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
  // Typed Skill Contract (Option C) — see docs/product-plan/03-typed-skill-contract.md
  inputsSchema: jsonSchemaSchema.optional(),
  outputsSchema: jsonSchemaSchema.optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  execution: workflowSkillExecutionSchema.optional(),
  source: workflowSkillSourceSchema.optional(),
});
export type WorkflowSkill = z.infer<typeof workflowSkillSchema>;

export const workflowSkillCatalogSchema = z.object({
  schemaVersion: z.string().default('1'),
  generatedAt: z.string().optional(),
  skills: z.array(workflowSkillSchema),
});
export type WorkflowSkillCatalog = z.infer<typeof workflowSkillCatalogSchema>;
