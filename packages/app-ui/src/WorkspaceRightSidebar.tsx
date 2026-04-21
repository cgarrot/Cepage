import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Node as FlowNode } from '@xyflow/react';
import type { Branch, GraphNode, TimelineEntry, WorkflowControllerState } from '@cepage/shared-core';
import type { LiveRunDescriptor } from '@cepage/state';
import { LiveActivitySidebar } from './LiveActivitySidebar';
import { LiveRunSidebar } from './LiveRunSidebar';
import { SidebarSection } from './SidebarSection';
import { TimelinePanel } from './TimelinePanel';
import type { SidebarTab } from './canvas-workspace-types';
import {
  chipBtn,
  chipBtnActive,
  colorInput,
  panelToggleBtn,
  sidebarInput,
  sidebarListBtn,
  sidebarPrimaryBtn,
  sidebarSecondaryBtn,
  tabBadgeStyle,
  tabLabelStyle,
} from './canvas-workspace-styles';
import { useI18n } from './I18nProvider';
import { WorkspaceContentTabsPanel, type WorkspaceContentTab } from './WorkspaceContentTabsPanel';
import { WorkspaceInspectorPanel } from './WorkspaceInspectorPanel';
import { WorkflowCopilotPanel } from './WorkflowCopilotPanel';

