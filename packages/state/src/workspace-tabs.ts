/**
 * Workspace tabs — Open files inside the chat shell as tabs alongside the
 * pinned chat tab. Tabs are persisted per session so reopening a session keeps
 * the working set; switching sessions restores that session's tab list.
 */

export const CHAT_TAB_ID = 'chat';

export type WorkspaceFileTab = {
  id: string;
  sessionId: string;
  path: string;
  title: string;
};

export type WorkspaceTabsState = {
  byId: Record<string, WorkspaceFileTab>;
  order: string[];
  activeId: string;
};

export type WorkspaceTabsBySession = Record<string, WorkspaceTabsState>;

export function emptyTabsState(): WorkspaceTabsState {
  return {
    byId: {},
    order: [],
    activeId: CHAT_TAB_ID,
  };
}

export function getSessionTabs(
  bySession: WorkspaceTabsBySession,
  sessionId: string | null,
): WorkspaceTabsState {
  if (!sessionId) {
    return emptyTabsState();
  }
  return bySession[sessionId] ?? emptyTabsState();
}

function tabIdFor(sessionId: string, filePath: string): string {
  return `file:${sessionId}:${filePath}`;
}

function deriveTitle(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return path;
  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

export function openFileTab(
  bySession: WorkspaceTabsBySession,
  sessionId: string,
  file: { path: string; title?: string },
): { next: WorkspaceTabsBySession; tabId: string } {
  const path = file.path.trim();
  if (!path) {
    return { next: bySession, tabId: getSessionTabs(bySession, sessionId).activeId };
  }
  const id = tabIdFor(sessionId, path);
  const current = getSessionTabs(bySession, sessionId);
  const existing = current.byId[id];
  const title = file.title?.trim() || deriveTitle(path);
  const tab: WorkspaceFileTab = existing
    ? { ...existing, title: existing.title || title }
    : { id, sessionId, path, title };
  const order = current.order.includes(id) ? current.order : [...current.order, id];
  const next: WorkspaceTabsBySession = {
    ...bySession,
    [sessionId]: {
      byId: { ...current.byId, [id]: tab },
      order,
      activeId: id,
    },
  };
  return { next, tabId: id };
}

export function closeFileTab(
  bySession: WorkspaceTabsBySession,
  sessionId: string,
  tabId: string,
): WorkspaceTabsBySession {
  if (tabId === CHAT_TAB_ID) {
    return bySession;
  }
  const current = getSessionTabs(bySession, sessionId);
  if (!current.byId[tabId]) {
    return bySession;
  }
  const order = current.order.filter((id) => id !== tabId);
  const { [tabId]: _removed, ...byId } = current.byId;
  let activeId = current.activeId;
  if (activeId === tabId) {
    const previousIndex = current.order.indexOf(tabId);
    activeId = order[Math.min(previousIndex, order.length - 1)] ?? CHAT_TAB_ID;
  }
  return {
    ...bySession,
    [sessionId]: { byId, order, activeId },
  };
}

export function setActiveTab(
  bySession: WorkspaceTabsBySession,
  sessionId: string,
  tabId: string,
): WorkspaceTabsBySession {
  const current = getSessionTabs(bySession, sessionId);
  if (tabId !== CHAT_TAB_ID && !current.byId[tabId]) {
    return bySession;
  }
  if (current.activeId === tabId) {
    return bySession;
  }
  return {
    ...bySession,
    [sessionId]: { ...current, activeId: tabId },
  };
}

export function isFileTab(tabId: string): boolean {
  return tabId !== CHAT_TAB_ID;
}
