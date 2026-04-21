import type { WorkflowManagedFlowState } from '@cepage/shared-core';

export type WorkflowManagedFlowIndex = Record<string, WorkflowManagedFlowState>;

const CLOSED = new Set<WorkflowManagedFlowState['status']>(['completed', 'failed', 'cancelled']);

function byUpdate(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function indexManagedFlows(rows: readonly WorkflowManagedFlowState[]): WorkflowManagedFlowIndex {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

export function upsertManagedFlow(
  rows: WorkflowManagedFlowIndex,
  row: WorkflowManagedFlowState,
): WorkflowManagedFlowIndex {
  return {
    ...rows,
    [row.id]: row,
  };
}

export function isActiveManagedFlow(row: WorkflowManagedFlowState): boolean {
  return !CLOSED.has(row.status);
}

export function deriveActiveManagedFlows(rows: WorkflowManagedFlowIndex): WorkflowManagedFlowState[] {
  return Object.values(rows).filter(isActiveManagedFlow).sort(byUpdate);
}
