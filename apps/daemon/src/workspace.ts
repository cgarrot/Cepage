import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Workspace manager. A single workspace root hosts one directory per session.
 * The daemon never clones or migrates anything here; it simply guarantees the
 * target directory exists so agent adapters can chdir into a stable local path.
 */
export class WorkspaceManager {
  constructor(private readonly root: string) {
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
    }
  }

  /**
   * Resolve the working directory the adapter should run in. Callers may pass
   * either an absolute path (kept as-is) or a relative one that we resolve
   * beneath the workspace root.
   */
  resolveCwd(sessionId: string, requested: string | undefined): string {
    const base = requested && requested.trim().length > 0 ? requested : sessionId;
    const resolved = path.isAbsolute(base) ? base : path.join(this.root, base);
    if (!existsSync(resolved)) {
      mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  getRoot(): string {
    return this.root;
  }
}
