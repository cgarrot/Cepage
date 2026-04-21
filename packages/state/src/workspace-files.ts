import type { GraphNode } from '@cepage/shared-core';
import { readWorkflowArtifactContent } from '@cepage/shared-core';

/**
 * View-models for the right-side "workspace files" panel.
 *
 * The store holds workspace files as `workspace_file` nodes. The chat shell
 * needs both:
 *   1. A flat list (for sorting / filtering / search), and
 *   2. A folder tree (for the file explorer).
 *
 * Selectors are pure so they can be memoised by callers.
 */

export type WorkspaceFileEntry = {
  id: string;
  title: string;
  path: string;
  resolvedPath?: string;
  status: 'declared' | 'available' | 'missing' | 'deleted';
  role: 'input' | 'output' | 'intermediate';
  origin: 'user_upload' | 'agent_output' | 'workspace_existing' | 'derived';
  change?: 'added' | 'modified' | 'deleted';
  mimeType?: string;
  size?: number;
  summary?: string;
  excerpt?: string;
  updatedAt: string;
  createdAt: string;
  node: GraphNode;
};

export type WorkspaceFileTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: WorkspaceFileTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      entry: WorkspaceFileEntry;
    };

function buildEntry(node: GraphNode): WorkspaceFileEntry | null {
  if (node.type !== 'workspace_file') return null;
  const artifact = readWorkflowArtifactContent(node.content);
  if (!artifact) return null;
  const path = artifact.resolvedRelativePath?.trim() || artifact.relativePath;
  if (!path) return null;
  return {
    id: node.id,
    title: artifact.title?.trim() || artifact.relativePath,
    path,
    ...(artifact.resolvedRelativePath?.trim()
      ? { resolvedPath: artifact.resolvedRelativePath.trim() }
      : {}),
    status: artifact.status ?? 'declared',
    role: artifact.role,
    origin: artifact.origin,
    ...(artifact.change ? { change: artifact.change } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    ...(typeof artifact.size === 'number' ? { size: artifact.size } : {}),
    ...(artifact.summary?.trim() ? { summary: artifact.summary.trim() } : {}),
    ...(artifact.excerpt?.trim() ? { excerpt: artifact.excerpt.trim() } : {}),
    updatedAt: node.updatedAt,
    createdAt: node.createdAt,
    node,
  };
}

function compareEntries(a: WorkspaceFileEntry, b: WorkspaceFileEntry): number {
  // newest first; chat workflows usually want the freshest output up top.
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.path.localeCompare(b.path);
}

/** Flat list, newest first, of every workspace_file node currently in the graph. */
export function selectWorkspaceFiles(nodes: readonly GraphNode[]): WorkspaceFileEntry[] {
  const out: WorkspaceFileEntry[] = [];
  for (const node of nodes) {
    const entry = buildEntry(node);
    if (entry) out.push(entry);
  }
  out.sort(compareEntries);
  return out;
}

type DirectoryAccumulator = {
  kind: 'dir';
  name: string;
  path: string;
  children: Map<string, DirectoryAccumulator | FileAccumulator>;
};

type FileAccumulator = {
  kind: 'file';
  name: string;
  path: string;
  entry: WorkspaceFileEntry;
};

function ensureDir(
  parent: DirectoryAccumulator,
  segment: string,
  parentPath: string,
): DirectoryAccumulator {
  const existing = parent.children.get(segment);
  if (existing && existing.kind === 'dir') {
    return existing;
  }
  const dir: DirectoryAccumulator = {
    kind: 'dir',
    name: segment,
    path: parentPath ? `${parentPath}/${segment}` : segment,
    children: new Map(),
  };
  parent.children.set(segment, dir);
  return dir;
}

function compareTreeNodes(a: WorkspaceFileTreeNode, b: WorkspaceFileTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function flattenTree(node: DirectoryAccumulator | FileAccumulator): WorkspaceFileTreeNode {
  if (node.kind === 'file') {
    return { kind: 'file', name: node.name, path: node.path, entry: node.entry };
  }
  const children: WorkspaceFileTreeNode[] = [];
  for (const child of node.children.values()) {
    children.push(flattenTree(child));
  }
  children.sort(compareTreeNodes);
  return { kind: 'directory', name: node.name, path: node.path, children };
}

/**
 * Build a folder tree from the flat file list. Empty paths and `..` segments
 * are silently skipped — the artifact reader normalises those away earlier.
 */
export function buildWorkspaceFileTree(
  entries: readonly WorkspaceFileEntry[],
): WorkspaceFileTreeNode[] {
  const root: DirectoryAccumulator = {
    kind: 'dir',
    name: '',
    path: '',
    children: new Map(),
  };
  for (const entry of entries) {
    const segments = entry.path
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
    if (segments.length === 0) continue;
    const fileName = segments[segments.length - 1]!;
    let cursor = root;
    let cursorPath = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i]!;
      cursor = ensureDir(cursor, seg, cursorPath);
      cursorPath = cursor.path;
    }
    if (cursor.children.has(fileName)) continue;
    cursor.children.set(fileName, {
      kind: 'file',
      name: fileName,
      path: entry.path,
      entry,
    });
  }
  const out: WorkspaceFileTreeNode[] = [];
  for (const child of root.children.values()) {
    out.push(flattenTree(child));
  }
  out.sort(compareTreeNodes);
  return out;
}

/**
 * Convenience selector that returns both the sorted list and the tree in
 * a single pass — useful for components that need both surfaces.
 */
export function selectWorkspaceFilesView(
  nodes: readonly GraphNode[],
): { entries: WorkspaceFileEntry[]; tree: WorkspaceFileTreeNode[] } {
  const entries = selectWorkspaceFiles(nodes);
  return { entries, tree: buildWorkspaceFileTree(entries) };
}

/**
 * Find the workspace_file entry that corresponds to a given relative path.
 *
 * Used by the file viewer to detect "declared but not yet produced" files so it
 * can show a friendly placeholder instead of a generic 404 when the agent has
 * announced an output that hasn't actually been written to disk.
 */
export function findWorkspaceFileEntry(
  nodes: readonly GraphNode[],
  filePath: string,
): WorkspaceFileEntry | null {
  if (!filePath) return null;
  for (const node of nodes) {
    const entry = buildEntry(node);
    if (!entry) continue;
    if (entry.path === filePath || entry.resolvedPath === filePath) return entry;
  }
  return null;
}
