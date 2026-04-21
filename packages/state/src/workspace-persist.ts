import {
  applyThemeToDocument,
  cepageForEffectiveMode,
  isThemeCepage,
  isThemeMode,
  resolveEffectiveThemeMode,
} from './theme';
import type { WorkspaceState } from './workspace-store-types';
import { normalizeSelection } from './workspace-agent-selection';
import { CHAT_TAB_ID, type WorkspaceFileTab, type WorkspaceTabsBySession } from './workspace-tabs';

export function noopStorage(): Storage {
  return {
    length: 0,
    clear: () => {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  } as Storage;
}

function readPersistedWorkflowCopilotDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  );
}

function isFileTab(value: unknown): value is WorkspaceFileTab {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<WorkspaceFileTab>;
  return (
    typeof v.id === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.path === 'string' &&
    typeof v.title === 'string'
  );
}

/**
 * Persist tabs per session, dropping any malformed records. We never persist
 * the chat tab itself: it is always synthesized as the default active tab.
 */
function readPersistedWorkspaceTabs(value: unknown): WorkspaceTabsBySession {
  if (!value || typeof value !== 'object') return {};
  const out: WorkspaceTabsBySession = {};
  for (const [sessionId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { byId?: unknown; order?: unknown; activeId?: unknown };
    const byIdSrc = r.byId && typeof r.byId === 'object' ? (r.byId as Record<string, unknown>) : {};
    const byId: Record<string, WorkspaceFileTab> = {};
    for (const [id, tab] of Object.entries(byIdSrc)) {
      if (isFileTab(tab) && tab.id === id) {
        byId[id] = tab;
      }
    }
    const orderSrc = Array.isArray(r.order) ? (r.order as unknown[]) : [];
    const order = orderSrc.filter(
      (id): id is string => typeof id === 'string' && byId[id] !== undefined,
    );
    const activeIdRaw = typeof r.activeId === 'string' ? r.activeId : CHAT_TAB_ID;
    const activeId = activeIdRaw === CHAT_TAB_ID || byId[activeIdRaw] ? activeIdRaw : CHAT_TAB_ID;
    out[sessionId] = { byId, order, activeId };
  }
  return out;
}

export function applyDocLang(locale: WorkspaceState['locale']): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'fr' ? 'fr' : 'en';
}

export function partializeWorkspaceState(s: WorkspaceState) {
  return {
    locale: s.locale,
    themeMode: s.themeMode,
    themeCepage: s.themeCepage,
    prefsPanelOpen: s.prefsPanelOpen,
    lastRunSelection: s.lastRunSelection,
    workflowCopilotDrafts: s.workflowCopilotDrafts,
    workspaceTabs: s.workspaceTabs,
  };
}

/**
 * Persisted-state migration: any legacy `themePalette` (slate / ocean / forest /
 * sunset) is collapsed into a cabernet/chardonnay choice based on the persisted
 * effective mode, and the `themePalette` key is dropped from the next snapshot.
 */
function readPersistedCepage(persisted: Partial<WorkspaceState> & { themePalette?: unknown }, mode: WorkspaceState['themeMode']): WorkspaceState['themeCepage'] {
  if (isThemeCepage(persisted.themeCepage)) {
    return persisted.themeCepage;
  }
  return cepageForEffectiveMode(resolveEffectiveThemeMode(mode));
}

export function mergePersistedWorkspaceState(persisted: unknown, current: WorkspaceState): WorkspaceState {
  const p = (persisted ?? {}) as Partial<WorkspaceState> & { themePalette?: unknown };
  const themeMode = isThemeMode(p.themeMode) ? p.themeMode : current.themeMode;
  const themeCepage = readPersistedCepage(p, themeMode);
  const prefsPanelOpen =
    typeof p.prefsPanelOpen === 'boolean' ? p.prefsPanelOpen : current.prefsPanelOpen;
  const lastRunSelection = p.lastRunSelection ? normalizeSelection(p.lastRunSelection) : current.lastRunSelection;
  const workflowCopilotDrafts = readPersistedWorkflowCopilotDrafts(p.workflowCopilotDrafts);
  const workspaceTabs = readPersistedWorkspaceTabs(p.workspaceTabs);
  return {
    ...current,
    ...p,
    themeMode,
    themeCepage,
    prefsPanelOpen,
    lastRunSelection,
    workflowCopilotDrafts,
    workspaceTabs,
  };
}

export function onWorkspaceRehydrate() {
  return (state?: WorkspaceState) => {
    if (state?.locale) applyDocLang(state.locale);
    if (state?.themeMode != null && state?.themeCepage != null) {
      applyThemeToDocument(state.themeMode, state.themeCepage);
    }
  };
}
