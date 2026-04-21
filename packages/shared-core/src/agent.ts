import { z } from 'zod';
import { wakeReasonSchema } from './graph';
import type { RunId, SessionId, WakeReason } from './graph';
import type {
  RuntimeFileWriteEvent,
  RuntimeHint,
  RuntimeManifestEnvelope,
  RuntimeSpawnRequest,
} from './runtime';
import { workflowRunInputValueSchema } from './workflow-input';

export const agentTypeSchema = z.enum([
  'orchestrator',
  'opencode',
  'claude_code',
  'cursor_agent',
  'codex',
  'custom',
]);

export type AgentType = z.infer<typeof agentTypeSchema>;

export const agentLifecycleSchema = z.enum([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);

export type AgentLifecycleStatus = z.infer<typeof agentLifecycleSchema>;

export const agentRuntimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local_process'), cwd: z.string() }),
  z.object({
    kind: z.literal('docker'),
    image: z.string(),
    volumeMounts: z.array(z.string()),
  }),
  z.object({ kind: z.literal('remote_worker'), endpoint: z.string() }),
]);

export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;

export const agentModelRefSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
});

export type AgentModelRef = z.infer<typeof agentModelRefSchema>;

export const agentPromptTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

export const agentPromptFilePartSchema = z.object({
  type: z.literal('file'),
  mime: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().optional(),
});

export const agentPromptPartSchema = z.discriminatedUnion('type', [
  agentPromptTextPartSchema,
  agentPromptFilePartSchema,
]);
export type AgentPromptPart = z.infer<typeof agentPromptPartSchema>;

export const agentCatalogModelSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export type AgentCatalogModel = z.infer<typeof agentCatalogModelSchema>;

export const agentCatalogAvailabilitySchema = z.enum(['ready', 'unavailable']);
export type AgentCatalogAvailability = z.infer<typeof agentCatalogAvailabilitySchema>;

export const agentCatalogProviderSchema = z.object({
  agentType: agentTypeSchema,
  providerID: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  models: z.array(agentCatalogModelSchema),
  availability: agentCatalogAvailabilitySchema.optional(),
  unavailableReason: z.string().optional(),
});

export type AgentCatalogProvider = z.infer<typeof agentCatalogProviderSchema>;

export const agentCatalogSchema = z.object({
  providers: z.array(agentCatalogProviderSchema),
  fetchedAt: z.string(),
});

export type AgentCatalog = z.infer<typeof agentCatalogSchema>;

export const agentPolicyLevelSchema = z.enum(['agentType', 'provider', 'model']);
export type AgentPolicyLevel = z.infer<typeof agentPolicyLevelSchema>;

// A single row of the AgentPolicy table: free-text guidance ("hint") pinned
// at one of three granularities. Required keys depend on `level`:
//   - level 'agentType': agentType must be set; providerID/modelID null
//   - level 'provider':  agentType + providerID must be set; modelID null
//   - level 'model':     agentType + providerID + modelID must be set
export const agentPolicyEntrySchema = z
  .object({
    id: z.string().optional(),
    level: agentPolicyLevelSchema,
    agentType: agentTypeSchema.optional(),
    providerID: z.string().min(1).optional(),
    modelID: z.string().min(1).optional(),
    hint: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    priority: z.number().int().default(0),
  })
  .superRefine((val, ctx) => {
    if (!val.agentType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentType'],
        message: 'agentType is required for every policy entry',
      });
    }
    if (val.level === 'agentType') {
      if (val.providerID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerID'],
          message: 'providerID must be empty for level "agentType"',
        });
      }
      if (val.modelID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelID'],
          message: 'modelID must be empty for level "agentType"',
        });
      }
    } else if (val.level === 'provider') {
      if (!val.providerID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerID'],
          message: 'providerID is required for level "provider"',
        });
      }
      if (val.modelID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelID'],
          message: 'modelID must be empty for level "provider"',
        });
      }
    } else if (val.level === 'model') {
      if (!val.providerID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerID'],
          message: 'providerID is required for level "model"',
        });
      }
      if (!val.modelID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelID'],
          message: 'modelID is required for level "model"',
        });
      }
    }
  });
export type AgentPolicyEntry = z.infer<typeof agentPolicyEntrySchema>;

// CopilotSettings.defaults — optional (agentType, providerID, modelID) triple
// used as the prompt-time default when the user does not pin a specific model.
export const copilotSettingsSchema = z.object({
  defaultAgentType: agentTypeSchema.nullable().optional(),
  defaultProviderID: z.string().min(1).nullable().optional(),
  defaultModelID: z.string().min(1).nullable().optional(),
});
export type CopilotSettings = z.infer<typeof copilotSettingsSchema>;

// Packaged shape consumed by the workflow copilot prompt builder: the merged
// daemon catalog plus the policy hints and default triple. The prompt renders
// hints inline with each catalog entry and flags the default with *DEFAULT.
export const agentCatalogForPromptSchema = z.object({
  catalog: agentCatalogSchema.nullable(),
  policies: z.array(agentPolicyEntrySchema),
  defaults: copilotSettingsSchema,
});
export type AgentCatalogForPrompt = z.infer<typeof agentCatalogForPromptSchema>;

export interface AgentSpawnRequest {
  requestId?: string;
  type: AgentType;
  role: string;
  runtime: AgentRuntime;
  workingDirectory?: string;
  triggerNodeId?: string | null;
  wakeReason: WakeReason;
  seedNodeIds: string[];
  capabilities?: Record<string, boolean>;
  model?: AgentModelRef;
  parentExecutionId?: string;
  parentRunId?: string;
  newExecution?: boolean;
}

