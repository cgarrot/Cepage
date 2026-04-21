import type { ActivityLine } from '@cepage/state';

export function filterTimeline(
  rows: ActivityLine[],
  actor: 'all' | ActivityLine['actorType'],
  runId: string,
): ActivityLine[] {
  return rows.filter((row) => {
    if (actor !== 'all' && row.actorType !== actor) return false;
    if (runId && row.runId !== runId) return false;
    return true;
  });
}

export function readTimelineRuns(rows: ActivityLine[]): string[] {
  return [...new Set(rows.map((row) => row.runId).filter((row): row is string => Boolean(row)))];
}

export function readTimelineNode(row: ActivityLine): string | null {
  return row.relatedNodeIds?.[0] ?? null;
}
