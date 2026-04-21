import type { WorkflowControllerState } from '@cepage/shared-core';
import type { LiveRunDescriptor } from './workspace-types';

export type WorkflowControllerIndex = Record<string, WorkflowControllerState>;

const CLOSED = new Set<WorkflowControllerState['status']>(['completed', 'failed', 'cancelled']);

function byUpdate(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function indexControllers(rows: readonly WorkflowControllerState[]): WorkflowControllerIndex {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

export function upsertController(
  rows: WorkflowControllerIndex,
  row: WorkflowControllerState,
): WorkflowControllerIndex {
  return {
    ...rows,
    [row.id]: row,
  };
}

export function isActiveController(row: WorkflowControllerState): boolean {
  return !CLOSED.has(row.status);
}

export function deriveActiveControllers(rows: WorkflowControllerIndex): WorkflowControllerState[] {
  return Object.values(rows).filter(isActiveController).sort(byUpdate);
}

export function deriveActiveRuns(rows: readonly LiveRunDescriptor[]): LiveRunDescriptor[] {
  return rows.filter((row) => row.isActive).sort((a, b) => b.lastUpdateAt.localeCompare(a.lastUpdateAt));
}
