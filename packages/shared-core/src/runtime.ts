import { z } from 'zod';
import type { WebPreviewInfo } from './graph';

export const runtimeTargetKindSchema = z.enum(['web', 'cli', 'api', 'worker', 'binary']);
export type RuntimeTargetKind = z.infer<typeof runtimeTargetKindSchema>;

export const runtimeLaunchModeSchema = z.enum(['local_process', 'docker']);
export type RuntimeLaunchMode = z.infer<typeof runtimeLaunchModeSchema>;

export const runtimePortProtocolSchema = z.enum(['http', 'https', 'tcp', 'udp']);
export type RuntimePortProtocol = z.infer<typeof runtimePortProtocolSchema>;

export const runtimePreviewModeSchema = z.enum(['auto', 'static', 'server', 'none']);
export type RuntimePreviewMode = z.infer<typeof runtimePreviewModeSchema>;

export const runtimeExecutionStatusSchema = z.enum([
  'planned',
  'launching',
  'running',
  'completed',
  'failed',
  'stopped',
]);
export type RuntimeExecutionStatus = z.infer<typeof runtimeExecutionStatusSchema>;

export const runtimeManifestSourceSchema = z.enum(['event', 'file', 'text', 'detected']);
export type RuntimeManifestSource = z.infer<typeof runtimeManifestSourceSchema>;

export const runtimePortSchema = z.object({
  name: z.string().optional(),
  port: z.number().int().nonnegative(),
  targetPort: z.number().int().nonnegative().optional(),
  protocol: runtimePortProtocolSchema.optional(),
});
export type RuntimePortSpec = z.infer<typeof runtimePortSchema>;

export const runtimePreviewSchema = z.object({
  mode: runtimePreviewModeSchema.optional(),
  entry: z.string().optional(),
  route: z.string().optional(),
  port: z.number().int().nonnegative().optional(),
});
export type RuntimePreviewSpec = z.infer<typeof runtimePreviewSchema>;

export const runtimeDockerSchema = z.object({
  image: z.string().optional(),
  workingDir: z.string().optional(),
  mounts: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z.array(runtimePortSchema).optional(),
});
export type RuntimeDockerSpec = z.infer<typeof runtimeDockerSchema>;

export const runnableArtifactManifestSchema = z.object({
  id: z.string().optional(),
  kind: runtimeTargetKindSchema,
  launchMode: runtimeLaunchModeSchema.default('local_process'),
  serviceName: z.string().min(1),
  cwd: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z.array(runtimePortSchema).optional(),
  entrypoint: z.string().optional(),
  preview: runtimePreviewSchema.optional(),
  monorepoRole: z.string().optional(),
  docker: runtimeDockerSchema.optional(),
  autoRun: z.boolean().optional(),
});
export type RunnableArtifactManifest = z.infer<typeof runnableArtifactManifestSchema>;

export const runtimeManifestEnvelopeSchema = z.object({
  schema: z.literal('cepage.runtime/v1').default('cepage.runtime/v1'),
  schemaVersion: z.literal(1).default(1),
  targets: z.array(runnableArtifactManifestSchema).min(1),
});
export type RuntimeManifestEnvelope = z.infer<typeof runtimeManifestEnvelopeSchema>;

export interface RuntimeHint {
  kind?: RuntimeTargetKind;
  serviceName?: string;
  cwd?: string;
  summary?: string;
}

export interface RuntimeFileWriteEvent {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
}

export interface RuntimeSpawnRequest {
  targetId?: string;
  autoRun?: boolean;
}

export interface RuntimeTargetSummary {
  targetNodeId: string;
  sourceRunId?: string;
  outputNodeId?: string;
  kind: RuntimeTargetKind;
  launchMode: RuntimeLaunchMode;
  serviceName: string;
  cwd: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  ports?: RuntimePortSpec[];
  entrypoint?: string;
  preview?: RuntimePreviewSpec;
  monorepoRole?: string;
  docker?: RuntimeDockerSpec;
  autoRun: boolean;
  source: RuntimeManifestSource;
}

