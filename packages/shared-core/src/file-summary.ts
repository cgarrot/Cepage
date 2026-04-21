import { z } from 'zod';
import type { NodeAgentSelection } from './node-agent-selection';

export const fileSummaryKindSchema = z.enum(['text', 'image', 'binary']);
export type FileSummaryKind = z.infer<typeof fileSummaryKindSchema>;

export const fileSummaryStatusSchema = z.enum([
  'empty',
  'pending',
  'ready',
  'summarizing',
  'done',
  'error',
]);
export type FileSummaryStatus = z.infer<typeof fileSummaryStatusSchema>;

export const fileSummarySourceSchema = z.enum(['generated', 'user']);
export type FileSummarySource = z.infer<typeof fileSummarySourceSchema>;

export const fileSummaryStorageKindSchema = z.enum(['workspace', 'home']);
export type FileSummaryStorageKind = z.infer<typeof fileSummaryStorageKindSchema>;

export interface FileSummaryModelRef {
  providerID: string;
  modelID: string;
}

export interface FileSummaryFile {
  name: string;
  mimeType: string;
  size: number;
  kind: FileSummaryKind;
  uploadedAt: string;
  extension?: string;
  width?: number;
  height?: number;
}

export interface FileSummaryWorkspaceStorage {
  kind: 'workspace';
  relativePath: string;
  parentDirectory: string;
  directoryName: string;
}

export interface FileSummaryHomeStorage {
  kind: 'home';
  relativePath: string;
}

export type FileSummaryStorage = FileSummaryWorkspaceStorage | FileSummaryHomeStorage;

export interface FileSummaryItem {
  id: string;
  file: FileSummaryFile;
  storage?: FileSummaryStorage;
  extractedText?: string;
  extractedTextChars?: number;
  extractedTextTruncated?: boolean;
  summary?: string;
  summaryUpdatedAt?: string;
  status?: FileSummaryStatus;
  error?: string;
}

export interface FileSummaryContent {
  files?: FileSummaryItem[];
  agentType?: string;
  model?: FileSummaryModelRef;
  agentSelection?: NodeAgentSelection;
  summary?: string;
  summaryUpdatedAt?: string;
  generatedSummary?: string;
  generatedSummaryUpdatedAt?: string;
  summarySource?: FileSummarySource;
  status?: FileSummaryStatus;
  error?: string;
}

export const FILE_SUMMARY_LEGACY_ID = 'legacy-0';

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readStatus(value: unknown): FileSummaryStatus | undefined {
  return typeof value === 'string' && fileSummaryStatusSchema.safeParse(value).success
    ? (value as FileSummaryStatus)
    : undefined;
}

function readSource(value: unknown): FileSummarySource | undefined {
  return typeof value === 'string' && fileSummarySourceSchema.safeParse(value).success
    ? (value as FileSummarySource)
    : undefined;
}

function readStorage(value: unknown): FileSummaryStorage | undefined {
  const record = readRecord(value);
  const kind = readString(record?.kind);
  const relativePath = readString(record?.relativePath);
  if (!kind || !relativePath || !fileSummaryStorageKindSchema.safeParse(kind).success) {
    return undefined;
  }
  if (kind === 'home') {
    return { kind: 'home', relativePath };
  }
  const parentDirectory = readString(record?.parentDirectory);
  const directoryName = readString(record?.directoryName);
  if (!parentDirectory || !directoryName) {
    return undefined;
  }
  return {
    kind: 'workspace',
    relativePath,
    parentDirectory,
    directoryName,
  };
}

