import type { GraphNode } from '@cepage/shared-core';
import type { useWorkspaceStore } from '@cepage/state';

/**
 * Subset of the workspace store shape that the chat shell relies on. Kept
 * loose on purpose: the store is the source of truth and we only use what we
 * really need (timeline, files, send, ensureThread, ...).
 */
export type ChatStore = ReturnType<typeof useWorkspaceStore.getState>;

export type ChatShellOpenStudioInput = {
  selectedNodeId?: string;
};

export type ChatShellProps = {
  onOpenStudio: (input?: ChatShellOpenStudioInput) => void;
};

/**
 * Helper that converts the canvas-shaped nodes (as stored in Zustand) into
 * raw {@link GraphNode}s — the format selectors expect. Same as the helper
 * inside the legacy `SimpleChatWorkspace`.
 */
export function toRawGraphNodes(
  nodes: ReturnType<typeof useWorkspaceStore.getState>['nodes'],
): GraphNode[] {
  return nodes.flatMap((node) => {
    const raw = (node.data as { raw?: GraphNode }).raw;
    return raw ? [raw] : [];
  });
}