export interface RuntimeRunSummary {
  runNodeId: string;
  targetNodeId: string;
  sourceRunId?: string;
  targetKind: RuntimeTargetKind;
  launchMode: RuntimeLaunchMode;
  serviceName: string;
  cwd: string;
  command?: string;
  args?: string[];
  ports?: RuntimePortSpec[];
  entrypoint?: string;
  monorepoRole?: string;
  docker?: RuntimeDockerSpec;
  status: RuntimeExecutionStatus;
  startedAt?: string;
  endedAt?: string;
  pid?: number;
  exitCode?: number;
  logs?: string;
  error?: string;
  preview?: WebPreviewInfo;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeRuntimeManifestEnvelope(value: unknown): RuntimeManifestEnvelope | null {
  if (!value) return null;
  const envelope = runtimeManifestEnvelopeSchema.safeParse(value);
  if (envelope.success) {
    return envelope.data;
  }
  const manifest = runnableArtifactManifestSchema.safeParse(value);
  if (manifest.success) {
    return {
      schema: 'cepage.runtime/v1',
      schemaVersion: 1,
      targets: [manifest.data],
    };
  }
  const record = readRecord(value);
  if (!record) return null;
  if (Array.isArray(record.targets)) {
    const targets = record.targets
      .map((entry) => runnableArtifactManifestSchema.safeParse(entry))
      .filter((entry): entry is z.SafeParseSuccess<RunnableArtifactManifest> => entry.success)
      .map((entry) => entry.data);
    if (targets.length > 0) {
      return {
        schema: 'cepage.runtime/v1',
        schemaVersion: 1,
        targets,
      };
    }
  }
  return null;
}

function parseJsonCandidate(value: string): RuntimeManifestEnvelope | null {
  try {
    return normalizeRuntimeManifestEnvelope(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseRuntimeManifestText(text: string): RuntimeManifestEnvelope | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = parseJsonCandidate(trimmed);
  if (direct) return direct;

  const fences = [...trimmed.matchAll(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g)];
  for (const match of fences) {
    const language = (match[1] ?? '').trim().toLowerCase();
    const body = (match[2] ?? '').trim();
    if (!body) continue;
    if (language && !['json', 'cepage-run', 'cepage-runtime', 'cepageruntime'].includes(language)) {
      continue;
    }
    const parsed = parseJsonCandidate(body);
    if (parsed) return parsed;
  }

  const jsonBlocks = trimmed.match(/\{[\s\S]*\}/g) ?? [];
  for (const block of jsonBlocks) {
    const parsed = parseJsonCandidate(block);
    if (parsed) return parsed;
  }

  return null;
}

export function readRuntimeTargetSummary(value: unknown): RuntimeTargetSummary | null {
  const direct = readRecord(value);
  const summary = readRecord(direct?.runtimeTarget) ?? readRecord(direct?.summary) ?? direct;
  if (!summary) return null;
  if (
    typeof summary.targetNodeId !== 'string' ||
    typeof summary.kind !== 'string' ||
    typeof summary.launchMode !== 'string' ||
    typeof summary.serviceName !== 'string' ||
    typeof summary.cwd !== 'string'
  ) {
    return null;
  }
  return summary as unknown as RuntimeTargetSummary;
}

export function readRuntimeRunSummary(value: unknown): RuntimeRunSummary | null {
  const direct = readRecord(value);
  const summary = readRecord(direct?.runtimeRun) ?? readRecord(direct?.summary) ?? direct;
  if (!summary) return null;
  if (
    typeof summary.runNodeId !== 'string' ||
    typeof summary.targetNodeId !== 'string' ||
    typeof summary.targetKind !== 'string' ||
    typeof summary.launchMode !== 'string' ||
    typeof summary.serviceName !== 'string' ||
    typeof summary.cwd !== 'string' ||
    typeof summary.status !== 'string'
  ) {
    return null;
  }
  return summary as unknown as RuntimeRunSummary;
}
