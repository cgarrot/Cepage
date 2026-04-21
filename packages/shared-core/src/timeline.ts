export type TimelineActor = 'human' | 'agent' | 'system';

export interface TimelineEntry {
  id: string;
  timestamp: string;
  actorType: TimelineActor;
  actorId: string;
  runId?: string;
  wakeReason?: string;
  requestId?: string;
  workerId?: string;
  worktreeId?: string;
  summary: string;
  summaryKey?: string;
  summaryParams?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  relatedNodeIds?: string[];
}

export interface TimelinePage {
  items: TimelineEntry[];
  nextCursor: string | null;
}
