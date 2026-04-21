import { z } from 'zod';

const textSchema = z.string().min(1);

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export const connectorTargetKindSchema = z.enum(['http', 'process']);
export type ConnectorTargetKind = z.infer<typeof connectorTargetKindSchema>;

export const connectorExecutionStatusSchema = z.enum([
  'planned',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ConnectorExecutionStatus = z.infer<typeof connectorExecutionStatusSchema>;

export const connectorValueSourceSchema = z.union([
  z.string(),
  z.object({
    kind: z.literal('env'),
    name: textSchema,
    optional: z.boolean().optional(),
  }),
]);
export type ConnectorValueSource = z.infer<typeof connectorValueSourceSchema>;

export const connectorJsonValuePointerSchema = z.object({
  path: textSchema,
  jsonPath: z.string().optional(),
});
export type ConnectorJsonValuePointer = z.infer<typeof connectorJsonValuePointerSchema>;

export const connectorHttpUrlSourceSchema = z.union([
  textSchema,
  connectorJsonValuePointerSchema,
]);
export type ConnectorHttpUrlSource = z.infer<typeof connectorHttpUrlSourceSchema>;

export const connectorHttpBodySourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('json'),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal('file'),
    path: textSchema,
    format: z.enum(['text', 'json', 'binary']).default('json'),
  }),
]);
export type ConnectorHttpBodySource = z.infer<typeof connectorHttpBodySourceSchema>;

export const connectorHttpOutputSchema = z.object({
  path: textSchema,
  format: z.enum(['text', 'json', 'binary']).default('json'),
});
export type ConnectorHttpOutput = z.infer<typeof connectorHttpOutputSchema>;

export const connectorProcessInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('file'),
    path: textSchema,
    format: z.enum(['text', 'binary']).default('text'),
  }),
]);
export type ConnectorProcessInput = z.infer<typeof connectorProcessInputSchema>;

// Connector targets can wrap long-running external services (Midjourney
// generates an image+video+extends pipeline in 20-40 min, YouTube uploads of
// large clips can take a few minutes). The previous 10-min cap was too tight,
// so we widen to 4h while still preventing accidentally infinite values.
const connectorTargetBaseSchema = z.object({
  title: z.string().optional(),
  timeoutMs: z.number().int().positive().max(4 * 60 * 60 * 1000).default(60_000),
});

export const connectorHttpTargetContentSchema = connectorTargetBaseSchema.extend({
  kind: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: connectorHttpUrlSourceSchema,
  headers: z.record(z.string(), connectorValueSourceSchema).default({}),
  body: connectorHttpBodySourceSchema.optional(),
  successStatusCodes: z.array(z.number().int().min(100).max(599)).min(1).optional(),
  output: connectorHttpOutputSchema.optional(),
  metadataPath: z.string().optional(),
});
export type ConnectorHttpTargetContent = z.infer<typeof connectorHttpTargetContentSchema>;

export const connectorProcessTargetContentSchema = connectorTargetBaseSchema.extend({
  kind: z.literal('process'),
  command: textSchema,
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), connectorValueSourceSchema).default({}),
  stdin: connectorProcessInputSchema.optional(),
  successExitCodes: z.array(z.number().int()).min(1).optional(),
  stdoutPath: z.string().optional(),
  stderrPath: z.string().optional(),
  metadataPath: z.string().optional(),
});
export type ConnectorProcessTargetContent = z.infer<typeof connectorProcessTargetContentSchema>;

export const connectorTargetContentSchema = z.discriminatedUnion('kind', [
  connectorHttpTargetContentSchema,
  connectorProcessTargetContentSchema,
]);
export type ConnectorTargetContent = z.infer<typeof connectorTargetContentSchema>;

export type ConnectorTargetSummary = ConnectorTargetContent & {
  targetNodeId: string;
};

export const connectorRunSummarySchema = z.object({
  runNodeId: textSchema,
  targetNodeId: textSchema,
  kind: connectorTargetKindSchema,
  status: connectorExecutionStatusSchema,
  title: z.string().optional(),
  startedAt: textSchema.optional(),
  endedAt: textSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  url: z.string().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  exitCode: z.number().int().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  outputPath: z.string().optional(),
  stdoutPath: z.string().optional(),
  stderrPath: z.string().optional(),
  metadataPath: z.string().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  stdoutBytes: z.number().int().nonnegative().optional(),
  stderrBytes: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
});
export type ConnectorRunSummary = z.infer<typeof connectorRunSummarySchema>;

export function readConnectorTargetContent(value: unknown): ConnectorTargetContent | null {
  const parsed = connectorTargetContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readConnectorTargetSummary(value: unknown): ConnectorTargetSummary | null {
  const direct = readRecord(value);
  const summary = readRecord(direct?.connectorTarget) ?? direct;
  if (!summary) {
    return null;
  }
  const targetNodeId =
    typeof summary.targetNodeId === 'string'
      ? summary.targetNodeId
      : typeof summary.nodeId === 'string'
        ? summary.nodeId
        : null;
  const parsed = connectorTargetContentSchema.safeParse(summary);
  if (!parsed.success || !targetNodeId) {
    return null;
  }
  return {
    targetNodeId,
    ...parsed.data,
  };
}

export function readConnectorRunSummary(value: unknown): ConnectorRunSummary | null {
  const direct = readRecord(value);
  const summary = readRecord(direct?.connectorRun) ?? direct;
  const parsed = connectorRunSummarySchema.safeParse(summary);
  return parsed.success ? parsed.data : null;
}
