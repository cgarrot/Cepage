'use client';

import type { DragEvent as ReactDragEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  GraphEdge,
  GraphNode,
  WorkflowCopilotAttachment,
  WorkflowCopilotMessage,
  WorkflowCopilotMode,
  WorkflowCopilotScope,
} from '@cepage/shared-core';
import {
  formatAgentSelectionLabel,
  normalizeWorkflowCopilotAttachmentPath,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES,
  resolveGraphNodeSelection,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES,
  WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT,
  WORKFLOW_COPILOT_STOPPED,
  workflowCopilotAttachmentDisplayName,
  workflowCopilotAttachmentMimeAllowed,
  workflowCopilotDataUrlPayloadBytes,
  workflowCopilotAttachmentTotalBytes,
} from '@cepage/shared-core';
import {
  buildWorkflowCopilotDraftKey,
  copyTextToClipboard,
  readWorkflowCopilotDraft,
  useWorkspaceStore,
} from '@cepage/state';
import { Button, LoadingDots, Spinner } from '@cepage/ui-kit';
import { AgentModelMenu } from './AgentModelMenu';
import { useI18n } from './I18nProvider';
import { SidebarSection } from './SidebarSection';
import { buildRestoreCheckpointConfirm } from './workflow-copilot-panel-helpers';
import { WorkflowCopilotSettingsMenu } from './WorkflowCopilotSettingsMenu';

type WorkflowCopilotPanelProps = {
  sessionId: string | null;
  selectedNode: GraphNode | null;
  variant?: 'sidebar' | 'simple';
};

type CopilotNodeContent = {
  title?: unknown;
  text?: unknown;
  agentType?: unknown;
  model?: unknown;
  scope?: unknown;
  autoApply?: unknown;
  autoRun?: unknown;
};

type PickedFile = {
  file: File;
  relativePath?: string;
};

function toLinks(edges: readonly Edge[]): Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> {
  return edges.flatMap((edge) =>
    edge.source && edge.target
      ? [
          {
            source: edge.source,
            target: edge.target,
            relation:
              (typeof edge.data?.relation === 'string' ? edge.data.relation : 'custom') as GraphEdge['relation'],
          },
        ]
      : [],
  );
}

function toRawNodes(nodes: readonly Node[]): GraphNode[] {
  return nodes.flatMap((node) => {
    const raw = (node.data as { raw?: GraphNode }).raw;
    return raw ? [raw] : [];
  });
}

function readCopilotScope(node: GraphNode | null): WorkflowCopilotScope | undefined {
  if (!node || node.type !== 'workflow_copilot') return undefined;
  const content = node.content as CopilotNodeContent;
  const value = content.scope;
  if (!value || typeof value !== 'object') return undefined;
  const kind = typeof (value as { kind?: unknown }).kind === 'string' ? (value as { kind: string }).kind : null;
  if (kind === 'session') return { kind: 'session' };
  if (kind === 'node' && typeof (value as { nodeId?: unknown }).nodeId === 'string') {
    return { kind: 'node', nodeId: (value as { nodeId: string }).nodeId };
  }
  if (kind === 'subgraph' && typeof (value as { nodeId?: unknown }).nodeId === 'string') {
    const nodeIds = Array.isArray((value as { nodeIds?: unknown }).nodeIds)
      ? (value as { nodeIds: unknown[] }).nodeIds.filter((entry): entry is string => typeof entry === 'string')
      : undefined;
    return { kind: 'subgraph', nodeId: (value as { nodeId: string }).nodeId, nodeIds };
  }
  return undefined;
}

function readCopilotFlag(node: GraphNode | null, key: 'autoApply' | 'autoRun'): boolean | undefined {
  if (!node || node.type !== 'workflow_copilot') return undefined;
  const content = node.content as CopilotNodeContent;
  return typeof content[key] === 'boolean' ? content[key] : undefined;
}

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
    return left.localeCompare(right) || a.file.name.localeCompare(b.file.name) || a.file.size - b.file.size;
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
  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

