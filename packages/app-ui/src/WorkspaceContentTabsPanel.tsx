'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAgentRunArtifactFile } from '@cepage/client-api';
import {
  readFileSummaryContent,
  readRunArtifactsSummary,
  readWorkflowArtifactContent,
  readWorkflowInputContent,
  summarizeWorkflowArtifactContent,
  summarizeWorkflowInputContent,
  type GraphNode,
  type WorkflowInputPart,
  type WorkspaceFileChangeKind,
} from '@cepage/shared-core';
import { useWorkspaceStore } from '@cepage/state';
import { ArtifactFileViewer, type ArtifactFileView } from './ArtifactFileViewer';
import { useI18n } from './I18nProvider';
import { buildInputApiDoc, type InputApiDoc } from './input-api-doc';
import { MarkdownBody } from './MarkdownBody';
import { looksLikeMarkdown } from './looksLikeMarkdown';

type FlowLikeNode = {
  id: string;
  data: unknown;
};

type FlowLikeNodeData = {
  raw: GraphNode;
  text?: string;
};

type TabRole =
  | 'node'
  | 'workspace_summary'
  | 'workspace_excerpt'
  | 'workspace_info'
  | 'file_summary_combined'
  | 'file_summary_item_summary'
  | 'file_summary_item_extract'
  | 'input_summary'
  | 'input_part'
  | 'agent_output_file';

export type WorkspaceContentTab =
  | {
      id: string;
      nodeId: string;
      nodeType: GraphNode['type'];
      kind: 'text';
      role: Exclude<TabRole, 'agent_output_file'>;
      name: string;
      text: string;
      markdown: boolean;
      partType?: WorkflowInputPart['type'];
      api?: InputApiDoc | null;
    }
  | {
      id: string;
      nodeId: string;
      nodeType: 'agent_output';
      kind: 'artifact';
      role: 'agent_output_file';
      name: string;
      path: string;
      runId: string;
      change: WorkspaceFileChangeKind;
      markdown: boolean;
    };

type WorkspaceContentTabsPanelProps = {
  sessionId: string | null;
  tabs: readonly WorkspaceContentTab[];
};

