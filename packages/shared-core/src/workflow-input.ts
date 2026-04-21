import { z } from 'zod';
import { fileSummaryKindSchema } from './file-summary';
import { workflowArtifactTransferModeSchema } from './workflow-artifact';

const textSchema = z.string().min(1);

export const workflowInputAcceptSchema = z.enum(['text', 'image', 'file']);
export type WorkflowInputAccept = z.infer<typeof workflowInputAcceptSchema>;

export const workflowInputFileSchema = z.object({
  name: textSchema,
  mimeType: textSchema,
  size: z.number().nonnegative(),
  kind: fileSummaryKindSchema,
  uploadedAt: textSchema,
  extension: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type WorkflowInputFile = z.infer<typeof workflowInputFileSchema>;

export const workflowInputTextPartSchema = z.object({
  id: textSchema,
  type: z.literal('text'),
  text: textSchema,
});
export type WorkflowInputTextPart = z.infer<typeof workflowInputTextPartSchema>;

const workflowInputAssetPartSchema = z.object({
  id: textSchema,
  file: workflowInputFileSchema,
  relativePath: z.string().optional(),
  transferMode: workflowArtifactTransferModeSchema.optional(),
  workspaceFileNodeId: z.string().optional(),
  claimRef: z.string().optional(),
  extractedText: z.string().optional(),
  extractedTextChars: z.number().optional(),
  extractedTextTruncated: z.boolean().optional(),
});

export const workflowInputFilePartSchema = workflowInputAssetPartSchema.extend({
  type: z.literal('file'),
});
export type WorkflowInputFilePart = z.infer<typeof workflowInputFilePartSchema>;

export const workflowInputImagePartSchema = workflowInputAssetPartSchema.extend({
  type: z.literal('image'),
});
export type WorkflowInputImagePart = z.infer<typeof workflowInputImagePartSchema>;

export const workflowInputPartSchema = z.discriminatedUnion('type', [
  workflowInputTextPartSchema,
  workflowInputFilePartSchema,
  workflowInputImagePartSchema,
]);
export type WorkflowInputPart = z.infer<typeof workflowInputPartSchema>;

const workflowInputBaseSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  accepts: z.array(workflowInputAcceptSchema).optional(),
  multiple: z.boolean().optional(),
  required: z.boolean().optional(),
  instructions: z.string().optional(),
});

export const workflowInputTemplateSchema = workflowInputBaseSchema.extend({
  mode: z.literal('template'),
});
export type WorkflowInputTemplate = z.infer<typeof workflowInputTemplateSchema>;

export const workflowInputBoundSchema = workflowInputBaseSchema.extend({
  mode: z.literal('bound'),
  runId: z.string().optional(),
  executionId: z.string().optional(),
  templateNodeId: z.string().optional(),
  parts: z.array(workflowInputPartSchema).min(1),
  summary: z.string().optional(),
});
export type WorkflowInputBound = z.infer<typeof workflowInputBoundSchema>;

export const workflowInputContentSchema = z.discriminatedUnion('mode', [
  workflowInputTemplateSchema,
  workflowInputBoundSchema,
]);
export type WorkflowInputContent = z.infer<typeof workflowInputContentSchema>;

export const workflowRunTextPartSchema = z.object({
  type: z.literal('text'),
  text: textSchema,
});
export type WorkflowRunTextPart = z.infer<typeof workflowRunTextPartSchema>;

const workflowRunAssetPartSchema = z.object({
  field: textSchema,
  transferMode: workflowArtifactTransferModeSchema.optional(),
});

export const workflowRunFilePartSchema = workflowRunAssetPartSchema.extend({
  type: z.literal('file'),
});
export type WorkflowRunFilePart = z.infer<typeof workflowRunFilePartSchema>;

export const workflowRunImagePartSchema = workflowRunAssetPartSchema.extend({
  type: z.literal('image'),
});
export type WorkflowRunImagePart = z.infer<typeof workflowRunImagePartSchema>;

export const workflowRunInputPartSchema = z.discriminatedUnion('type', [
  workflowRunTextPartSchema,
  workflowRunFilePartSchema,
  workflowRunImagePartSchema,
]);
export type WorkflowRunInputPart = z.infer<typeof workflowRunInputPartSchema>;

export const workflowRunInputValueSchema = z.object({
  parts: z.array(workflowRunInputPartSchema).min(1),
});
export type WorkflowRunInputValue = z.infer<typeof workflowRunInputValueSchema>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function listAccepts(content: WorkflowInputContent): string {
  const accepts = content.accepts?.length ? content.accepts.join(', ') : 'text, image, file';
  const multi = content.multiple ? 'multiple' : 'single';
  const required = content.required ? 'required' : 'optional';
  return `${accepts} · ${multi} · ${required}`;
}

function summarizePart(part: WorkflowInputPart): string {
  if (part.type === 'text') {
    return part.text;
  }
  const dims = part.file.width && part.file.height ? ` · ${part.file.width}x${part.file.height}` : '';
  const lines = [part.file.name + dims];
  if (part.relativePath?.trim()) {
    lines.push(`path: ${part.relativePath.trim()}`);
  }
  if (part.claimRef?.trim()) {
    lines.push(`claim: ${part.claimRef.trim()}`);
  }
  const extract = part.extractedText?.trim();
  if (extract) {
    lines.push(extract);
  }
  return lines.join('\n');
}

export function readWorkflowInputContent(value: unknown): WorkflowInputContent | null {
  const parsed = workflowInputContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readWorkflowInputKey(value: unknown): string | undefined {
  return readWorkflowInputContent(value)?.key;
}

export function formatWorkflowInputLabel(value: unknown): string {
  const content = readWorkflowInputContent(value);
  return content?.label?.trim() || content?.key?.trim() || 'Input';
}

export function summarizeWorkflowInputContent(value: unknown): string {
  const content = readWorkflowInputContent(value);
  if (!content) return '';
  if (content.mode === 'template') {
    const lines = [formatWorkflowInputLabel(content), listAccepts(content)];
    if (content.instructions?.trim()) {
      lines.push(content.instructions.trim());
    }
    return lines.join('\n');
  }

  const summary = readString(content.summary)?.trim();
  const lines = [formatWorkflowInputLabel(content), summary || `${content.parts.length} part(s)`];
  const preview = content.parts.slice(0, 3).map((part) => summarizePart(part).trim()).filter(Boolean);
  if (preview.length > 0) {
    lines.push(preview.join('\n\n'));
  }
  return lines.join('\n');
}
