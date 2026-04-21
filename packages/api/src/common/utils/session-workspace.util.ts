import * as os from 'node:os';
import * as path from 'node:path';
import type { SessionWorkspace } from '@cepage/shared-core';

type SessionWorkspaceSource = {
  id: string;
  workspaceParentDirectory: string | null;
  workspaceDirectoryName: string | null;
};

export function buildAutoWorkspaceDirectoryName(sessionId: string): string {
  return `session-${sessionId.slice(0, 8)}`;
}

/**
 * Default parent directory for brand-new sessions created via
 * POST /api/v1/sessions. We stamp this on the session row so the daemon (which
 * spawns agents on the host, not inside the API container) receives a
 * host-valid runtime.cwd instead of falling back to the API container's
 * process.cwd() (= /repo/apps/api in Docker → ENOENT when the daemon mkdir's).
 *
 * Contract when API runs in Docker: the env value MUST point to a host
 * filesystem path, because that's what the native daemon will ultimately
 * resolve. The homedir() fallback is mostly for unit tests and for running
 * the API natively (non-Docker), where container≡host.
 */
export function resolveDefaultWorkspaceParent(): string {
  const explicit = process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT?.trim();
  if (explicit) return explicit;
  return path.join(os.homedir(), 'cepage_workspaces');
}

export function normalizeWorkspaceDirectoryName(
  directoryName: string | null | undefined,
  sessionId: string,
): string {
  const trimmed = (directoryName ?? '').trim();
  if (!trimmed) {
    return buildAutoWorkspaceDirectoryName(sessionId);
  }

  const withoutSeparators = trimmed.replace(/[\\/]+/g, '-').replace(/[\u0000-\u001F]/g, '');
  const normalized = withoutSeparators.replace(/\s+/g, ' ').trim();

  if (!normalized || normalized === '.' || normalized === '..') {
    return buildAutoWorkspaceDirectoryName(sessionId);
  }

  return normalized;
}

export function resolveSessionWorkspace(
  baseDirectory: string,
  parentDirectory: string,
  directoryName: string,
): SessionWorkspace {
  const normalizedParent = parentDirectory.trim();
  const resolvedParent = path.resolve(baseDirectory, normalizedParent);

  return {
    parentDirectory: normalizedParent,
    directoryName,
    workingDirectory: path.join(resolvedParent, directoryName),
  };
}

export function buildSessionWorkspace(
  baseDirectory: string,
  sessionId: string,
  parentDirectory: string,
  directoryName?: string | null,
): SessionWorkspace {
  const normalizedParent = parentDirectory.trim();
  if (!normalizedParent) {
    throw new Error('SESSION_WORKSPACE_PARENT_REQUIRED');
  }

  return resolveSessionWorkspace(
    baseDirectory,
    normalizedParent,
    normalizeWorkspaceDirectoryName(directoryName, sessionId),
  );
}

export function readSessionWorkspace(
  baseDirectory: string,
  session: SessionWorkspaceSource,
): SessionWorkspace | null {
  if (!session.workspaceParentDirectory || !session.workspaceDirectoryName) {
    return null;
  }

  return resolveSessionWorkspace(
    baseDirectory,
    session.workspaceParentDirectory,
    session.workspaceDirectoryName,
  );
}