export function buildWorkspaceContentTabs(
  nodes: readonly FlowLikeNode[],
  selectedIds: ReadonlyArray<string>,
): WorkspaceContentTab[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const tabs: WorkspaceContentTab[] = [];

  const push = (
    tab: Omit<Extract<WorkspaceContentTab, { kind: 'text' }>, 'text'> & {
      text: string | null | undefined;
    },
  ) => {
    const text = trim(tab.text);
    if (!text) return;
    tabs.push({ ...tab, text });
  };

  for (const nodeId of selectedIds) {
    const node = byId.get(nodeId);
    const data = node ? readNodeData(node) : null;
    if (!data) continue;

    const raw = data.raw;
    const text = trim(data.text);

    if (raw.type === 'workspace_file') {
      const artifact = readWorkflowArtifactContent(raw.content);
      if (!artifact) continue;
      const name = artifact.title?.trim() || artifact.relativePath;
      const markdown = isMarkdownPath(artifact.relativePath) || looksLikeMarkdown(artifact.summary ?? artifact.excerpt ?? '');
      push({
        id: `${raw.id}:workspace:summary`,
        nodeId: raw.id,
        nodeType: raw.type,
        kind: 'text',
        role: 'workspace_summary',
        name,
        text: artifact.summary,
        markdown,
      });
      push({
        id: `${raw.id}:workspace:excerpt`,
        nodeId: raw.id,
        nodeType: raw.type,
        kind: 'text',
        role: 'workspace_excerpt',
        name,
        text: artifact.excerpt,
        markdown,
      });
      if (!artifact.summary?.trim() && !artifact.excerpt?.trim()) {
        push({
          id: `${raw.id}:workspace:info`,
          nodeId: raw.id,
          nodeType: raw.type,
          kind: 'text',
          role: 'workspace_info',
          name,
          text: summarizeWorkflowArtifactContent(artifact),
          markdown: false,
        });
      }
      continue;
    }

    if (raw.type === 'agent_output') {
      push({
        id: `${raw.id}:node`,
        nodeId: raw.id,
        nodeType: raw.type,
        kind: 'text',
        role: 'node',
        name: raw.id,
        text,
        markdown: looksLikeMarkdown(text ?? ''),
      });
      const artifacts = readRunArtifactsSummary(raw.metadata);
      if (!artifacts) {
        continue;
      }
      for (const file of artifacts.files) {
        tabs.push({
          id: `${raw.id}:artifact:${artifacts.runId}:${file.path}`,
          nodeId: raw.id,
          nodeType: raw.type,
          kind: 'artifact',
          role: 'agent_output_file',
          name: file.path,
          path: file.path,
          runId: artifacts.runId,
          change: file.kind,
          markdown: isMarkdownPath(file.path),
        });
      }
      continue;
    }

    if (raw.type === 'file_summary') {
      const summary = readFileSummaryContent(raw.content);
      push({
        id: `${raw.id}:summary:combined`,
        nodeId: raw.id,
        nodeType: raw.type,
        kind: 'text',
        role: 'file_summary_combined',
        name: raw.id,
        text: summary?.summary ?? summary?.generatedSummary,
        markdown: looksLikeMarkdown(summary?.summary ?? summary?.generatedSummary ?? ''),
      });
      for (const file of summary?.files ?? []) {
        push({
          id: `${raw.id}:summary:${file.id}`,
          nodeId: raw.id,
          nodeType: raw.type,
          kind: 'text',
          role: 'file_summary_item_summary',
          name: file.file.name,
          text: file.summary,
          markdown: looksLikeMarkdown(file.summary ?? ''),
        });
        push({
          id: `${raw.id}:extract:${file.id}`,
          nodeId: raw.id,
          nodeType: raw.type,
          kind: 'text',
          role: 'file_summary_item_extract',
          name: file.file.name,
          text: file.extractedText,
          markdown: looksLikeMarkdown(file.extractedText ?? ''),
        });
      }
      continue;
    }

    if (raw.type === 'input') {
      const input = readWorkflowInputContent(raw.content);
      const api = buildInputApiDoc(raw.id, input);
      push({
        id: `${raw.id}:input:summary`,
        nodeId: raw.id,
        nodeType: raw.type,
        kind: 'text',
        role: 'input_summary',
        name: input?.label?.trim() || input?.key?.trim() || 'Input',
        text: input?.mode === 'bound' ? input.summary ?? text : input?.instructions ?? text ?? summarizeWorkflowInputContent(input ?? raw.content),
        markdown: looksLikeMarkdown(
          input?.mode === 'bound'
            ? input.summary ?? text ?? ''
            : input?.instructions ?? text ?? summarizeWorkflowInputContent(input ?? raw.content),
        ),
        api,
      });
      if (input?.mode === 'bound') {
        for (const part of input.parts) {
          push({
            id: `${raw.id}:input:${part.id}`,
            nodeId: raw.id,
            nodeType: raw.type,
            kind: 'text',
            role: 'input_part',
            name: part.type === 'text' ? input.label?.trim() || 'Input' : part.file.name,
            text: summarizeInputPart(part),
            markdown: looksLikeMarkdown(summarizeInputPart(part)),
            partType: part.type,
            api,
          });
        }
      }
      continue;
    }

    if (raw.type === 'runtime_target' || raw.type === 'runtime_run') {
      continue;
    }

    push({
      id: `${raw.id}:node`,
      nodeId: raw.id,
      nodeType: raw.type,
      kind: 'text',
      role: 'node',
      name: raw.id,
      text,
      markdown: looksLikeMarkdown(text ?? ''),
    });
  }

  return tabs;
}

