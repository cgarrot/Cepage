'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode, WorkflowCopilotScope } from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { Button } from '@cepage/ui-kit';
import { useI18n } from './I18nProvider';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';

type WorkflowCopilotNodeData = {
  raw: GraphNode;
  text: string;
};

type CopilotContent = {
  title?: unknown;
  text?: unknown;
  agentType?: unknown;
  model?: unknown;
  scope?: unknown;
  autoApply?: unknown;
  autoRun?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readScope(content: CopilotContent, nodeId: string): WorkflowCopilotScope {
  const value = content.scope;
  if (!value || typeof value !== 'object') {
    return { kind: 'node', nodeId };
  }
  const kind = readString((value as { kind?: unknown }).kind);
  if (kind === 'session') return { kind: 'session' };
  if (kind === 'subgraph') return { kind: 'subgraph', nodeId };
  return { kind: 'node', nodeId };
}

export const WorkflowCopilotNode = memo(function WorkflowCopilotNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { t } = useI18n();
  const { raw } = data as WorkflowCopilotNodeData;
  const content = raw.content as CopilotContent;
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const workflowThread = useWorkspaceStore((s) => s.workflowCopilotThread);
  const ensureThread = useWorkspaceStore((s) => s.ensureWorkflowCopilotThread);
  const sendMessage = useWorkspaceStore((s) => s.sendWorkflowCopilotMessage);
  const patchThread = useWorkspaceStore((s) => s.patchWorkflowCopilotThread);
  const patchNodeData = useWorkspaceStore((s) => s.patchNodeData);
  const runFromNode = useWorkspaceStore((s) => s.runFromNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const [title, setTitle] = useState(readString(content.title) ?? t('ui.node.workflowCopilotTitle'));
  const [prompt, setPrompt] = useState(readString(content.text) ?? '');
  const { selection } = useNodeAgentSelection(id, raw);

  useEffect(() => {
    setTitle(readString(content.title) ?? t('ui.node.workflowCopilotTitle'));
    setPrompt(readString(content.text) ?? '');
  }, [content.text, content.title, t]);

  const scope = useMemo(() => readScope(content, id), [content, id]);
  const autoApply = readBoolean(content.autoApply) ?? true;
  const autoRun = readBoolean(content.autoRun) ?? true;
  const isActiveThread =
    workflowThread?.surface === 'node' && workflowThread.ownerNodeId === id;

  const focus = () => {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return;
    setSelected(id);
  };

  const saveContent = async (patch: Partial<CopilotContent>) => {
    const nextContent = {
      ...content,
      ...patch,
    };
    await patchNodeData(id, { content: nextContent });
    if (!isActiveThread) return;
    await patchThread({
      ...(patch.title !== undefined ? { title: readString(patch.title) } : {}),
      ...(patch.agentType !== undefined ? { agentType: patch.agentType as AgentRunSelection['type'] } : {}),
      ...(patch.model !== undefined ? { model: patch.model as AgentRunSelection['model'] } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope as WorkflowCopilotScope } : {}),
      ...(patch.autoApply !== undefined ? { autoApply: patch.autoApply === true } : {}),
      ...(patch.autoRun !== undefined ? { autoRun: patch.autoRun === true } : {}),
    });
  };

  const openCopilot = async () => {
    setSelected(id);
    await ensureThread({
      surface: 'node',
      ownerNodeId: id,
      title,
      scope,
      agentType: selection?.type,
      model: selection?.model,
      autoApply,
      autoRun,
    });
  };

  const generate = async (withRun: boolean) => {
    await openCopilot();
    if (prompt.trim()) {
      await sendMessage(prompt.trim(), {
        scope,
        selection,
        autoApply: withRun ? true : autoApply,
        autoRun: withRun || autoRun,
      });
    }
    if (withRun) {
      await runFromNode(id, selection);
    }
  };

  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%', position: 'relative' }}>
      <button
        type="button"
        aria-label={t('ui.node.delete')}
        title={t('ui.node.delete')}
        className="nodrag nopan"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void removeNode(id);
        }}
        style={deleteButtonStyle}
      >
        &times;
      </button>
      <div
        style={{
          borderRadius: 16,
          border: selected
            ? '1px solid var(--z-node-border-selected)'
            : '1px solid var(--z-node-border)',
          background: 'var(--z-node-grad-spawn)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
          color: 'var(--z-node-fg)',
          overflow: 'hidden',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <span style={{ color: 'var(--z-node-type-spawn)' }}>{t('nodeType.workflow_copilot')}</span>
          <span style={{ color: 'var(--z-fg-subtle)', textTransform: 'none', letterSpacing: 'normal' }}>
            {scope.kind === 'session'
              ? t('ui.sidebar.copilotScopeSession')
              : scope.kind === 'subgraph'
                ? t('ui.sidebar.copilotScopeSubgraph')
                : t('ui.sidebar.copilotScopeNode')}
          </span>
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <input
            value={title}
            onFocus={focus}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveContent({ title })}
            placeholder={t('ui.node.workflowCopilotTitle')}
            style={titleInputStyle}
          />

          <textarea
            value={prompt}
            className="nodrag nowheel"
            onFocus={focus}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => void saveContent({ text: prompt })}
            placeholder={t('ui.node.workflowCopilotPrompt')}
            spellCheck={false}
            style={textareaStyle}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <NodeAgentSelectionControl
              nodeId={id}
              raw={raw}
              placeholder={t('ui.sidebar.copilotChooseModel')}
              onChange={(input) => {
                if (!isActiveThread || !input.selection) return;
                return patchThread({
                  agentType: input.selection.type,
                  model: input.selection.model,
                });
              }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={scope.kind === 'session' ? chipButtonActiveStyle : chipButtonStyle}
                onClick={() => void saveContent({ scope: { kind: 'session' } })}
              >
                {t('ui.sidebar.copilotScopeSession')}
              </button>
              <button
                type="button"
                style={scope.kind === 'node' ? chipButtonActiveStyle : chipButtonStyle}
                onClick={() => void saveContent({ scope: { kind: 'node', nodeId: id } })}
              >
                {t('ui.sidebar.copilotScopeNode')}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={autoApply ? chipButtonActiveStyle : chipButtonStyle}
              onClick={() => void saveContent({ autoApply: !autoApply })}
            >
              {autoApply ? t('ui.sidebar.copilotAutoApplyOn') : t('ui.sidebar.copilotAutoApplyOff')}
            </button>
            <button
              type="button"
              style={autoRun ? chipButtonActiveStyle : chipButtonStyle}
              onClick={() => void saveContent({ autoRun: !autoRun })}
            >
              {autoRun ? t('ui.sidebar.copilotAutoRunOn') : t('ui.sidebar.copilotAutoRunOff')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              className="nodrag nopan"
              style={actionButtonStyle}
              onClick={() => void openCopilot()}
            >
              {t('ui.node.workflowCopilotOpen')}
            </Button>
            <Button
              className="nodrag nopan"
              style={actionButtonStyle}
              onClick={() => void generate(false)}
            >
              {t('ui.node.workflowCopilotGenerate')}
            </Button>
            <Button
              className="nodrag nopan"
              style={actionButtonStyle}
              onClick={() => void generate(true)}
            >
              {t('ui.node.workflowCopilotGenerateRun')}
            </Button>
          </div>
        </div>

        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

const deleteButtonStyle = {
  position: 'absolute',
  top: 12,
  left: 0,
  transform: 'translateX(-50%)',
  zIndex: 1,
  width: 22,
  height: 22,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  borderRadius: 999,
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-error-fg)',
  fontSize: 14,
  lineHeight: 1,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px 8px',
  borderBottom: '1px solid var(--z-node-header-border)',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.8,
} as const;

const titleInputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  fontWeight: 700,
  outline: 'none',
} as const;

const textareaStyle = {
  minHeight: 96,
  resize: 'vertical' as const,
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.4,
  outline: 'none',
} as const;

const chipButtonStyle = {
  border: '1px solid var(--z-border-lang)',
  background: 'var(--z-lang-bg)',
  color: 'var(--z-lang-fg)',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const chipButtonActiveStyle = {
  ...chipButtonStyle,
  border: '1px solid var(--z-border-lang-active)',
  background: 'var(--z-lang-bg-active)',
  color: 'var(--z-fg)',
} as const;

const actionButtonStyle = {
  fontSize: 11,
  padding: '6px 10px',
} as const;
