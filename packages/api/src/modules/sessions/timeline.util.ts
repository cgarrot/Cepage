import type { Prisma } from '@prisma/client';
import type { TimelineActor, TimelineEntry, TimelinePage } from '@cepage/shared-core';

export const ACTIVITY_LIMIT = 80;
export const TIMELINE_LIMIT_DEFAULT = 50;
export const TIMELINE_LIMIT_MAX = 100;

type Row = {
  id: string;
  timestamp: Date;
  actorType: string;
  actorId: string;
  runId: string | null;
  wakeReason: string | null;
  requestId: string | null;
  workerId: string | null;
  worktreeId: string | null;
  summary: string;
  summaryKey: string | null;
  summaryParams: unknown;
  metadata: unknown;
  relatedNodeIds: unknown;
};

export function clampTimelineLimit(raw: number | undefined): number {
  return Math.min(Math.max(Number(raw) || TIMELINE_LIMIT_DEFAULT, 1), TIMELINE_LIMIT_MAX);
}

export function readTimelineCursor(raw?: string | null): { ts: Date; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf('|');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const ts = new Date(raw.slice(0, idx));
  if (Number.isNaN(ts.getTime())) return null;
  const id = raw.slice(idx + 1);
  if (!id) return null;
  return { ts, id };
}

export function makeTimelineCursor(row: { timestamp: Date; id: string }): string {
  return `${row.timestamp.toISOString()}|${row.id}`;
}

export function buildTimelineWhere(input: {
  sessionId: string;
  actorType?: TimelineActor;
  runId?: string;
  cursor?: { ts: Date; id: string } | null;
}): Prisma.ActivityEntryWhereInput {
  const where: Prisma.ActivityEntryWhereInput = {
    sessionId: input.sessionId,
  };
  if (input.actorType) where.actorType = input.actorType;
  if (input.runId) where.runId = input.runId;
  if (!input.cursor) return where;
  where.OR = [
    { timestamp: { lt: input.cursor.ts } },
    { timestamp: input.cursor.ts, id: { lt: input.cursor.id } },
  ];
  return where;
}

export function readTimelineEntry(row: Row): TimelineEntry {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    actorType: row.actorType as TimelineActor,
    actorId: row.actorId,
    runId: row.runId ?? undefined,
    wakeReason: row.wakeReason ?? undefined,
    requestId: row.requestId ?? undefined,
    workerId: row.workerId ?? undefined,
    worktreeId: row.worktreeId ?? undefined,
    summary: row.summary,
    summaryKey: row.summaryKey ?? undefined,
    summaryParams: readObject(row.summaryParams),
    metadata: readObject(row.metadata),
    relatedNodeIds: readStrings(row.relatedNodeIds),
  };
}

export function buildTimelinePage(rows: Row[], limit: number): TimelinePage {
  const items = rows.slice(0, limit).map(readTimelineEntry);
  return {
    items,
    nextCursor: rows.length > limit && items.length > 0 ? makeTimelineCursor(rows[limit - 1]) : null,
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return ids.length > 0 ? ids : undefined;
}