export function WorkspaceContentTabsPanel({
  sessionId,
  tabs,
}: WorkspaceContentTabsPanelProps) {
  const { t } = useI18n();
  const updateNodeText = useWorkspaceStore((s) => s.updateNodeText);
  const [activeId, setActiveId] = useState<string | null>(tabs[0]?.id ?? null);
  const [surface, setSurface] = useState<'raw' | 'preview'>(() => (tabs[0]?.markdown ? 'preview' : 'raw'));
  const [files, setFiles] = useState<Record<string, ArtifactFileView>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setActiveId((current) => (current && tabs.some((tab) => tab.id === current) ? current : tabs[0]?.id ?? null));
  }, [tabs]);

  const active = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null,
    [activeId, tabs],
  );

  useEffect(() => {
    setSurface(active?.markdown ? 'preview' : 'raw');
  }, [active?.id, active?.markdown]);

  useEffect(() => {
    setDraft(active?.kind === 'text' ? active.text : '');
  }, [active]);

  const file = active?.kind === 'artifact' ? files[active.id] ?? null : null;
  const err = active?.kind === 'artifact' ? errs[active.id] ?? null : null;
  const editable = active?.kind === 'text' && isEditableTab(active);
  const text = active?.kind === 'text' && editable ? draft : active?.kind === 'text' ? active.text : '';
  const api = active?.kind === 'text' ? active.api ?? null : null;

  useEffect(() => {
    if (!sessionId || !active || active.kind !== 'artifact' || file || err) return;
    let live = true;
    setLoading(active.id);
    void getAgentRunArtifactFile(sessionId, active.runId, active.path).then((res) => {
      if (!live) return;
      setLoading((current) => (current === active.id ? null : current));
      if (!res.success) {
        setErrs((current) => ({ ...current, [active.id]: res.error.message }));
        return;
      }
      setFiles((current) => ({ ...current, [active.id]: res.data }));
    });
    return () => {
      live = false;
    };
  }, [active, err, file, sessionId]);

  if (tabs.length === 0 || !active) {
    return (
      <div style={emptyWrapStyle}>
        <div style={emptyStateStyle}>{t('ui.sidebar.contentEmpty')}</div>
      </div>
    );
  }

  const showPreview = active.markdown && surface === 'preview';
  const save = (value: string) => {
    if (!active || active.kind !== 'text' || !editable || value === active.text) return;
    void updateNodeText(active.nodeId, value);
  };

  return (
    <div style={rootStyle}>
      <div style={tabStripStyle}>
        {tabs.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              title={readTabTitle(tab, t)}
              style={selected ? tabButtonActiveStyle : tabButtonStyle}
            >
              {readTabLabel(tab, t)}
            </button>
          );
        })}
      </div>

      <div style={panelStyle}>
        <div style={toolbarStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={headingStyle}>{readTabLabel(active, t)}</div>
            <div style={metaStyle}>{readTabTitle(active, t)}</div>
          </div>
          {active.markdown ? (
            <div style={toggleWrapStyle}>
              <button
                type="button"
                onClick={() => setSurface('raw')}
                style={surface === 'raw' ? toggleButtonActiveStyle : toggleButtonStyle}
              >
                {t('ui.node.markdownRaw')}
              </button>
              <button
                type="button"
                onClick={() => setSurface('preview')}
                style={showPreview ? toggleButtonActiveStyle : toggleButtonStyle}
              >
                {t('ui.node.markdownPreview')}
              </button>
            </div>
          ) : null}
        </div>

        <div style={viewerStyle}>
          {active.kind === 'text' ? (
            editable ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={(event) => save(event.target.value)}
                spellCheck={false}
                style={textareaStyle}
              />
            ) : (
              <div style={textWrapStyle}>
                {api ? <InputApiCard doc={api} t={t} /> : null}
                {showPreview ? (
                  <div style={markdownStyle}>
                    <MarkdownBody content={text} />
                  </div>
                ) : (
                  <pre style={codeStyle}>{text}</pre>
                )}
              </div>
            )
          ) : loading === active.id ? (
            <div style={emptyStateStyle}>{t('ui.sidebar.loadingFile')}</div>
          ) : err ? (
            <div style={emptyStateStyle}>{err}</div>
          ) : file ? (
            <ArtifactFileViewer file={file} markdown={showPreview} />
          ) : (
            <div style={emptyStateStyle}>{t('ui.sidebar.viewerEmpty')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function readNodeData(node: FlowLikeNode): FlowLikeNodeData | null {
  const data = node.data as FlowLikeNodeData;
  return data?.raw ? data : null;
}

function trim(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown|mdown|mkdn|mkd)$/i.test(path);
}

function summarizeInputPart(part: WorkflowInputPart): string {
  if (part.type === 'text') return part.text;
  const lines = [part.file.name];
  if (part.relativePath?.trim()) lines.push(`path: ${part.relativePath.trim()}`);
  if (part.claimRef?.trim()) lines.push(`claim: ${part.claimRef.trim()}`);
  if (part.extractedText?.trim()) lines.push(part.extractedText.trim());
  return lines.join('\n');
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function shortName(name: string): string {
  const parts = name.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? name;
}

function readTabLabel(tab: WorkspaceContentTab, t: ReturnType<typeof useI18n>['t']): string {
  if (tab.role === 'node') {
    return `${t(`nodeType.${tab.nodeType}` as 'nodeType.note')} · ${shortId(tab.nodeId)}`;
  }
  if (tab.role === 'workspace_summary') {
    return `${shortName(tab.name)} · ${t('ui.node.workspaceFileSummary')}`;
  }
  if (tab.role === 'workspace_excerpt') {
    return `${shortName(tab.name)} · ${t('ui.node.workspaceFileExcerpt')}`;
  }
  if (tab.role === 'workspace_info') {
    return shortName(tab.name);
  }
  if (tab.role === 'file_summary_combined') {
    return t('ui.node.fileSummaryCombinedSummary');
  }
  if (tab.role === 'file_summary_item_summary') {
    return `${shortName(tab.name)} · ${t('ui.node.fileSummarySummary')}`;
  }
  if (tab.role === 'file_summary_item_extract') {
    return `${shortName(tab.name)} · ${t('ui.node.fileSummaryExtracted')}`;
  }
  if (tab.role === 'input_summary') {
    return `${tab.name === 'Input' ? t('nodeType.input') : shortName(tab.name)} · ${t('ui.node.inputSummary')}`;
  }
  if (tab.role === 'input_part') {
    const name = tab.name === 'Input' ? t('nodeType.input') : shortName(tab.name);
    if (tab.partType === 'text') {
      return `${name} · ${t('ui.node.inputText')}`;
    }
    if (tab.partType === 'image') {
      return `${name} · ${t('ui.node.inputImage')}`;
    }
    return `${name} · ${t('ui.node.inputFile')}`;
  }
  return shortName(tab.name);
}

function readTabTitle(tab: WorkspaceContentTab, t: ReturnType<typeof useI18n>['t']): string {
  if (tab.role === 'node') {
    return `${t(`nodeType.${tab.nodeType}` as 'nodeType.note')} · ${tab.nodeId}`;
  }
  if (tab.role === 'workspace_summary' || tab.role === 'workspace_excerpt' || tab.role === 'workspace_info') {
    return tab.name;
  }
  if (tab.role === 'file_summary_combined') {
    return t('ui.node.fileSummaryCombinedSummary');
  }
  if (tab.role === 'file_summary_item_summary' || tab.role === 'file_summary_item_extract') {
    return tab.name;
  }
  if (tab.role === 'input_summary' || tab.role === 'input_part') {
    return tab.name;
  }
  return tab.kind === 'artifact' ? tab.path : tab.name;
}

function isEditableTab(tab: Extract<WorkspaceContentTab, { kind: 'text' }>): boolean {
  return tab.role === 'node' || tab.role === 'file_summary_combined';
}

function InputApiCard({
  doc,
  t,
}: {
  doc: InputApiDoc;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const rules = readInputApiRules(doc, t);
  return (
    <section style={apiCardStyle}>
      <div style={apiHeaderStyle}>
        <div style={headingStyle}>{t('ui.node.inputApiTitle')}</div>
        <div style={metaStyle}>{doc.mode === 'bound' ? t('ui.node.inputApiBoundTag') : t('ui.node.inputApiTemplateTag')}</div>
      </div>
      <div style={apiMetaGridStyle}>
        <div style={apiMetaRowStyle}>
          <span style={apiLabelStyle}>{t('ui.node.inputApiEndpoint')}</span>
          <code style={inlineCodeStyle}>{`POST ${doc.path}`}</code>
        </div>
        <div style={apiMetaRowStyle}>
          <span style={apiLabelStyle}>{t('ui.node.inputApiTransport')}</span>
          <code style={inlineCodeStyle}>{doc.transport}</code>
        </div>
      </div>
      {doc.mode === 'bound' ? (
        <div style={apiNoteStyle}>{t('ui.node.inputApiBoundNote', { id: doc.endpointNodeId })}</div>
      ) : null}

      <div style={apiSectionStyle}>
        <div style={sectionTitleStyle}>{t('ui.node.inputApiRules')}</div>
        <ul style={apiListStyle}>
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      <div style={apiSectionStyle}>
        <div style={sectionTitleStyle}>{t('ui.node.inputApiPayload')}</div>
        <pre style={codeStyle}>{doc.payload}</pre>
      </div>

      <div style={apiSectionStyle}>
        <div style={sectionTitleStyle}>{t('ui.node.inputApiCurl')}</div>
        <pre style={codeStyle}>{doc.curl}</pre>
      </div>

      <div style={apiSectionStyle}>
        <div style={sectionTitleStyle}>{t('ui.node.inputApiFetch')}</div>
        <pre style={codeStyle}>{doc.fetch}</pre>
      </div>
    </section>
  );
}

function readInputApiRules(doc: InputApiDoc, t: ReturnType<typeof useI18n>['t']): string[] {
  const accepts = doc.accepts
    .map((kind) => t(`ui.node.inputAccept.${kind}` as 'ui.node.inputAccept.text'))
    .join(', ');
  const rules = [
    t('ui.node.inputApiRuleAccepts', { types: accepts }),
    doc.multiple ? t('ui.node.inputApiRuleMultiple') : t('ui.node.inputApiRuleSingle'),
    doc.required ? t('ui.node.inputApiRuleRequired') : t('ui.node.inputApiRuleOptional'),
    t('ui.node.inputApiRuleSourceNodeIds'),
    t('ui.node.inputApiRuleNewExecution'),
  ];
  if (doc.transport === 'multipart/form-data') {
    rules.push(t('ui.node.inputApiRuleMultipart', { fields: doc.fields.join(', ') }));
  }
  if (doc.splitText) {
    rules.push(t('ui.node.inputApiRuleSplitText'));
  }
  return rules;
}

const rootStyle = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  flex: 1,
} as const;

const tabStripStyle = {
  display: 'flex',
  gap: 6,
  overflowX: 'auto',
  padding: '10px 10px 0',
  borderBottom: '1px solid var(--z-border)',
} as const;

const tabButtonStyle = {
  flexShrink: 0,
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 10,
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const tabButtonActiveStyle = {
  ...tabButtonStyle,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
} as const;

const panelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  padding: 10,
} as const;

const toolbarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'flex-start',
  flexShrink: 0,
} as const;

const headingStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const metaStyle = {
  marginTop: 4,
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--z-fg-subtle)',
  wordBreak: 'break-word',
} as const;

const toggleWrapStyle = {
  display: 'inline-flex',
  gap: 6,
  flexShrink: 0,
} as const;

const toggleButtonStyle = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const toggleButtonActiveStyle = {
  ...toggleButtonStyle,
  border: '1px solid var(--z-border-lang-active)',
  background: 'var(--z-lang-bg-active)',
} as const;

const viewerStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 10,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const textWrapStyle = {
  display: 'grid',
  gap: 12,
} as const;

const apiCardStyle = {
  display: 'grid',
  gap: 12,
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
} as const;

const apiHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
} as const;

const apiMetaGridStyle = {
  display: 'grid',
  gap: 8,
} as const;

const apiMetaRowStyle = {
  display: 'grid',
  gap: 4,
} as const;

const apiLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--z-fg-subtle)',
} as const;

const inlineCodeStyle = {
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--z-fg)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const apiNoteStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-subtle)',
} as const;

const apiSectionStyle = {
  display: 'grid',
  gap: 6,
} as const;

const sectionTitleStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--z-fg-subtle)',
} as const;

const apiListStyle = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.5,
} as const;

const codeStyle = {
  margin: 0,
  color: 'var(--z-fg)',
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const textareaStyle = {
  width: '100%',
  minHeight: '100%',
  height: '100%',
  border: 0,
  outline: 'none',
  resize: 'none',
  padding: 0,
  margin: 0,
  background: 'transparent',
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
} as const;

const markdownStyle = {
  color: 'var(--z-fg)',
} as const;

const emptyWrapStyle = {
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  padding: 12,
  display: 'flex',
  alignItems: 'center',
} as const;

const emptyStateStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
} as const;
