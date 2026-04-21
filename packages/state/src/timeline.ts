import type { TimelineEntry } from '@cepage/shared-core';

function key(row: TimelineEntry): string {
  return row.id || `${row.timestamp}:${row.actorType}:${row.actorId}:${row.summary}`;
}

export function mergeTimelineHead(rows: TimelineEntry[], row: TimelineEntry, limit: number): TimelineEntry[] {
  return [row, ...rows.filter((entry) => key(entry) !== key(row))].slice(0, limit);
}

export function mergeTimelinePage(rows: TimelineEntry[], page: TimelineEntry[]): TimelineEntry[] {
  const seen = new Set(rows.map(key));
  const next = [...rows];
  for (const row of page) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(row);
  }
  return next;
}