export interface AgentRerunRequest {
  requestId?: string;
  type?: AgentType;
  model?: AgentModelRef;
  newExecution?: boolean;
}

export const workflowRunRequestSchema = z.object({
  requestId: z.string().optional(),
  type: agentTypeSchema,
  role: z.string().optional(),
  workingDirectory: z.string().optional(),
  triggerNodeId: z.string().optional(),
  wakeReason: wakeReasonSchema.optional(),
  model: agentModelRefSchema.optional(),
  input: workflowRunInputValueSchema.optional(),
  inputs: z.record(z.string(), workflowRunInputValueSchema).optional(),
  newExecution: z.boolean().optional(),
});
export type WorkflowRunRequest = z.infer<typeof workflowRunRequestSchema>;

export const inputNodeStartRequestSchema = z.object({
  requestId: z.string().optional(),
  type: agentTypeSchema,
  role: z.string().optional(),
  workingDirectory: z.string().optional(),
  wakeReason: wakeReasonSchema.optional(),
  model: agentModelRefSchema.optional(),
  input: workflowRunInputValueSchema.optional(),
  sourceNodeIds: z.array(z.string().min(1)).optional(),
  newExecution: z.boolean().optional(),
});
export type InputNodeStartRequest = z.infer<typeof inputNodeStartRequestSchema>;

export const workflowRunResultSchema = z.object({
  executionId: z.string().min(1),
  agentRunId: z.string().min(1),
  rootNodeId: z.string().min(1),
  status: agentLifecycleSchema,
  wakeReason: wakeReasonSchema,
  triggerNodeId: z.string().optional(),
  stepNodeId: z.string().optional(),
  boundNodeIds: z.array(z.string()),
});
export type WorkflowRunResult = z.infer<typeof workflowRunResultSchema>;

export const inputNodeStartResultSchema = workflowRunResultSchema.extend({
  targetNodeId: z.string().min(1),
  createdBoundNodeId: z.string().min(1).optional(),
  reusedBoundNodeIds: z.array(z.string()),
});
export type InputNodeStartResult = z.infer<typeof inputNodeStartResultSchema>;

export function formatAgentModelLabel(model?: AgentModelRef): string {
  if (!model) return 'default';
  return `${model.providerID}/${model.modelID}`;
}

export function formatAgentTypeLabel(type: AgentType): string {
  if (type === 'opencode') return 'OpenCode';
  if (type === 'cursor_agent') return 'Cursor Agent';
  if (type === 'claude_code') return 'Claude Code';
  if (type === 'codex') return 'Codex';
  if (type === 'orchestrator') return 'Orchestrator';
  return type.replace(/_/g, ' ');
}

export function formatAgentSelectionLabel(type: AgentType, model?: AgentModelRef): string {
  if (!model) return formatAgentTypeLabel(type);
  return `${formatAgentTypeLabel(type)} ${formatAgentModelLabel(model)}`;
}

export interface AgentRun {
  id: string;
  sessionId: SessionId;
  executionId?: RunId;
  requestId?: string;
  type: AgentType;
  role: string;
  runtime: AgentRuntime;
  wakeReason: WakeReason;
  status: AgentLifecycleStatus;
  startedAt: string;
  endedAt?: string;
  updatedAt?: string;
  seedNodeIds: string[];
  rootNodeId?: string;
  triggerNodeId?: string;
  stepNodeId?: string;
  retryOfRunId?: RunId;
  parentAgentId?: string;
  parentRunId?: RunId;
  model?: AgentModelRef;
  externalSessionId?: string;
  providerMetadata?: Record<string, unknown>;
  lastSeenEventId?: number;
  outputText?: string;
  isStreaming?: boolean;
}

export interface WorkflowExecution {
  id: string;
  sessionId: SessionId;
  parentExecutionId?: string;
  triggerNodeId?: string;
  stepNodeId?: string;
  currentRunId?: RunId;
  latestRunId?: RunId;
  requestId?: string;
  type: AgentType;
  role: string;
  runtime: AgentRuntime;
  wakeReason: WakeReason;
  status: AgentLifecycleStatus;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  seedNodeIds: string[];
  model?: AgentModelRef;
}

export const agentCatalogQuerySchema = z.object({
  workingDirectory: z.string().optional(),
});

export type AgentCatalogQuery = z.infer<typeof agentCatalogQuerySchema>;

export const agentSpawnMetaSchema = z.object({
  type: agentTypeSchema,
  wakeReason: wakeReasonSchema,
  model: agentModelRefSchema.optional(),
});

export type AgentSpawnMeta = z.infer<typeof agentSpawnMetaSchema>;

export type AgentRuntimeEvent =
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  // Reasoning / thinking output streamed alongside `stdout` for surfaces that
  // want to render the model's chain of thought live (e.g. Copilot panel).
  | { type: 'thinking'; chunk: string }
  | { type: 'status'; status: AgentLifecycleStatus; message?: string }
  | { type: 'artifact_manifest'; manifest: RuntimeManifestEnvelope }
  | { type: 'runtime_hint'; hint: RuntimeHint }
  | { type: 'file_write'; file: RuntimeFileWriteEvent }
  | { type: 'spawn_request'; request: RuntimeSpawnRequest }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string };
