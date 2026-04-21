'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconArrowDown, IconSparkles, IconStudio, Surface } from '@cepage/ui-kit';
import {
  selectUnifiedChatTimeline,
  selectWorkspaceFilesView,
  useWorkspaceStore,
  type ChatModelRef,
  type ChatTimelineAgentOutput,
  type ChatTimelineCopilotCheckpoint,
  type ChatTimelineItem,
  type WorkspaceFileEntry,
} from '@cepage/state';
import {
  AgentSpawnBlock,
  AgentStepBlock,
  ChatMessageBlock,
  CopilotCheckpointBlock,
  CopilotMessageBlock,
  FileWriteBlock,
  SystemMessageBlock,
  WorkflowExecutionBlock,
  groupTimelineForRender,
} from '../chat';
import { useI18n } from '../I18nProvider';
import { toRawGraphNodes, type ChatShellOpenStudioInput } from './types';

type ChatTranscriptProps = {
  onOpenStudio: (input?: ChatShellOpenStudioInput) => void;
  onPreviewFile?: (file: WorkspaceFileEntry) => void;
};

/**
 * Vertical scrollable feed that renders every item in the unified chat
 * timeline. The transcript automatically sticks to the bottom while the
 * agent is streaming so the latest token is always visible.
 *
 * Beyond {@link GraphNode}-derived items, this also renders Copilot
 * messages (analysis, summary, warnings, apply, attachments) and Copilot
 * checkpoints inline so users have a single chat surface.
 */
