'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  Button,
  IconButton,
  IconPaperclip,
  IconSend,
  IconStop,
  Spinner,
  Surface,
  Textarea,
  Tooltip,
} from '@cepage/ui-kit';
import {
  formatAgentSelectionLabel,
  normalizeWorkflowCopilotAttachmentPath,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES,
  workflowCopilotAttachmentDisplayName,
  workflowCopilotAttachmentMimeAllowed,
  workflowCopilotAttachmentTotalBytes,
  workflowCopilotDataUrlPayloadBytes,
} from '@cepage/shared-core';
import type {
  AgentModelRef,
  AgentType,
  WorkflowCopilotAttachment,
  WorkflowCopilotEnsureThread,
  WorkflowCopilotMode,
  WorkflowCopilotScope,
} from '@cepage/shared-core';
import {
  buildWorkflowCopilotDraftKey,
  readWorkflowCopilotDraft,
  useWorkspaceStore,
} from '@cepage/state';
import { AgentModelMenu } from '../AgentModelMenu';
import { useI18n } from '../I18nProvider';
import { WorkflowCopilotSettingsMenu } from '../WorkflowCopilotSettingsMenu';

const MIN_HEIGHT = 56;
const MAX_HEIGHT = 240;

type PickedFile = {
  file: File;
  relativePath?: string;
};

function guessMimeFromName(name: string): string {
  const x = name.toLowerCase();
  if (x.endsWith('.png')) return 'image/png';
  if (x.endsWith('.jpg') || x.endsWith('.jpeg')) return 'image/jpeg';
  if (x.endsWith('.gif')) return 'image/gif';
  if (x.endsWith('.webp')) return 'image/webp';
  if (x.endsWith('.pdf')) return 'application/pdf';
  if (x.endsWith('.json')) return 'application/json';
  if (x.endsWith('.md')) return 'text/markdown';
  if (x.endsWith('.csv')) return 'text/csv';
  if (x.endsWith('.txt')) return 'text/plain';
  return '';
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function readPickedFilePath(file: File): string | undefined {
  return normalizeWorkflowCopilotAttachmentPath(file.webkitRelativePath);
}

function sortPickedFiles(files: readonly PickedFile[]): PickedFile[] {
  return [...files].sort((a, b) => {
    const left = normalizeWorkflowCopilotAttachmentPath(a.relativePath) ?? a.file.name;
    const right = normalizeWorkflowCopilotAttachmentPath(b.relativePath) ?? b.file.name;
    return left.localeCompare(right) || a.file.name.localeCompare(b.file.name);
  });
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const out: FileSystemEntry[] = [];
  // The reader returns entries in batches; iterate until empty.
  // Reasonable cap protects against pathological deep trees.
  for (let i = 0; i < 64; i += 1) {
    const batch = await readDirectoryBatch(reader);
    if (batch.length === 0) return out;
    out.push(...batch);
  }
  return out;
}

async function collectDroppedEntry(entry: FileSystemEntry, dir = ''): Promise<PickedFile[]> {
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    const relativePath = normalizeWorkflowCopilotAttachmentPath(
      dir ? `${dir}/${file.name}` : undefined,
    );
    return [{ file, ...(relativePath ? { relativePath } : {}) }];
  }
  if (!entry.isDirectory) return [];
  const nextDir = dir ? `${dir}/${entry.name}` : entry.name;
  const entries = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  const groups = await Promise.all(entries.map((child) => collectDroppedEntry(child, nextDir)));
  return groups.flat();
}

async function readDroppedFiles(event: ReactDragEvent<HTMLElement>): Promise<PickedFile[]> {
  const items = Array.from(event.dataTransfer.items ?? []);
  if (items.length > 0) {
    const entries = items
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry != null);
    if (entries.length > 0) {
      const groups = await Promise.all(entries.map((entry) => collectDroppedEntry(entry)));
      const files = groups.flat();
      if (files.length > 0) return sortPickedFiles(files);
    }
  }
  return sortPickedFiles(
    Array.from(event.dataTransfer.files ?? []).map((file) => {
      const relativePath = readPickedFilePath(file);
      return { file, ...(relativePath ? { relativePath } : {}) };
    }),
  );
}