function readModel(value: unknown): FileSummaryModelRef | undefined {
  const record = readRecord(value);
  const providerID = readString(record?.providerID);
  const modelID = readString(record?.modelID);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function readAgentType(value: unknown): NonNullable<NodeAgentSelection['selection']>['type'] | undefined {
  if (
    value === 'orchestrator' ||
    value === 'opencode' ||
    value === 'claude_code' ||
    value === 'cursor_agent' ||
    value === 'codex' ||
    value === 'custom'
  ) {
    return value;
  }
  return undefined;
}

function readAgentSelection(record: Record<string, unknown>): NodeAgentSelection | undefined {
  const next = readRecord(record.agentSelection);
  const mode = readString(next?.mode);
  if (mode === 'inherit') {
    return { mode };
  }
  if (mode === 'locked') {
    const selection = readRecord(next?.selection);
    const type = readAgentType(selection?.type);
    if (!type) return undefined;
    const model = readModel(selection?.model);
    return model ? { mode, selection: { type, model } } : { mode, selection: { type } };
  }
  const type = readAgentType(record.agentType);
  if (!type) return undefined;
  const model = readModel(record.model);
  return model ? { mode: 'locked', selection: { type, model } } : { mode: 'locked', selection: { type } };
}

function readFile(value: unknown): FileSummaryFile | undefined {
  const record = readRecord(value);
  const name = readString(record?.name);
  const mimeType = readString(record?.mimeType);
  const size = readNumber(record?.size);
  const kindValue = readString(record?.kind);
  const uploadedAt = readString(record?.uploadedAt);
  if (!name || !mimeType || size == null || !uploadedAt) return undefined;
  if (!kindValue || !fileSummaryKindSchema.safeParse(kindValue).success) return undefined;
  const width = readNumber(record?.width);
  const height = readNumber(record?.height);
  return {
    name,
    mimeType,
    size,
    kind: kindValue as FileSummaryKind,
    uploadedAt,
    extension: readString(record?.extension),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
  };
}

function readFileItem(value: unknown): FileSummaryItem | undefined {
  const record = readRecord(value);
  const id = readString(record?.id);
  const file = readFile(record?.file);
  if (!id || !file) return undefined;
  const extractedText = readString(record?.extractedText);
  const summary = readString(record?.summary);
  const summaryUpdatedAt = readString(record?.summaryUpdatedAt);
  const storage = readStorage(record?.storage);
  return {
    id,
    file,
    ...(storage ? { storage } : {}),
    ...(extractedText !== undefined ? { extractedText } : {}),
    ...(readNumber(record?.extractedTextChars) != null
      ? { extractedTextChars: readNumber(record?.extractedTextChars) }
      : {}),
    ...(readBoolean(record?.extractedTextTruncated) != null
      ? { extractedTextTruncated: readBoolean(record?.extractedTextTruncated) }
      : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(summaryUpdatedAt ? { summaryUpdatedAt } : {}),
    ...(readStatus(record?.status) ? { status: readStatus(record?.status) } : {}),
    ...(readString(record?.error) ? { error: readString(record?.error) } : {}),
  };
}

function readLegacyFileItem(record: Record<string, unknown>): FileSummaryItem | undefined {
  const file = readFile(record.file);
  if (!file) return undefined;
  const extractedText = readString(record.extractedText);
  const summary = readString(record.summary);
  const summaryUpdatedAt = readString(record.summaryUpdatedAt);
  const storage = readStorage(record.storage);
  return {
    id: FILE_SUMMARY_LEGACY_ID,
    file,
    ...(storage ? { storage } : {}),
    ...(extractedText !== undefined ? { extractedText } : {}),
    ...(readNumber(record.extractedTextChars) != null
      ? { extractedTextChars: readNumber(record.extractedTextChars) }
      : {}),
    ...(readBoolean(record.extractedTextTruncated) != null
      ? { extractedTextTruncated: readBoolean(record.extractedTextTruncated) }
      : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(summaryUpdatedAt ? { summaryUpdatedAt } : {}),
    ...(readStatus(record.status) ? { status: readStatus(record.status) } : {}),
    ...(readString(record.error) ? { error: readString(record.error) } : {}),
  };
}

export function readFileSummaryContent(value: unknown): FileSummaryContent | null {
  const record = readRecord(value);
  if (!record) return null;
  const files = Array.isArray(record.files)
    ? record.files
        .map((entry) => readFileItem(entry))
        .filter((entry): entry is FileSummaryItem => entry !== undefined)
    : [];
  const legacy = files.length === 0 ? readLegacyFileItem(record) : undefined;
  const model = readModel(record.model);
  const summary = readString(record.summary);
  const summaryUpdatedAt = readString(record.summaryUpdatedAt);
  const generatedSummary =
    readString(record.generatedSummary) ??
    (legacy && summary ? summary : undefined);
  const generatedSummaryUpdatedAt =
    readString(record.generatedSummaryUpdatedAt) ??
    (legacy && summaryUpdatedAt ? summaryUpdatedAt : undefined);
  const summarySource =
    readSource(record.summarySource) ??
    (legacy && summary ? 'generated' : undefined);
  const agentSelection = readAgentSelection(record);
  const content: FileSummaryContent = {
    ...(files.length > 0 ? { files } : legacy ? { files: [legacy] } : {}),
    ...(readString(record.agentType) ? { agentType: readString(record.agentType) } : {}),
    ...(model ? { model } : {}),
    ...(agentSelection ? { agentSelection } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(summaryUpdatedAt ? { summaryUpdatedAt } : {}),
    ...(generatedSummary !== undefined ? { generatedSummary } : {}),
    ...(generatedSummaryUpdatedAt ? { generatedSummaryUpdatedAt } : {}),
    ...(summarySource ? { summarySource } : {}),
    ...(readStatus(record.status) ? { status: readStatus(record.status) } : {}),
    ...(readString(record.error) ? { error: readString(record.error) } : {}),
  };
  return Object.keys(content).length > 0 ? content : null;
}