async function collectDroppedEntry(entry: FileSystemEntry, dir = ''): Promise<PickedFile[]> {
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    const relativePath = normalizeWorkflowCopilotAttachmentPath(dir ? `${dir}/${file.name}` : undefined);
    return [{ file, ...(relativePath ? { relativePath } : {}) }];
  }
  if (!entry.isDirectory) return [];
  const nextDir = dir ? `${dir}/${entry.name}` : entry.name;
  const entries = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  const groups = await Promise.all(entries.map((child) => collectDroppedEntry(child, nextDir)));
  return groups.flat();
}

async function readDroppedFiles(event: ReactDragEvent<HTMLDivElement>): Promise<PickedFile[]> {
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

function scopeLabel(scope: WorkflowCopilotScope | undefined, t: ReturnType<typeof useI18n>['t']) {
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

function readMessageError(message: string | undefined, t: ReturnType<typeof useI18n>['t']) {
  if (!message) return undefined;
  if (message === WORKFLOW_COPILOT_STOPPED) return t('ui.sidebar.copilotStopped');
  return message;
}

/** Plain text for clipboard: visible body only (no ids/ops/json envelope). */
function copilotMessageClipboardText(row: WorkflowCopilotMessage) {
  const chunks: string[] = [];
  const analysis = row.analysis?.trim();
  if (analysis) chunks.push(analysis);
  const content = row.content?.trim() ?? '';
  const raw = row.rawOutput?.trim() ?? '';
  if (content) chunks.push(content);
  if (raw && raw !== content) chunks.push(raw);
  return chunks.join('\n\n');
}

/** Align nullable API fields with optional client state so we do not thrash ensureThread. */
function sameCopilotOwner(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

export function WorkflowCopilotPanel({
  sessionId,
  selectedNode,
  variant = 'sidebar',
}: WorkflowCopilotPanelProps) {
  const { t } = useI18n();
  const isSimple = variant === 'simple';
  const thread = useWorkspaceStore((s) => s.workflowCopilotThread);
  const messages = useWorkspaceStore((s) => s.workflowCopilotMessages);
  const checkpoints = useWorkspaceStore((s) => s.workflowCopilotCheckpoints);
  const loading = useWorkspaceStore((s) => s.workflowCopilotLoading);
  const sending = useWorkspaceStore((s) => s.workflowCopilotSending);
  const stopping = useWorkspaceStore((s) => s.workflowCopilotStopping);
  const applyingMessageId = useWorkspaceStore((s) => s.workflowCopilotApplyingMessageId);
  const restoringCheckpointId = useWorkspaceStore((s) => s.workflowCopilotRestoringCheckpointId);
  const copilotLoading = useWorkspaceStore((s) => s.workflowCopilotLoading);
  const ensureThread = useWorkspaceStore((s) => s.ensureWorkflowCopilotThread);
  const patchThread = useWorkspaceStore((s) => s.patchWorkflowCopilotThread);
  const sendMessage = useWorkspaceStore((s) => s.sendWorkflowCopilotMessage);
  const stopMessage = useWorkspaceStore((s) => s.stopWorkflowCopilot);
  const applyMessage = useWorkspaceStore((s) => s.applyWorkflowCopilotMessage);
  const restoreCheckpoint = useWorkspaceStore((s) => s.restoreWorkflowCopilotCheckpoint);
  const lastRunSelection = useWorkspaceStore((s) => s.lastRunSelection);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const edges = useWorkspaceStore((s) => s.edges);
  const selected = useWorkspaceStore((s) => s.selected);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const contextAccepted = useWorkspaceStore((s) => s.workflowCopilotContextAccepted);
  const acceptContext = useWorkspaceStore((s) => s.acceptWorkflowCopilotContext);
  const setDraftValue = useWorkspaceStore((s) => s.setWorkflowCopilotDraft);
  const [scopePref, setScopePref] = useState<WorkflowCopilotScope | null>(null);
  const [modePref, setModePref] = useState<WorkflowCopilotMode | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [composerAttachments, setComposerAttachments] = useState<WorkflowCopilotAttachment[]>([]);

  const nodeSelection = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'workflow_copilot') return null;
    return resolveGraphNodeSelection({
      nodeId: selectedNode.id,
      nodes: toRawNodes(nodes),
      edges: toLinks(edges),
      fallback: lastRunSelection,
    });
  }, [edges, lastRunSelection, nodes, selectedNode]);
  const nodeScope = useMemo(() => readCopilotScope(selectedNode), [selectedNode]);
  const nodeAutoApply = useMemo(() => readCopilotFlag(selectedNode, 'autoApply'), [selectedNode]);
  const nodeAutoRun = useMemo(() => readCopilotFlag(selectedNode, 'autoRun'), [selectedNode]);
  const targetSurface = isSimple
    ? 'sidebar'
    : selectedNode?.type === 'workflow_copilot'
      ? 'node'
      : 'sidebar';
  const targetOwnerNodeId = targetSurface === 'node' ? selectedNode?.id : undefined;
  const draftKey = useMemo(
    () =>
      buildWorkflowCopilotDraftKey({
        sessionId,
        surface: targetSurface,
        ownerNodeId: targetOwnerNodeId,
      }),
    [sessionId, targetOwnerNodeId, targetSurface],
  );
  const draft = useWorkspaceStore(
    useCallback((s) => readWorkflowCopilotDraft(s.workflowCopilotDrafts, draftKey), [draftKey]),
  );

  useEffect(() => {
    setComposerAttachments([]);
  }, [draftKey]);

  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    setScopePref(thread?.scope ?? null);
  }, [thread?.id]);

  useEffect(() => {
    setModePref(thread?.mode ?? null);
  }, [thread?.id, thread?.mode]);

  useEffect(() => {
    if (!sessionId) return;
    if (copilotLoading) return;
    if (
      thread &&
      thread.sessionId === sessionId &&
      thread.surface === targetSurface &&
      sameCopilotOwner(thread.ownerNodeId, targetOwnerNodeId) &&
      (!isSimple
        || (thread.metadata?.role === 'concierge' && thread.metadata?.presentation === 'simple'))
    ) {
      return;
    }
    void ensureThread({
      surface: targetSurface,
      ownerNodeId: targetOwnerNodeId,
      title:
        selectedNode?.type === 'workflow_copilot' && typeof (selectedNode.content as CopilotNodeContent).title === 'string'
          ? ((selectedNode.content as CopilotNodeContent).title as string)
          : undefined,
      scope:
        targetSurface === 'node'
          ? nodeScope ?? { kind: 'node', nodeId: selectedNode?.id ?? '' }
          : undefined,
      agentType: nodeSelection?.type ?? lastRunSelection?.type,
      model: nodeSelection?.model ?? lastRunSelection?.model,
      autoApply: nodeAutoApply,
      autoRun: nodeAutoRun,
      ...(isSimple
        ? {
            metadata: {
              role: 'concierge',
              presentation: 'simple',
            } as const,
          }
        : {}),
    });
  }, [
    isSimple,
    copilotLoading,
    ensureThread,
    lastRunSelection?.model?.modelID,
    lastRunSelection?.model?.providerID,
    lastRunSelection?.type,
    nodeAutoApply,
    nodeAutoRun,
    nodeScope,
    nodeSelection,
    selectedNode,
    sessionId,
    targetOwnerNodeId,
    targetSurface,
    thread?.id,
    thread?.ownerNodeId,
    thread?.sessionId,
    thread?.surface,
  ]);

  const selection = useMemo(
    () =>
      thread
        ? {
            type: thread.agentType,
            model: thread.model,
          }
        : lastRunSelection,
    [lastRunSelection, thread],
  );
  const selectionLabel =
    selection != null ? formatAgentSelectionLabel(selection.type, selection.model) : t('ui.sidebar.copilotNoModel');
  const checkpointById = useMemo(
    () => new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])),
    [checkpoints],
  );
  const handleRestore = useCallback(
    (checkpointId: string) => {
      if (!window.confirm(buildRestoreCheckpointConfirm(t, checkpointId))) {
        return;
      }
      void restoreCheckpoint(checkpointId);
    },
    [restoreCheckpoint, t],
  );
  const menuScope = scopePref ?? thread?.scope;
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
    if (selectedNode) {
      values.push({
        key: `node:${selectedNode.id}`,
        label: t('ui.sidebar.copilotScopeNode'),
        scope: { kind: 'node', nodeId: selectedNode.id },
      });
      values.push({
        key: `subgraph:${selectedNode.id}`,
        label: t('ui.sidebar.copilotScopeSubgraph'),
        scope: { kind: 'subgraph', nodeId: selectedNode.id },
      });
    }
    return values;
  }, [selectedNode, t]);
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
  const contextLabel =
    selectedIds.length === 1
      ? t('ui.sidebar.copilotContextSingle')
      : t('ui.sidebar.copilotContextMany', { count: String(selectedIds.length) });
  const contextHint = contextAccepted
    ? t('ui.sidebar.copilotContextActive')
    : t('ui.sidebar.copilotContextDraft');

  useEffect(() => {
    if (!sessionId) return;
    const raf = window.requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [sessionId, thread?.id, messages]);

  const pickComposerPickedFiles = async (files: PickedFile[]) => {
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
      } else {
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
          } else if (nextTotal + bytes > WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES) {
            useWorkspaceStore.setState({
              status: {
                key: 'status.copilot_attachments_total_limit',
                params: {
                  max: String(Math.floor(WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024))),
                },
              },
            });
          } else {
            nextCount += 1;
            nextTotal += bytes;
            next.push({
              filename: file.name,
              ...(relativePath ? { relativePath } : {}),
              mime,
              data,
            });
          }
        } catch {
          useWorkspaceStore.setState({
            status: {
              key: 'status.copilot_attachment_rejected',
              params: { name },
            },
          });
        }
      }
    }
    if (next.length > 0) {
      setComposerAttachments((prev) => [...prev, ...next]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const pickComposerFiles = async (files: FileList | File[] | null) => {
    const list = files == null ? [] : Array.from(files).map((file) => {
      const relativePath = readPickedFilePath(file);
      return { file, ...(relativePath ? { relativePath } : {}) };
    });
    await pickComposerPickedFiles(list);
  };

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    await pickComposerPickedFiles(await readDroppedFiles(event));
  };

  const handleSend = async () => {
    if (sending || stopping) return;
    const value = draft.trim();
    const atts = composerAttachments;
    if (!value && atts.length === 0) return;
    setDraftValue(draftKey, '');
    setComposerAttachments([]);
    const scope = contextScope ?? menuScope ?? thread?.scope;
    await sendMessage(value, {
      ...(scope ? { scope } : {}),
      mode,
      ...(atts.length > 0 ? { attachments: atts } : {}),
    });
  };

  const copyCopilotMessage = useCallback(async (row: WorkflowCopilotMessage) => {
    const ok = await copyTextToClipboard(copilotMessageClipboardText(row));
    useWorkspaceStore.setState({
      status: {
        key: ok ? 'status.copilot_message_copied' : 'status.clipboard_copy_failed',
      },
    });
  }, []);

  const copyCopilotConversation = useCallback(async () => {
    const ok = await copyTextToClipboard(JSON.stringify(messages, null, 2));
    useWorkspaceStore.setState({
      status: {
        key: ok ? 'status.copilot_conversation_copied' : 'status.clipboard_copy_failed',
      },
    });
  }, [messages]);

  if (!sessionId) {
    return (
      <SidebarSection
        title={isSimple ? t('ui.simple.conciergeTitle') : t('ui.sidebar.copilot')}
        defaultOpen
        summary={isSimple ? t('ui.simple.conciergeSummary') : t('ui.sidebar.copilotEmpty')}
        sectionStyle={panelSectionStyle}
        contentStyle={panelContentStyle}
      >
        <div style={emptyStyle}>{isSimple ? t('ui.simple.noSession') : t('ui.sidebar.copilotEmpty')}</div>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection
      title={isSimple ? t('ui.simple.conciergeTitle') : t('ui.sidebar.copilot')}
      defaultOpen
      summary={
        thread
          ? isSimple
            ? t('ui.simple.conciergeSummary')
            : `${selectionLabel} · ${t(askMode ? 'ui.sidebar.copilotModeAsk' : 'ui.sidebar.copilotModeEdit')} · ${scopeLabel(menuScope ?? thread.scope, t)}`
          : t('ui.sidebar.copilotLoading')
      }
      sectionStyle={panelSectionStyle}
      contentStyle={panelContentStyle}
    >
      <div style={messagesColumnStyle}>
        <div style={messagesToolbarStyle}>
          <button
            type="button"
            className="nodrag nopan"
            disabled={messages.length === 0 || (loading && !thread)}
            onClick={() => void copyCopilotConversation()}
            style={copilotCopyConversationBtnStyle}
          >
            {t('ui.sidebar.copilotCopyConversation')}
          </button>
        </div>
        <div ref={listRef} style={messagesScrollStyle}>
          <div style={messagesListStyle}>
          {loading && !thread ? <div style={emptyStyle}>{t('ui.sidebar.copilotLoading')}</div> : null}
          {!loading && messages.length === 0 ? (
            <div style={emptyStyle}>{t('ui.sidebar.copilotEmpty')}</div>
          ) : null}
          {messages.map((message, index) => {
            const pending = message.status === 'pending';
            const err = readMessageError(message.error, t);
            const rawOutput = message.rawOutput?.trim() ?? '';
            const showRawOutput =
              rawOutput.length > 0 && (pending || !message.content || rawOutput !== message.content.trim());
            const next = messages[index + 1];
            const checkpointAfterUser =
              message.role === 'user' &&
              next?.role === 'assistant' &&
              next.apply?.checkpointId
                ? checkpointById.get(next.apply.checkpointId)
                : undefined;
            return (
              <div
                key={message.id}
                aria-busy={pending}
                style={{
                  ...messageCardStyle,
                  borderColor:
                    pending
                      ? 'var(--z-node-run-border)'
                      : message.role === 'assistant'
                      ? 'var(--z-node-run-border)'
                      : 'var(--z-border)',
                  opacity: pending ? 0.88 : 1,
                }}
              >
                <div style={messageMetaStyle}>
                  <div style={messageMetaLeftStyle}>
                    <strong>
                      {message.role === 'assistant' ? t('ui.sidebar.copilotAssistant') : t('ui.sidebar.copilotYou')}
                    </strong>
                    <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                    {pending ? (
                      <span style={copilotPendingMetaStyle}>
                        <Spinner size={12} />
                        <LoadingDots />
                        <span style={copilotPendingMetaLabelStyle}>{t('ui.sidebar.copilotSending')}</span>
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="nodrag nopan"
                    onClick={() => void copyCopilotMessage(message)}
                    style={copilotCopyMessageBtnStyle}
                  >
                    {t('ui.sidebar.copilotCopyMessage')}
                  </button>
                </div>
                {!isSimple && message.analysis ? (
                  <div style={analysisStyle}>
                    <div style={sectionLabelStyle}>{t('ui.sidebar.copilotAnalysis')}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{message.analysis}</div>
                  </div>
                ) : null}
                {message.content ? (
                  <div style={markdownStyle}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : null}
                {message.role === 'user' && message.attachments && message.attachments.length > 0 ? (
                  <div style={messageAttachmentsWrapStyle}>
                    {message.attachments.map((a, attIdx) => {
                      const label = workflowCopilotAttachmentDisplayName(a);
                      return a.mime.startsWith('image/') ? (
                        <img
                          key={`${message.id}:att:${attIdx}`}
                          src={a.data}
                          alt={label}
                          style={messageAttachmentImgStyle}
                        />
                      ) : (
                        <div key={`${message.id}:att:${attIdx}`} style={messageAttachmentFileStyle}>
                          {label}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {!isSimple && showRawOutput ? (
                  <details open={pending || !message.content} style={outputWrapStyle}>
                    <summary style={outputSummaryStyle}>
                      {pending
                        ? `${t('ui.sidebar.runOutput')} · ${t('ui.sidebar.copilotSending')}`
                        : t('ui.sidebar.runOutput')}
                    </summary>
                    <pre style={outputStyle}>{rawOutput}</pre>
                  </details>
                ) : null}
                {message.summary.length > 0 ? (
                  <div>
                    <div style={sectionLabelStyle}>{t('ui.sidebar.copilotSummary')}</div>
                    <ul style={listStyle}>
                      {message.summary.map((entry, index) => (
                        <li key={`${message.id}:summary:${index}`}>{entry}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {message.warnings.length > 0 ? (
                  <div>
                    <div style={sectionLabelStyle}>{t('ui.sidebar.copilotWarnings')}</div>
                    <ul style={listStyle}>
                      {message.warnings.map((entry, warnIndex) => (
                        <li key={`${message.id}:warning:${warnIndex}`}>{entry}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {checkpointAfterUser ? (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--z-fg-subtle)' }}>
                      {t('ui.sidebar.copilotCheckpoint')} #{checkpointAfterUser.id.slice(0, 8)}
                    </span>
                    <Button
                      className="nodrag nopan"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      onClick={() => handleRestore(checkpointAfterUser.id)}
                    >
                      {restoringCheckpointId === checkpointAfterUser.id
                        ? t('ui.sidebar.copilotRestoring')
                        : t('ui.sidebar.copilotRestore')}
                    </Button>
                  </div>
                ) : null}
                {message.apply ? (
                  <div style={applyStyle}>
                    <div style={sectionLabelStyle}>{t('ui.sidebar.copilotApplied')}</div>
                    <ul style={listStyle}>
                      {message.apply.summary.map((entry, applyIndex) => (
                        <li key={`${message.id}:apply:${applyIndex}`}>{entry}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!isSimple && message.role === 'assistant' && !message.apply && !askMode && message.ops.length > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      className="nodrag nopan"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      onClick={() => void applyMessage(message.id)}
                    >
                      {applyingMessageId === message.id
                        ? t('ui.sidebar.copilotApplying')
                        : t('ui.sidebar.copilotApply')}
                    </Button>
                  </div>
                ) : null}
                {err ? <div style={errorStyle}>{err}</div> : null}
              </div>
            );
          })}
          </div>
        </div>
      </div>

      <div
        style={composerWrapStyle}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="nodrag nopan"
          aria-label={t('ui.sidebar.copilotAttachmentsAria')}
          style={{ display: 'none' }}
          onChange={(event) => void pickComposerFiles(event.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="nodrag nopan"
          aria-label={t('ui.sidebar.copilotFoldersAria')}
          style={{ display: 'none' }}
          onChange={(event) => void pickComposerFiles(event.target.files)}
        />
        {composerAttachments.length > 0 ? (
          <div style={composerChipsRowStyle}>
            {composerAttachments.map((a, idx) => {
              const label = workflowCopilotAttachmentDisplayName(a);
              return (
                <div key={`${label}:${idx}`} style={composerChipStyle}>
                  <span style={composerChipLabelStyle}>{label}</span>
                  <button
                    type="button"
                    className="nodrag nopan"
                    style={composerChipRemoveStyle}
                    title={t('ui.sidebar.copilotRemoveAttachment', { name: label })}
                    onClick={() =>
                      setComposerAttachments((prev) => prev.filter((_, j) => j !== idx))
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {!isSimple && selectedIds.length > 0 ? (
          <button
            type="button"
            className="nodrag nopan"
            aria-pressed={contextAccepted}
            onClick={() => {
              if (!contextAccepted) {
                acceptContext();
              }
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
        <textarea
          value={draft}
          placeholder={t(askMode ? 'ui.sidebar.copilotComposerAskPlaceholder' : 'ui.sidebar.copilotComposerPlaceholder')}
          className="nodrag nopan"
          onChange={(event) => setDraftValue(draftKey, event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void handleSend();
            }
          }}
          style={composerStyle}
        />
        <div style={composerFooterStyle}>
          <div style={composerMetaStyle}>
            <button
              type="button"
              className="nodrag nopan"
              style={attachFilesBtnStyle}
              disabled={!thread || composerAttachments.length >= WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('ui.sidebar.copilotAttachFiles')}
            </button>
            <button
              type="button"
              className="nodrag nopan"
              style={attachFilesBtnStyle}
              disabled={!thread || composerAttachments.length >= WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT}
              onClick={() => folderInputRef.current?.click()}
            >
              {t('ui.sidebar.copilotAttachFolder')}
            </button>
            {!isSimple ? (
              <>
                <WorkflowCopilotSettingsMenu
                  label={thread ? scopeLabel(menuScope ?? thread.scope, t) : t('ui.sidebar.copilotLoading')}
                  disabled={!thread}
                  mode={mode}
                  autoApply={thread?.autoApply ?? false}
                  autoRun={thread?.autoRun ?? true}
                  scopes={availableScopes.map((entry) => ({
                    key: entry.key,
                    label: entry.label,
                    active: scopeSame(menuScope, entry.scope),
                    onSelect: () => {
                      setScopePref(entry.scope);
                      void patchThread({ scope: entry.scope });
                    },
                  }))}
                  onSelectMode={(nextMode) => {
                    setModePref(nextMode);
                    void patchThread({ mode: nextMode });
                  }}
                  onToggleAutoApply={() => void patchThread({ autoApply: !thread?.autoApply })}
                  onToggleAutoRun={() => void patchThread({ autoRun: !thread?.autoRun })}
                />
                <div style={footerModelWrapStyle}>
                  <AgentModelMenu
                    selection={selection ?? null}
                    onSelect={(next) => void patchThread({ agentType: next.type, model: next.model })}
                    renderTrigger={({ open, selectionLabel: menuLabel, toggle }) => (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={toggle}
                        style={footerModelButtonStyle}
                        title={menuLabel ?? t('ui.sidebar.copilotChooseModel')}
                      >
                        {menuLabel ?? t('ui.sidebar.copilotChooseModel')}
                      </button>
                    )}
                  />
                </div>
              </>
            ) : null}
          </div>
          <Button
            className="nodrag nopan"
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => {
              if (sending || stopping) {
                void stopMessage();
                return;
              }
              void handleSend();
            }}
            disabled={
              !thread ||
              stopping ||
              (!sending && draft.trim().length === 0 && composerAttachments.length === 0)
            }
          >
            {stopping
              ? t('ui.sidebar.copilotStopping')
              : sending
                ? t('ui.sidebar.copilotStop')
                : t('ui.sidebar.copilotSend')}
          </Button>
        </div>
      </div>
    </SidebarSection>
  );
}

const emptyStyle = {
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  padding: '8px 2px',
} as const;

const panelSectionStyle = {
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
} as const;

const panelContentStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  minHeight: 0,
  flex: 1,
} as const;

const modelButtonStyle = {
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 11,
  cursor: 'pointer',
} as const;

const messagesColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
} as const;

const messagesToolbarStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  flexShrink: 0,
  paddingBottom: 6,
} as const;

const messagesScrollStyle = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  paddingRight: 2,
} as const;

const copilotCopyConversationBtnStyle = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
} as const;

const copilotCopyMessageBtnStyle = {
  ...copilotCopyConversationBtnStyle,
  padding: '4px 8px',
  fontSize: 10,
} as const;

const messagesListStyle = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  marginTop: 'auto',
  paddingBottom: 2,
} as const;

const composerWrapStyle = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  flexShrink: 0,
  paddingTop: 10,
  borderTop: '1px solid var(--z-border)',
} as const;

const contextBoxStyle = {
  padding: '10px 12px',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: 'var(--z-node-run-border)',
  borderStyle: 'dashed' as const,
  textAlign: 'left' as const,
  display: 'grid',
  gap: 4,
  color: 'var(--z-fg)',
} as const;

const contextLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
} as const;

const contextHintStyle = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  lineHeight: 1.4,
} as const;

const composerFooterStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'stretch',
  flexWrap: 'wrap' as const,
  minWidth: 0,
} as const;

const composerMetaStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap' as const,
  flex: 1,
  minWidth: 0,
} as const;

const attachFilesBtnStyle = {
  ...modelButtonStyle,
  fontSize: 11,
  flexShrink: 0,
} as const;

const composerChipsRowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 6,
  alignItems: 'center',
} as const;

const composerChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  padding: '4px 8px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  fontSize: 11,
} as const;

const composerChipLabelStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  maxWidth: 180,
} as const;

const composerChipRemoveStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--z-fg-muted)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 2px',
} as const;

const messageAttachmentsWrapStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 8,
  marginTop: 8,
} as const;

const messageAttachmentImgStyle = {
  maxWidth: '100%',
  maxHeight: 160,
  borderRadius: 8,
  border: '1px solid var(--z-border)',
} as const;

const messageAttachmentFileStyle = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px dashed var(--z-border)',
} as const;

const footerModelWrapStyle = {
  flex: '1 1 220px',
  minWidth: 0,
} as const;

const footerModelButtonStyle = {
  ...modelButtonStyle,
  display: 'block',
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  fontSize: 11,
  color: 'var(--z-fg-subtle)',
  textAlign: 'left' as const,
} as const;

const messageCardStyle = {
  display: 'grid',
  gap: 8,
  padding: 10,
  minWidth: 0,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-menu-item-bg)',
  overflow: 'hidden',
} as const;

const messageMetaStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flexWrap: 'wrap' as const,
  fontSize: 11,
  color: 'var(--z-fg-subtle)',
} as const;

const messageMetaLeftStyle = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  minWidth: 0,
} as const;

const copilotPendingMetaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--z-fg-subtle)',
} as const;

const copilotPendingMetaLabelStyle = {
  fontStyle: 'normal' as const,
};

const analysisStyle = {
  display: 'grid',
  gap: 4,
  padding: 8,
  minWidth: 0,
  borderRadius: 8,
  background: 'var(--z-node-run-bg)',
  border: '1px solid var(--z-node-run-border)',
  fontSize: 11,
} as const;

const applyStyle = {
  display: 'grid',
  gap: 6,
  padding: 8,
  borderRadius: 8,
  background: 'var(--z-lang-bg)',
  border: '1px solid var(--z-border-lang)',
  fontSize: 11,
} as const;

const sectionLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase' as const,
  color: 'var(--z-fg-subtle)',
} as const;

const markdownStyle = {
  fontSize: 12,
  lineHeight: 1.45,
  minWidth: 0,
  color: 'var(--z-fg)',
  overflowWrap: 'anywhere' as const,
} as const;

const outputWrapStyle = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
} as const;

const outputSummaryStyle = {
  ...sectionLabelStyle,
  cursor: 'pointer',
  listStyle: 'none',
} as const;

const outputStyle = {
  margin: 0,
  maxHeight: 220,
  overflow: 'auto',
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  fontFamily:
    'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

const listStyle = {
  margin: 0,
  paddingLeft: 16,
  display: 'grid',
  gap: 4,
} as const;

const composerStyle = {
  minHeight: 92,
  resize: 'vertical' as const,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box' as const,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.4,
  outline: 'none',
} as const;

const errorStyle = {
  fontSize: 11,
  color: 'var(--z-danger-fg)',
} as const;