function scopeLabel(
  scope: WorkflowCopilotScope | undefined | null,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!scope || scope.kind === 'session') return t('ui.sidebar.copilotScopeSession');
  if (scope.kind === 'node') return `${t('ui.sidebar.copilotScopeNode')} · ${scope.nodeId.slice(0, 8)}`;
  return `${t('ui.sidebar.copilotScopeSubgraph')} · ${scope.nodeId.slice(0, 8)}`;
}

function scopeSame(a: WorkflowCopilotScope | null | undefined, b: WorkflowCopilotScope): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'session') return true;
  if (b.kind === 'session') return false;
  return a.nodeId === b.nodeId;
}

/**
 * Composer that drives the unified chat. Hosts every action a Copilot user
 * needs without a dedicated sidebar:
 *
 * - text input with draft persistence (per session)
 * - provider/model picker via {@link AgentModelMenu}
 * - mode + scope + auto flags via {@link WorkflowCopilotSettingsMenu}
 * - attachments (files and folders) with size and count limits, drag and drop
 * - context capture for selected nodes (subgraph)
 * - send / stop control with Cmd/Ctrl + Enter shortcut
 */
export function ChatComposer() {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const sending = useWorkspaceStore((s) => s.workflowCopilotSending);
  const stopping = useWorkspaceStore((s) => s.workflowCopilotStopping);
  const stopMessage = useWorkspaceStore((s) => s.stopWorkflowCopilot);
  const sendMessage = useWorkspaceStore((s) => s.sendWorkflowCopilotMessage);
  const bootstrapSession = useWorkspaceStore((s) => s.bootstrapNewSession);
  const ensureThread = useWorkspaceStore((s) => s.ensureWorkflowCopilotThread);
  const patchThread = useWorkspaceStore((s) => s.patchWorkflowCopilotThread);
  const setDraft = useWorkspaceStore((s) => s.setWorkflowCopilotDraft);
  const setLastRunSelection = useWorkspaceStore((s) => s.setLastRunSelection);
  const thread = useWorkspaceStore((s) => s.workflowCopilotThread);
  const lastRunSelection = useWorkspaceStore((s) => s.lastRunSelection);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const selected = useWorkspaceStore((s) => s.selected);
  const contextAccepted = useWorkspaceStore((s) => s.workflowCopilotContextAccepted);
  const acceptContext = useWorkspaceStore((s) => s.acceptWorkflowCopilotContext);

  const [scopePref, setScopePref] = useState<WorkflowCopilotScope | null>(null);
  const [modePref, setModePref] = useState<WorkflowCopilotMode | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<WorkflowCopilotAttachment[]>([]);
  const [dragHover, setDragHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Sidebar surface (single thread per session) since the chat is the surface.
  const targetSurface = 'sidebar' as const;
  const draftKey = useMemo(
    () =>
      buildWorkflowCopilotDraftKey({
        sessionId,
        surface: targetSurface,
      }),
    [sessionId],
  );
  const draft = useWorkspaceStore(
    useCallback((s) => readWorkflowCopilotDraft(s.workflowCopilotDrafts, draftKey), [draftKey]),
  );
  const [value, setValue] = useState(draft);

  useEffect(() => {
    setValue(draft);
  }, [draft]);

  useEffect(() => {
    setComposerAttachments([]);
  }, [draftKey]);

  useEffect(() => {
    setScopePref(thread?.scope ?? null);
  }, [thread?.id]);

  useEffect(() => {
    setModePref(thread?.mode ?? null);
  }, [thread?.id, thread?.mode]);

  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      setDraft(draftKey, next);
    },
    [draftKey, setDraft],
  );

  const selection = useMemo(
    () =>
      thread
        ? { type: thread.agentType, model: thread.model }
        : lastRunSelection,
    [lastRunSelection, thread],
  );
  const selectionLabel =
    selection != null
      ? formatAgentSelectionLabel(selection.type, selection.model)
      : t('ui.sidebar.copilotChooseModel');

  const menuScope = scopePref ?? thread?.scope ?? null;
  const mode = modePref ?? thread?.mode ?? 'edit';
  const askMode = mode === 'ask';

  const availableScopes = useMemo(() => {
    const values: Array<{ key: string; label: string; scope: WorkflowCopilotScope }> = [
      {
        key: 'session',
        label: t('ui.sidebar.copilotScopeSession'),
        scope: { kind: 'session' },
      },
    ];
    if (selected) {
      values.push({
        key: `node:${selected}`,
        label: t('ui.sidebar.copilotScopeNode'),
        scope: { kind: 'node', nodeId: selected },
      });
      values.push({
        key: `subgraph:${selected}`,
        label: t('ui.sidebar.copilotScopeSubgraph'),
        scope: { kind: 'subgraph', nodeId: selected },
      });
    }
    return values;
  }, [selected, t]);

  const contextScope = useMemo<WorkflowCopilotScope | null>(() => {
    if (!contextAccepted || selectedIds.length === 0) return null;
    const nodeId = selected && selectedIds.includes(selected) ? selected : (selectedIds[0] ?? null);
    if (!nodeId) return null;
    return {
      kind: 'subgraph',
      nodeId,
      nodeIds: selectedIds,
    };
  }, [contextAccepted, selected, selectedIds]);

  const ensureThreadIfNeeded = useCallback(
    async (id: string) => {
      // Use the unified chat thread; no `presentation:'simple'` so we keep the
      // full Copilot envelope (analysis/apply/checkpoints) in the same surface.
      await ensureThread({ surface: 'sidebar' });
      void id;
    },
    [ensureThread],
  );

  // Apply a settings change (model / scope / mode / auto flags) to the active
  // thread. If no thread has been ensured yet for the current session, we
  // create one with the change baked in so the picker is never silently
  // ignored. Without a session, the change is a no-op.
  const applyThreadChange = useCallback(
    (change: {
      agentType?: AgentType;
      model?: AgentModelRef | null;
      scope?: WorkflowCopilotScope;
      mode?: WorkflowCopilotMode;
      autoApply?: boolean;
      autoRun?: boolean;
    }) => {
      if (!sessionId) return;
      const payload = {
        ...(change.scope ? { scope: change.scope } : {}),
        ...(change.mode ? { mode: change.mode } : {}),
        ...(change.agentType ? { agentType: change.agentType } : {}),
        ...(change.model ? { model: change.model } : {}),
        ...(change.autoApply !== undefined ? { autoApply: change.autoApply } : {}),
        ...(change.autoRun !== undefined ? { autoRun: change.autoRun } : {}),
      };
      if (thread) {
        void patchThread(payload);
        return;
      }
      const ensure: WorkflowCopilotEnsureThread = {
        surface: 'sidebar',
        ...payload,
      };
      void ensureThread(ensure);
    },
    [ensureThread, patchThread, sessionId, thread],
  );

  const onSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (sending || stopping) return;
      const text = value.trim();
      const atts = composerAttachments;
      if (!text && atts.length === 0) return;
      const id = sessionId ?? (await bootstrapSession());
      if (!id) return;
      await ensureThreadIfNeeded(id);
      setDraft(draftKey, '');
      setValue('');
      setComposerAttachments([]);
      const scope = contextScope ?? menuScope ?? thread?.scope;
      await sendMessage(text, {
        ...(scope ? { scope } : {}),
        mode,
        ...(atts.length > 0 ? { attachments: atts } : {}),
      });
    },
    [
      bootstrapSession,
      composerAttachments,
      contextScope,
      draftKey,
      ensureThreadIfNeeded,
      menuScope,
      mode,
      sendMessage,
      sending,
      sessionId,
      setDraft,
      stopping,
      thread?.scope,
      value,
    ],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void onSubmit();
        return;
      }
      if (event.key === 'Escape') {
        (event.target as HTMLTextAreaElement).blur();
      }
    },
    [onSubmit],
  );

  const onStop = useCallback(() => {
    void stopMessage();
  }, [stopMessage]);

  const pickComposerPickedFiles = useCallback(
    async (files: PickedFile[]) => {
      const list = sortPickedFiles(files);
      if (list.length === 0) return;
      let nextCount = composerAttachments.length;
      let nextTotal = workflowCopilotAttachmentTotalBytes(composerAttachments) ?? 0;
      const next: WorkflowCopilotAttachment[] = [];
      for (const item of list) {
        if (nextCount >= WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT) {
          useWorkspaceStore.setState({
            status: {
              key: 'status.copilot_attachments_limit',
              params: { max: String(WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT) },
            },
          });
          break;
        }
        const relativePath = normalizeWorkflowCopilotAttachmentPath(item.relativePath);
        const file = item.file;
        const name = workflowCopilotAttachmentDisplayName({
          filename: file.name,
          ...(relativePath ? { relativePath } : {}),
        });
        const mime = (file.type && file.type.trim()) || guessMimeFromName(file.name);
        if (!mime || !workflowCopilotAttachmentMimeAllowed(mime)) {
          useWorkspaceStore.setState({
            status: {
              key: 'status.copilot_attachment_rejected',
              params: { name },
            },
          });
          continue;
        }
        try {
          const data = await readFileDataUrl(file);
          const bytes = workflowCopilotDataUrlPayloadBytes(data);
          if (bytes === null || bytes > WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES) {
            useWorkspaceStore.setState({
              status: {
                key: 'status.copilot_attachment_rejected',
                params: { name },
              },
            });
            continue;
          }
          if (nextTotal + bytes > WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES) {
            useWorkspaceStore.setState({
              status: {
                key: 'status.copilot_attachments_total_limit',
                params: {
                  max: String(
                    Math.floor(WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024)),
                  ),
                },
              },
            });
            continue;
          }
          nextCount += 1;
          nextTotal += bytes;
          next.push({
            filename: file.name,
            ...(relativePath ? { relativePath } : {}),
            mime,
            data,
          });
        } catch {
          useWorkspaceStore.setState({
            status: {
              key: 'status.copilot_attachment_rejected',
              params: { name },
            },
          });
        }
      }
      if (next.length > 0) {
        setComposerAttachments((prev) => [...prev, ...next]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [composerAttachments],
  );

  const pickComposerFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list =
        files == null
          ? []
          : Array.from(files).map((file) => {
              const relativePath = readPickedFilePath(file);
              return { file, ...(relativePath ? { relativePath } : {}) };
            });
      await pickComposerPickedFiles(list);
    },
    [pickComposerPickedFiles],
  );

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragHover(true);
  }, []);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragHover(false);
  }, []);

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragHover(false);
      await pickComposerPickedFiles(await readDroppedFiles(event));
    },
    [pickComposerPickedFiles],
  );

  const placeholder = sessionId
    ? askMode
      ? t('ui.sidebar.copilotComposerAskPlaceholder')
      : t('ui.chat.composerPlaceholder')
    : t('ui.chat.composerPlaceholderNoSession');

  const attachLimitReached = composerAttachments.length >= WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT;
  const contextLabel =
    selectedIds.length === 1
      ? t('ui.sidebar.copilotContextSingle')
      : t('ui.sidebar.copilotContextMany', { count: String(selectedIds.length) });
  const contextHint = contextAccepted
    ? t('ui.sidebar.copilotContextActive')
    : t('ui.sidebar.copilotContextDraft');

  return (
    <form onSubmit={onSubmit} style={shellStyle}>
      <Surface
        variant="card"
        padding={10}
        radius={16}
        style={{
          display: 'grid',
          gap: 8,
          borderColor: dragHover ? 'var(--z-accent-strong)' : undefined,
        }}
      >
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDrop(event)}
          style={{ display: 'grid', gap: 8 }}
        >
          {composerAttachments.length > 0 ? (
            <div style={chipsRowStyle}>
              {composerAttachments.map((attachment, idx) => {
                const label = workflowCopilotAttachmentDisplayName(attachment);
                return (
                  <div key={`${label}:${idx}`} style={chipStyle}>
                    <span style={chipLabelStyle}>{label}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setComposerAttachments((prev) => prev.filter((_, j) => j !== idx))
                      }
                      title={t('ui.sidebar.copilotRemoveAttachment', { name: label })}
                      style={chipRemoveStyle}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {selectedIds.length > 0 ? (
            <button
              type="button"
              aria-pressed={contextAccepted}
              onClick={() => {
                if (!contextAccepted) acceptContext();
              }}
              style={{
                ...contextBoxStyle,
                borderStyle: contextAccepted ? 'solid' : 'dashed',
                background: contextAccepted ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                cursor: contextAccepted ? 'default' : 'pointer',
              }}
            >
              <div style={contextLabelStyle}>{contextLabel}</div>
              <div style={contextHintStyle}>{contextHint}</div>
            </button>
          ) : null}
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoGrow
            aria-label={t('ui.chat.composerAria')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              fontSize: 14,
              minHeight: MIN_HEIGHT,
              maxHeight: MAX_HEIGHT,
              overflowY: 'auto',
            }}
          />
        </div>
        <div style={footerStyle}>
          <div style={footerLeftStyle}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label={t('ui.sidebar.copilotAttachmentsAria')}
              style={{ display: 'none' }}
              onChange={(event) => void pickComposerFiles(event.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              aria-label={t('ui.sidebar.copilotFoldersAria')}
              style={{ display: 'none' }}
              onChange={(event) => void pickComposerFiles(event.target.files)}
            />
            <Tooltip label={t('ui.sidebar.copilotAttachFiles')}>
              <IconButton
                size={28}
                label={t('ui.sidebar.copilotAttachFiles')}
                disabled={attachLimitReached}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <IconPaperclip size={14} />
              </IconButton>
            </Tooltip>
            <WorkflowCopilotSettingsMenu
              label={scopeLabel(menuScope ?? thread?.scope, t)}
              disabled={!sessionId}
              mode={mode}
              autoApply={thread?.autoApply ?? false}
              autoRun={thread?.autoRun ?? true}
              scopes={availableScopes.map((entry) => ({
                key: entry.key,
                label: entry.label,
                active: scopeSame(menuScope, entry.scope),
                onSelect: () => {
                  setScopePref(entry.scope);
                  applyThreadChange({ scope: entry.scope });
                },
              }))}
              onSelectMode={(nextMode) => {
                setModePref(nextMode);
                applyThreadChange({ mode: nextMode });
              }}
              onToggleAutoApply={() =>
                applyThreadChange({ autoApply: !(thread?.autoApply ?? false) })
              }
              onToggleAutoRun={() =>
                applyThreadChange({ autoRun: !(thread?.autoRun ?? true) })
              }
            />
            <AgentModelMenu
              selection={selection ?? null}
              onSelect={(next) => {
                // Update the trigger label immediately even if the thread has
                // not been created yet; the store keeps `lastRunSelection`
                // around as the fallback selection used by the next send.
                setLastRunSelection({
                  type: next.type,
                  ...(next.model ? { model: next.model } : {}),
                });
                applyThreadChange({
                  agentType: next.type,
                  ...(next.model ? { model: next.model } : {}),
                });
              }}
              renderTrigger={({ open, selectionLabel: menuLabel, toggle }) => (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={toggle}
                  style={modelButtonStyle}
                  title={menuLabel ?? selectionLabel}
                >
                  {menuLabel ?? selectionLabel}
                </button>
              )}
            />
          </div>
          <div style={footerRightStyle}>
            <span style={hintStyle}>{t('ui.chat.composerHint')}</span>
            {sending ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onStop}
                disabled={stopping}
                type="button"
              >
                {stopping ? <Spinner size={12} /> : <IconStop size={14} />} {t('ui.chat.stop')}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={(!value.trim() && composerAttachments.length === 0) || sending}
              size="sm"
            >
              <IconSend size={14} /> {t('ui.chat.send')}
            </Button>
          </div>
        </div>
      </Surface>
    </form>
  );
}

const shellStyle: CSSProperties = {
  padding: '12px 24px 16px',
  background: 'var(--z-bg-app)',
  borderTop: '1px solid var(--z-border)',
  maxWidth: 880,
  margin: '0 auto',
  width: '100%',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  flexWrap: 'wrap',
};

const footerLeftStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  flex: 1,
  minWidth: 0,
};

const footerRightStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  whiteSpace: 'nowrap',
};

const modelButtonStyle: CSSProperties = {
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg-subtle)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const chipsRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  padding: '4px 8px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  fontSize: 11,
};

const chipLabelStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 220,
};

const chipRemoveStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--z-fg-muted)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 2px',
};

const contextBoxStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: 'var(--z-node-run-border)',
  borderStyle: 'dashed',
  textAlign: 'left',
  display: 'grid',
  gap: 4,
  color: 'var(--z-fg)',
};

const contextLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
};

const contextHintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  lineHeight: 1.4,
};