export function ChatTranscript({ onOpenStudio, onPreviewFile }: ChatTranscriptProps) {
  const { t } = useI18n();
  const storeNodes = useWorkspaceStore((s) => s.nodes);
  const sending = useWorkspaceStore((s) => s.workflowCopilotSending);
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const copilotMessages = useWorkspaceStore((s) => s.workflowCopilotMessages);
  const copilotCheckpoints = useWorkspaceStore((s) => s.workflowCopilotCheckpoints);
  const agentRuns = useWorkspaceStore((s) => s.agentRuns);
  const workflowExecutions = useWorkspaceStore((s) => s.workflowExecutions);
  const activity = useWorkspaceStore((s) => s.activity);
  const applying = useWorkspaceStore((s) => s.workflowCopilotApplyingMessageId);
  const restoring = useWorkspaceStore((s) => s.workflowCopilotRestoringCheckpointId);
  const applyMessage = useWorkspaceStore((s) => s.applyWorkflowCopilotMessage);
  const restoreCheckpoint = useWorkspaceStore((s) => s.restoreWorkflowCopilotCheckpoint);
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rawNodes = useMemo(() => toRawGraphNodes(storeNodes), [storeNodes]);
  const timeline = useMemo(
    () =>
      selectUnifiedChatTimeline({
        nodes: rawNodes,
        copilotMessages,
        copilotCheckpoints,
        agentRuns,
        executions: workflowExecutions,
        activity,
      }),
    [rawNodes, copilotMessages, copilotCheckpoints, agentRuns, workflowExecutions, activity],
  );
  const grouped = useMemo(() => groupTimelineForRender(timeline), [timeline]);

  // Resolver for "called model" on the orphan blocks (agent_spawn / agent_step
  // / agent_message that didn't get absorbed by an execution): if the node's
  // creator is an agent, look up the AgentRun carrying the runtime-effective
  // model (populated post-fallback by requeueWithNextModel).
  const resolveCallModel = useCallback(
    (agentId: string | undefined): ChatModelRef | undefined => {
      if (!agentId) return undefined;
      const run = agentRuns[agentId];
      if (!run?.model) return undefined;
      return { providerId: run.model.providerID, modelId: run.model.modelID };
    },
    [agentRuns],
  );
  const filesView = useMemo(() => selectWorkspaceFilesView(rawNodes), [rawNodes]);
  const filesById = useMemo(() => {
    const out = new Map<string, WorkspaceFileEntry>();
    for (const file of filesView.entries) out.set(file.id, file);
    return out;
  }, [filesView.entries]);

  const copilotLabels = useMemo(
    () => ({
      you: t('ui.sidebar.copilotYou'),
      assistant: t('ui.sidebar.copilotAssistant'),
      sending: t('ui.sidebar.copilotSending'),
      thinking: t('ui.sidebar.copilotThinking'),
      analysis: t('ui.sidebar.copilotAnalysis'),
      summary: t('ui.sidebar.copilotSummary'),
      warnings: t('ui.sidebar.copilotWarnings'),
      applied: t('ui.sidebar.copilotApplied'),
      apply: t('ui.sidebar.copilotApply'),
      applying: t('ui.sidebar.copilotApplying'),
      output: t('ui.sidebar.runOutput'),
      copy: t('ui.sidebar.copilotCopyMessage'),
    }),
    [t],
  );

  const checkpointLabels = useMemo(
    () => ({
      checkpoint: t('ui.sidebar.copilotCheckpoint'),
      restore: t('ui.sidebar.copilotRestore'),
      restoring: t('ui.sidebar.copilotRestoring'),
    }),
    [t],
  );

  // Smart auto-scroll: stick to bottom only while `pinned` is true (user is
  // within ~80px of the bottom). Do not use a wider distance heuristic here:
  // coupling auto-scroll to "near bottom" re-snaps on every timeline update
  // and fights manual scrolling. Streaming growth is handled via ResizeObserver.
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 80);
  }, []);
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [grouped.length, sending, pinned]);

  useEffect(() => {
    const inner = listRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [sessionId, grouped.length]);

  if (!sessionId) {
    return (
      <div style={emptyShellStyle}>
        <Surface variant="card" padding={20} tone="accent" style={{ maxWidth: 560 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <strong style={{ fontSize: 18 }}>{t('ui.chat.welcomeTitle')}</strong>
            <p style={{ margin: 0, color: 'var(--z-fg-muted)', lineHeight: 1.5 }}>
              {t('ui.chat.welcomeBody')}
            </p>
          </div>
        </Surface>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div style={emptyShellStyle}>
        <Surface variant="card" padding={16} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconSparkles size={16} />
            <strong>{t('ui.chat.welcomeTitle')}</strong>
          </div>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)' }}>{t('ui.chat.empty')}</p>
          <Button variant="ghost" size="sm" onClick={() => onOpenStudio()}>
            <IconStudio size={14} /> {t('ui.simple.openStudio')}
          </Button>
        </Surface>
      </div>
    );
  }

  return (
    <div style={frameStyle}>
      <div ref={containerRef} onScroll={onScroll} style={shellStyle}>
        <div ref={listRef} style={listStyle}>
          {grouped.map((entry) => {
            if (entry.kind === 'execution_with_stream') {
              return (
                <WorkflowExecutionBlock
                  key={entry.item.id}
                  item={entry.item}
                  streamingOutput={entry.streamingOutput}
                />
              );
            }
            const outputs =
              entry.kind === 'agent_step_with_outputs' ? entry.outputs : [];
            // A `standalone` group may carry a folded-in checkpoint (attached
            // to its user copilot message). We pass it down so the message
            // block can inline the Restore pill Cursor-style.
            const attachedCheckpoint =
              entry.kind === 'standalone' ? entry.checkpoint : undefined;
            // Resolve the runtime-effective model for any orphan agent block
            // so the AgentBadge can render the strike + arrow when the run's
            // model diverges from the node's configured model.
            const callModel =
              entry.item.kind === 'agent_spawn' ||
              entry.item.kind === 'agent_step' ||
              entry.item.kind === 'agent_message'
                ? entry.item.actor.kind === 'agent'
                  ? resolveCallModel(entry.item.actor.agentId)
                  : undefined
                : undefined;
            return renderItem({
              item: entry.item,
              outputs,
              callModel,
              attachedCheckpoint,
              onOpenStudio,
              onPreviewFile,
              onOpenWorkspaceFile: openWorkspaceFile,
              filesById,
              applyingMessageId: applying,
              restoringCheckpointId: restoring,
              onApplyCopilot: (id) => void applyMessage(id),
              onRestoreCheckpoint: (id) => void restoreCheckpoint(id),
              copilotLabels,
              checkpointLabels,
            });
          })}
        </div>
      </div>
      {!pinned ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('ui.chat.scrollToBottom')}
          title={t('ui.chat.scrollToBottom')}
          style={fabStyle}
        >
          <IconArrowDown size={14} />
        </button>
      ) : null}
    </div>
  );
}

type RenderItemContext = {
  item: ChatTimelineItem;
  outputs: ChatTimelineAgentOutput[];
  callModel?: ChatModelRef | undefined;
  /** Checkpoint folded under a user `copilot_message` by the grouper. */
  attachedCheckpoint?: ChatTimelineCopilotCheckpoint | undefined;
  onOpenStudio: (input?: ChatShellOpenStudioInput) => void;
  onPreviewFile?: ((file: WorkspaceFileEntry) => void) | undefined;
  /**
   * Opens a workspace file as a tab and highlights it in the right-side files
   * panel (the tabs store drives `activeId` which `WorkspaceFilesPanel` uses
   * for the selected-row styling).
   */
  onOpenWorkspaceFile: (input: { path: string; title?: string }) => void;
  filesById: Map<string, WorkspaceFileEntry>;
  applyingMessageId: string | null;
  restoringCheckpointId: string | null;
  onApplyCopilot: (messageId: string) => void;
  onRestoreCheckpoint: (checkpointId: string) => void;
  copilotLabels: {
    you: string;
    assistant: string;
    sending: string;
    thinking: string;
    analysis: string;
    summary: string;
    warnings: string;
    applied: string;
    apply: string;
    applying: string;
    output: string;
    copy: string;
  };
  checkpointLabels: {
    checkpoint: string;
    restore: string;
    restoring: string;
  };
};

