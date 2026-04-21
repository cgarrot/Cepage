import { z } from 'zod';

const textSchema = z.string().min(1);

export const workflowArtifactKindSchema = z.enum(['text', 'image', 'binary', 'directory']);
export type WorkflowArtifactKind = z.infer<typeof workflowArtifactKindSchema>;

export const workflowArtifactRoleSchema = z.enum(['input', 'output', 'intermediate']);
export type WorkflowArtifactRole = z.infer<typeof workflowArtifactRoleSchema>;

export const workflowArtifactOriginSchema = z.enum(['user_upload', 'agent_output', 'workspace_existing', 'derived']);
export type WorkflowArtifactOrigin = z.infer<typeof workflowArtifactOriginSchema>;

export const workflowArtifactTransferModeSchema = z.enum(['reference', 'context', 'claim_check']);
export type WorkflowArtifactTransferMode = z.infer<typeof workflowArtifactTransferModeSchema>;

export const workflowArtifactPathModeSchema = z.enum(['static', 'per_run']);
export type WorkflowArtifactPathMode = z.infer<typeof workflowArtifactPathModeSchema>;

export const workflowArtifactStatusSchema = z.enum(['declared', 'available', 'missing', 'deleted']);
export type WorkflowArtifactStatus = z.infer<typeof workflowArtifactStatusSchema>;

export interface WorkflowArtifactContent {
  title?: string;
  relativePath: string;
  pathMode?: WorkflowArtifactPathMode;
  resolvedRelativePath?: string;
  role: WorkflowArtifactRole;
  origin: WorkflowArtifactOrigin;
  kind: WorkflowArtifactKind;
  mimeType?: string;
  size?: number;
  transferMode?: WorkflowArtifactTransferMode;
  summary?: string;
  excerpt?: string;
  sourceTemplateNodeId?: string;
  sourceExecutionId?: string;
  sourceRunId?: string;
  claimRef?: string;
  status?: WorkflowArtifactStatus;
  lastSeenAt?: string;
  change?: 'added' | 'modified' | 'deleted';
}

const workflowArtifactSchema = z.object({
  title: z.string().optional(),
  relativePath: textSchema,
  pathMode: workflowArtifactPathModeSchema.optional(),
  resolvedRelativePath: z.string().optional(),
  role: workflowArtifactRoleSchema,
  origin: workflowArtifactOriginSchema,
  kind: workflowArtifactKindSchema,
  mimeType: z.string().optional(),
  size: z.number().nonnegative().optional(),
  transferMode: workflowArtifactTransferModeSchema.optional(),
  summary: z.string().optional(),
  excerpt: z.string().optional(),
  sourceTemplateNodeId: z.string().optional(),
  sourceExecutionId: z.string().optional(),
  sourceRunId: z.string().optional(),
  claimRef: z.string().optional(),
  status: workflowArtifactStatusSchema.optional(),
  lastSeenAt: z.string().optional(),
  change: z.enum(['added', 'modified', 'deleted']).optional(),
});

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizePath(value: string | undefined): string {
  const next = value?.trim();
  if (!next) return '';
  return next.replace(/[\\]+/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function runDir(runId: string): string {
  return `run-${runId.trim().slice(0, 8) || 'current'}`;
}

export function buildRunScopedArtifactPath(relativePath: string, runId: string): string {
  const base = normalizePath(relativePath);
  if (!base) return base;
  const parts = base.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return runDir(runId);
  return [...parts, runDir(runId), name].join('/');
}

export function resolveWorkflowArtifactRelativePath(
  value: Pick<WorkflowArtifactContent, 'relativePath' | 'pathMode' | 'resolvedRelativePath'>,
  runId?: string,
): string {
  const relativePath = normalizePath(value.relativePath);
  if ((value.pathMode ?? 'static') !== 'per_run') {
    return relativePath;
  }
  const nextRunId = runId?.trim();
  if (nextRunId) {
    return buildRunScopedArtifactPath(relativePath, nextRunId);
  }
  const resolvedPath = normalizePath(value.resolvedRelativePath);
  return resolvedPath || relativePath;
}

export function readWorkflowArtifactContent(value: unknown): WorkflowArtifactContent | null {
  const parsed = workflowArtifactSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function formatWorkflowArtifactLabel(value: unknown): string {
  const content = readWorkflowArtifactContent(value);
  if (!content) return 'Workspace file';
  return content.title?.trim() || content.relativePath;
}

export function summarizeWorkflowArtifactContent(value: unknown): string {
  const content = readWorkflowArtifactContent(value);
  if (!content) return '';
  const resolvedPath = resolveWorkflowArtifactRelativePath(content);
  const lines = [
    formatWorkflowArtifactLabel(content),
    `${content.role} · ${content.origin} · ${content.transferMode ?? 'reference'}`,
    `path: ${content.relativePath}`,
  ];
  if ((content.pathMode ?? 'static') !== 'static') {
    lines.push(`mode: ${content.pathMode}`);
  }
  if (resolvedPath && resolvedPath !== content.relativePath) {
    lines.push(`resolved: ${resolvedPath}`);
  }
  if (content.summary?.trim()) {
    lines.push(content.summary.trim());
  } else if (content.excerpt?.trim()) {
    lines.push(content.excerpt.trim());
  } else {
    const claim = readString(content.claimRef)?.trim();
    if (claim) {
      lines.push(`claim: ${claim}`);
    }
  }
  return lines.join('\n');
}