type WorkspaceRightSidebarProps = {
  t: ReturnType<typeof useI18n>['t'];
  sessionId: string | null;
  sidebarCollapsed: boolean;
  sidebarSize: number;
  sidebarResizing: boolean;
  tab: SidebarTab;
  contentTabs: WorkspaceContentTab[];
  branches: Branch[];
  selectedRawNode: GraphNode | null;
  selectedNodeId: string | null;
  branchName: string;
  branchColor: string;
  branchId: string | null;
  targetId: string;
  selectedBranch: Branch | null;
  mergeTargets: Branch[];
  activeRuns: LiveRunDescriptor[];
  activeControllers: WorkflowControllerState[];
  liveRuns: LiveRunDescriptor[];
  nodes: FlowNode[];
  timeline: TimelineEntry[];
  timelineLoading: boolean;
  timelineHasMore: boolean;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCollapseChange: (next: boolean) => void;
  onTabChange: (next: SidebarTab) => void;
  onBranchNameChange: (value: string) => void;
  onBranchColorChange: (value: string) => void;
  onBranchSelect: (branchId: string, headNodeId: string) => void;
  onCreateBranch: () => void;
  onTargetChange: (value: string) => void;
  onMergeBranch: () => void;
  onAbandonBranch: () => void;
  onLoadMoreTimeline: () => void;
  onFocusNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function WorkspaceRightSidebar({
  t,
  sessionId,
  sidebarCollapsed,
  sidebarSize,
  sidebarResizing,
  tab,
  contentTabs,
  branches,
  selectedRawNode,
  selectedNodeId,
  branchName,
  branchColor,
  branchId,
  targetId,
  selectedBranch,
  mergeTargets,
  activeRuns,
  activeControllers,
  liveRuns,
  nodes,
  timeline,
  timelineLoading,
  timelineHasMore,
  onResizeStart,
  onCollapseChange,
  onTabChange,
  onBranchNameChange,
  onBranchColorChange,
  onBranchSelect,
  onCreateBranch,
  onTargetChange,
  onMergeBranch,
  onAbandonBranch,
  onLoadMoreTimeline,
  onFocusNode,
  onSelectNode,
}: WorkspaceRightSidebarProps) {
  return (
    <div
      style={{
        position: 'relative',
        width: sidebarSize,
        height: '100vh',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {!sidebarCollapsed ? (
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 10,
            cursor: 'col-resize',
            zIndex: 2,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'stretch',
          }}
        >
          <div
            style={{
              width: 2,
              height: '100%',
              background: sidebarResizing ? 'var(--z-border)' : 'transparent',
            }}
          />
        </div>
      ) : null}
      <aside
        style={{
          width: '100%',
          height: '100vh',
          flexShrink: 0,
          minWidth: 0,
          minHeight: 0,
          borderLeft: '1px solid var(--z-border)',
          background: 'var(--z-bg-sidebar)',
          display: 'flex',
          flexDirection: 'column',
          fontSize: 12,
          color: 'var(--z-fg-muted)',
          overflow: 'hidden',
        }}
      >
        {sidebarCollapsed ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 10,
              flex: 1,
              minHeight: 0,
            }}
          >
            <button
              type="button"
              aria-expanded={false}
              aria-label={t('ui.sidebar.dockExpand')}
              onClick={() => onCollapseChange(false)}
              style={panelToggleBtn}
            >
              ‹
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px 6px',
                borderBottom: '1px solid var(--z-border)',
              }}
            >
              <div
                role="tablist"
                aria-label={t('ui.sidebar.tabs')}
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  minWidth: 0,
                }}
              >
                <button
                  id="workspace-sidebar-tab-activity"
                  type="button"
                  role="tab"
                  aria-selected={tab === 'activity'}
                  aria-controls="workspace-sidebar-panel"
                  onClick={() => onTabChange('activity')}
                  style={tab === 'activity' ? chipBtnActive : chipBtn}
                >
                  {t('ui.sidebar.tabActivity')}
                </button>
                <button
                  id="workspace-sidebar-tab-chat"
                  type="button"
                  role="tab"
                  aria-selected={tab === 'chat'}
                  aria-controls="workspace-sidebar-panel"
                  onClick={() => onTabChange('chat')}
                  style={tab === 'chat' ? chipBtnActive : chipBtn}
                >
                  {t('ui.sidebar.tabChat')}
                </button>
                <button
                  id="workspace-sidebar-tab-content"
                  type="button"
                  role="tab"
                  aria-selected={tab === 'content'}
                  aria-controls="workspace-sidebar-panel"
                  aria-label={t('ui.sidebar.tabContentAria', { count: contentTabs.length })}
                  onClick={() => onTabChange('content')}
                  style={tab === 'content' ? chipBtnActive : chipBtn}
                >
                  <span style={tabLabelStyle}>
                    {t('ui.sidebar.tabContent')}
                    {contentTabs.length > 0 ? <span style={tabBadgeStyle}>{contentTabs.length}</span> : null}
                  </span>
                </button>
              </div>
              <button
                type="button"
                aria-expanded={true}
                aria-label={t('ui.sidebar.dockCollapse')}
                onClick={() => onCollapseChange(true)}
                style={panelToggleBtn}
              >
                ›
              </button>
            </div>
            <div
              id="workspace-sidebar-panel"
              role="tabpanel"
              aria-labelledby={
                tab === 'activity'
                  ? 'workspace-sidebar-tab-activity'
                  : tab === 'chat'
                    ? 'workspace-sidebar-tab-chat'
                    : 'workspace-sidebar-tab-content'
              }
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {tab === 'activity' ? (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    overflowX: 'hidden',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                  }}
                >
                  <SidebarSection
                    title={t('ui.sidebar.branches')}
                    defaultOpen={false}
                    summary={branches.length > 0 ? String(branches.length) : t('ui.sidebar.branchesEmpty')}
                  >
                    <div style={{ display: 'grid', gap: 10 }}>
                      {selectedRawNode ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ color: 'var(--z-fg-subtle)', fontSize: 11 }}>
                            {t('ui.sidebar.branchCreateFromSelected', { id: shortId(selectedRawNode.id) })}
                          </div>
                          <input
                            value={branchName}
                            onChange={(event) => onBranchNameChange(event.target.value)}
                            placeholder={t('ui.sidebar.branchNamePlaceholder')}
                            style={sidebarInput}
                          />
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              type="color"
                              value={branchColor}
                              onChange={(event) => onBranchColorChange(event.target.value)}
                              aria-label={t('ui.sidebar.branchColor')}
                              style={colorInput}
                            />
                            <button type="button" onClick={onCreateBranch} style={sidebarPrimaryBtn}>
                              {t('ui.sidebar.branchCreate')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ opacity: 0.7 }}>{t('ui.sidebar.branchCreateHint')}</div>
                      )}

                      <div style={{ maxHeight: 180, overflow: 'auto', display: 'grid', gap: 6 }}>
                        {branches.length === 0 ? (
                          <span style={{ opacity: 0.6 }}>{t('ui.sidebar.branchesEmpty')}</span>
                        ) : (
                          branches.map((branch) => (
                            <button
                              key={branch.id}
                              type="button"
                              onClick={() => onBranchSelect(branch.id, branch.headNodeId)}
                              style={{
                                ...sidebarListBtn,
                                borderColor:
                                  branch.id === branchId ? 'var(--z-node-run-border)' : 'var(--z-border)',
                                background:
                                  branch.id === branchId ? 'var(--z-node-run-bg)' : 'var(--z-bg-sidebar)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ color: 'var(--z-branch-fg)', fontWeight: 700 }}>{branch.name}</span>
                                <span style={{ opacity: 0.7 }}>
                                  {t(`branchStatus.${branch.status}` as 'branchStatus.active')}
                                </span>
                              </div>
                              <div style={{ opacity: 0.7, fontSize: 10 }}>
                                {t('ui.sidebar.branchHead', { id: shortId(branch.headNodeId) })}
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      {selectedBranch ? (
                        <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--z-border)', paddingTop: 8 }}>
                          <div style={{ color: 'var(--z-fg)', fontWeight: 700 }}>
                            {t('ui.sidebar.branchSelected', { name: selectedBranch.name })}
                          </div>
                          {selectedBranch.status === 'active' && mergeTargets.length > 0 ? (
                            <div style={{ display: 'grid', gap: 6 }}>
                              <label style={{ display: 'grid', gap: 4, color: 'var(--z-fg-subtle)', fontSize: 11 }}>
                                <span>{t('ui.sidebar.branchMergeInto')}</span>
                                <select value={targetId} onChange={(event) => onTargetChange(event.target.value)} style={sidebarInput}>
                                  {mergeTargets.map((entry) => (
                                    <option key={entry.id} value={entry.id}>
                                      {entry.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button type="button" onClick={onMergeBranch} style={sidebarPrimaryBtn}>
                                {t('ui.sidebar.branchMerge')}
                              </button>
                            </div>
                          ) : null}
                          {selectedBranch.status === 'active' ? (
                            <button type="button" onClick={onAbandonBranch} style={sidebarSecondaryBtn}>
                              {t('ui.sidebar.branchAbandon')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </SidebarSection>
                  <LiveActivitySidebar
                    activeControllers={activeControllers}
                    activeRuns={activeRuns}
                    nodes={nodes}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                  />
                  <LiveRunSidebar
                    liveRuns={liveRuns}
                    nodes={nodes}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                  />
                  <TimelinePanel
                    rows={timeline}
                    loading={timelineLoading}
                    hasMore={timelineHasMore}
                    onLoadMore={onLoadMoreTimeline}
                    onSelectNode={onFocusNode}
                  />
                  <WorkspaceInspectorPanel
                    sessionId={sessionId}
                    selectedNode={selectedRawNode}
                  />
                </div>
              ) : tab === 'chat' ? (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  <WorkflowCopilotPanel
                    sessionId={sessionId}
                    selectedNode={selectedRawNode}
                  />
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  <WorkspaceContentTabsPanel sessionId={sessionId} tabs={contentTabs} />
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