function renderItem(ctx: RenderItemContext) {
  const {
    item,
    outputs,
    callModel,
    attachedCheckpoint,
    onOpenStudio,
    onPreviewFile,
    onOpenWorkspaceFile,
    filesById,
    applyingMessageId,
    restoringCheckpointId,
    onApplyCopilot,
    onRestoreCheckpoint,
    copilotLabels,
    checkpointLabels,
  } = ctx;
  switch (item.kind) {
    case 'human_message':
    case 'agent_message':
      return (
        <ChatMessageBlock
          key={item.id}
          message={item}
          {...(callModel ? { callModel } : {})}
        />
      );
    case 'agent_spawn':
      return (
        <AgentSpawnBlock
          key={item.id}
          spawn={item}
          {...(callModel ? { callModel } : {})}
        />
      );
    case 'agent_step':
      return (
        <AgentStepBlock
          key={item.id}
          step={item}
          outputs={outputs}
          {...(callModel ? { callModel } : {})}
        />
      );
    case 'workspace_file': {
      const lookup = filesById.get(item.id);
      // Clicking the pill or the eye button both route through the workspace
      // tabs store: it opens a tab (or focuses one that already exists) and
      // drives the `activeId` that WorkspaceFilesPanel uses to highlight the
      // selected row in the right rail. Host apps that want a richer preview
      // flow can still override via `onPreviewFile`.
      const openFile = () => onOpenWorkspaceFile({ path: item.path, title: item.title });
      const previewHandler = onPreviewFile && lookup
        ? () => onPreviewFile(lookup)
        : openFile;
      return (
        <FileWriteBlock
          key={item.id}
          file={item}
          onOpen={openFile}
          onPreview={previewHandler}
          onRevealInStudio={() => onOpenStudio({ selectedNodeId: item.id })}
        />
      );
    }
    case 'system_message':
      return <SystemMessageBlock key={item.id} message={item} />;
    case 'copilot_message': {
      const isApplying = applyingMessageId === item.message.id;
      // Only the user side ever gets a folded checkpoint, but we pass the
      // pill-related props unconditionally so the component can early-out
      // cleanly for assistant messages.
      const isRestoringAttached =
        attachedCheckpoint && restoringCheckpointId === attachedCheckpoint.checkpoint.id;
      return (
        <CopilotMessageBlock
          key={item.id}
          item={item}
          applying={isApplying}
          onApply={onApplyCopilot}
          labels={{
            ...copilotLabels,
            checkpoint: checkpointLabels.checkpoint,
            restore: checkpointLabels.restore,
            restoring: checkpointLabels.restoring,
          }}
          {...(attachedCheckpoint
            ? {
                checkpoint: attachedCheckpoint,
                restoringCheckpoint: Boolean(isRestoringAttached),
                onRestoreCheckpoint,
              }
            : {})}
        />
      );
    }
    case 'copilot_checkpoint': {
      const isRestoring = restoringCheckpointId === item.checkpoint.id;
      return (
        <CopilotCheckpointBlock
          key={item.id}
          item={item}
          restoring={isRestoring}
          onRestore={onRestoreCheckpoint}
          labels={checkpointLabels}
        />
      );
    }
    case 'agent_output':
      return null;
    // Execution items are rendered via the explicit `WorkflowExecutionBlock`
    // branch in the caller; defensively ignore them here if grouping fails.
    case 'execution':
      return null;
    default:
      return null;
  }
}

const frameStyle = {
  position: 'relative' as const,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  background: 'var(--z-bg-app)',
} as const;

const shellStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
  overscrollBehavior: 'contain' as const,
  background: 'var(--z-bg-app)',
} as const;

const fabStyle = {
  position: 'absolute' as const,
  right: 16,
  bottom: 12,
  width: 32,
  height: 32,
  borderRadius: 16,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
  color: 'var(--z-fg)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: 'var(--z-bg-panel-shadow)',
} as const;

const listStyle = {
  display: 'grid',
  gap: 12,
  padding: '20px 24px 32px',
  maxWidth: 880,
  margin: '0 auto',
} as const;

const emptyShellStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'var(--z-bg-app)',
} as const;
