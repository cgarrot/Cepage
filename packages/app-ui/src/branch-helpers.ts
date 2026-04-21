import type { Branch } from '@cepage/shared-core';

export function readSelectedBranch(rows: Branch[], branchId: string | null): Branch | null {
  if (!branchId) return null;
  return rows.find((row) => row.id === branchId) ?? null;
}

export function readMergeTargets(rows: Branch[], branchId: string | null): Branch[] {
  return rows.filter((row) => row.status === 'active' && row.id !== branchId);
}
