'use client';

import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentCatalogProvider } from '@cepage/shared-core';
import { formatAgentModelLabel, formatAgentTypeLabel } from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { useI18n } from './I18nProvider';

type MenuPosition = {
  left: number;
  // Exactly one of `top` / `bottom` is set: the menu is anchored to the
  // viewport edge matching the anchor so its visible height follows the
  // contents rather than the max-height. A drop-up popover sets `bottom` so
  // that its bottom edge stays glued to the trigger regardless of how many
  // rows the menu ends up rendering.
  top?: number;
  bottom?: number;
};

type VerticalAnchor = { top: number } | { bottom: number };

const PROVIDER_MENU_WIDTH = 260;
const PROVIDER_MENU_MAX_HEIGHT = 320;
const MODEL_MENU_WIDTH = 280;
const MODEL_MENU_MAX_HEIGHT = 320;
const MENU_PADDING = 12;
const MENU_TRIGGER_GAP = 6;

type MenuModel = AgentCatalogProvider['models'][number] & {
  sourceLabel: string;
};

type MenuProvider = {
  agentType: AgentCatalogProvider['agentType'];
  label: string;
  models: MenuModel[];
  availability: NonNullable<AgentCatalogProvider['availability']> | 'ready';
  unavailableReason?: string;
};

type AgentModelMenuProps = {
  selection: AgentRunSelection | null;
  onSelect: (selection: AgentRunSelection) => void;
  renderTrigger: (props: {
    open: boolean;
    loading: boolean;
    selectionLabel: string | null;
    toggle: () => void;
  }) => ReactNode;
};

function clampPosition(
  left: number,
  width: number,
  height: number,
  vertical: VerticalAnchor,
): MenuPosition {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const clampedLeft = Math.max(
    MENU_PADDING,
    Math.min(left, viewportWidth - width - MENU_PADDING),
  );
  const maxVertical = Math.max(MENU_PADDING, viewportHeight - height - MENU_PADDING);
  if ('top' in vertical) {
    return {
      left: clampedLeft,
      top: Math.max(MENU_PADDING, Math.min(vertical.top, maxVertical)),
    };
  }
  return {
    left: clampedLeft,
    bottom: Math.max(MENU_PADDING, Math.min(vertical.bottom, maxVertical)),
  };
}

/**
 * Place the provider popover near the trigger — drop-down when it fits, otherwise
 * drop-up so the menu stays visually anchored to the button (composer often sits
 * at the bottom of the viewport, where a naive drop-down would be clamped to the
 * middle of the screen). In drop-up mode the popover is anchored by its bottom
 * edge so its visible height follows the rendered content instead of floating
 * far above the trigger when the menu has only a couple of rows.
 */
function positionAroundTrigger(
  triggerRect: DOMRect,
  width: number,
  desiredHeight: number,
): { position: MenuPosition; height: number } {
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const spaceBelow = viewportHeight - triggerRect.bottom - MENU_PADDING;
  const spaceAbove = triggerRect.top - MENU_PADDING;
  const dropDown = spaceBelow >= Math.min(desiredHeight, 200) || spaceBelow >= spaceAbove;
  const available = Math.max(160, dropDown ? spaceBelow : spaceAbove);
  const height = Math.min(desiredHeight, available);
  const vertical: VerticalAnchor = dropDown
    ? { top: triggerRect.bottom + MENU_TRIGGER_GAP }
    : { bottom: viewportHeight - triggerRect.top + MENU_TRIGGER_GAP };
  return {
    position: clampPosition(triggerRect.left, width, height, vertical),
    height,
  };
}

/**
 * Place the submenu next to its provider row — drop-right when it fits, drop-left
 * otherwise. The vertical anchor follows the row's top edge when there is enough
 * room below it, otherwise the submenu is pinned by its bottom to avoid the
 * clamped max-height pushing the menu arbitrarily high away from the row.
 */
function positionAroundRow(
  rowRect: DOMRect,
  width: number,
  desiredHeight: number,
): { position: MenuPosition; height: number } {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const spaceRight = viewportWidth - rowRect.right - MENU_PADDING;
  const spaceLeft = rowRect.left - MENU_PADDING;
  const dropRight = spaceRight >= width || spaceRight >= spaceLeft;
  const left = dropRight ? rowRect.right + MENU_TRIGGER_GAP : rowRect.left - width - MENU_TRIGGER_GAP;
  const spaceBelow = viewportHeight - rowRect.top - MENU_PADDING;
  const spaceAbove = rowRect.bottom - MENU_PADDING;
  const alignTop = spaceBelow >= Math.min(desiredHeight, 200) || spaceBelow >= spaceAbove;
  const available = Math.max(180, alignTop ? spaceBelow : spaceAbove);
  const height = Math.min(desiredHeight, available);
  const vertical: VerticalAnchor = alignTop
    ? { top: rowRect.top }
    : { bottom: viewportHeight - rowRect.bottom };
  return {
    position: clampPosition(left, width, height, vertical),
    height,
  };
}

function adapterOrder(type: AgentCatalogProvider['agentType']): number {
  if (type === 'opencode') return 0;
  if (type === 'cursor_agent') return 1;
  return 9;
}

function adapterLabel(type: AgentCatalogProvider['agentType']): string {
  if (type === 'opencode') return 'OpenCode';
  if (type === 'cursor_agent') return 'Cursor Agent';
  return type.replace(/_/g, ' ');
}

function providerKey(provider: MenuProvider): string {
  return provider.agentType;
}

function buildProviderGroups(providers: AgentCatalogProvider[]): MenuProvider[] {
  const groups = new Map<AgentCatalogProvider['agentType'], MenuProvider>();
  for (const provider of providers) {
    const group =
      groups.get(provider.agentType) ??
      ({
        agentType: provider.agentType,
        label: adapterLabel(provider.agentType),
        models: [],
        availability: 'ready',
      } as MenuProvider);
    for (const model of provider.models) {
      if (
        group.models.some(
          (entry) => entry.providerID === model.providerID && entry.modelID === model.modelID,
        )
      ) {
        continue;
      }
      group.models.push({
        ...model,
        sourceLabel: provider.label,
      });
    }
    if (provider.availability === 'unavailable' && group.models.length === 0) {
      group.availability = 'unavailable';
      group.unavailableReason = provider.unavailableReason ?? group.unavailableReason;
    } else if (group.models.length > 0) {
      group.availability = 'ready';
      group.unavailableReason = undefined;
    }
    groups.set(provider.agentType, group);
  }
  return [...groups.values()]
    .map((provider) => ({
      ...provider,
      models: provider.models.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.label.localeCompare(b.label);
      }),
    }))
    .sort(
      (a, b) =>
        adapterOrder(a.agentType) - adapterOrder(b.agentType) || a.label.localeCompare(b.label),
    );
}

function matchesSelection(
  provider: MenuProvider,
  selection: AgentRunSelection | null,
  model?: MenuModel,
): boolean {
  if (!selection || selection.type !== provider.agentType) return false;
  if (!selection.model) return false;
  if (!model) {
    return provider.models.some(
      (entry) =>
        entry.providerID === selection.model?.providerID && entry.modelID === selection.model?.modelID,
    );
  }
  return (
    selection.model.providerID === model.providerID && selection.model.modelID === model.modelID
  );
}

function matchesModelQuery(model: MenuModel, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [
    model.label,
    model.modelID,
    model.providerID,
    model.sourceLabel,
    formatAgentModelLabel({
      providerID: model.providerID,
      modelID: model.modelID,
    }),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function modelMeta(model: MenuModel): string {
  if (model.description?.trim()) return model.description.trim();
  const ref = formatAgentModelLabel({
    providerID: model.providerID,
    modelID: model.modelID,
  });
  return model.label === ref ? '' : ref;
}

function selectedRunLabel(
  providers: MenuProvider[],
  selection: AgentRunSelection | null,
): string | null {
  if (!selection) return null;
  const providerLabel =
    providers.find((provider) => provider.agentType === selection.type)?.label ??
    formatAgentTypeLabel(selection.type);
  if (!selection.model) return providerLabel;
  const modelLabel =
    providers
      .flatMap((provider) => provider.models)
      .find(
        (model) =>
          model.providerID === selection.model?.providerID && model.modelID === selection.model?.modelID,
      )?.label ?? formatAgentModelLabel(selection.model);
  return `${providerLabel} · ${modelLabel}`;
}

export function AgentModelMenu({
  selection,
  onSelect,
  renderTrigger,
}: AgentModelMenuProps) {
  const { t } = useI18n();
  const catalogProviders = useWorkspaceStore((s) => s.agentCatalog);
  const loading = useWorkspaceStore((s) => s.agentCatalogLoading);
  const refreshAgentCatalog = useWorkspaceStore((s) => s.refreshAgentCatalog);
  const providers = useMemo(() => buildProviderGroups(catalogProviders), [catalogProviders]);
  const groupRef = useRef<HTMLDivElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const providerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState<{ position: MenuPosition; height: number }>({
    position: { left: 0, top: 0 },
    height: PROVIDER_MENU_MAX_HEIGHT,
  });
  const [submenuLayout, setSubmenuLayout] = useState<{ position: MenuPosition; height: number }>({
    position: { left: 0, top: 0 },
    height: MODEL_MENU_MAX_HEIGHT,
  });
  const [activeProviderKey, setActiveProviderKey] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    void refreshAgentCatalog();
  }, [open, refreshAgentCatalog]);

  useEffect(() => {
    if (!open) return;
    const matchingProvider =
      providers.find((provider) => matchesSelection(provider, selection)) ?? providers[0] ?? null;
    setActiveProviderKey(matchingProvider ? providerKey(matchingProvider) : null);
  }, [open, providers, selection]);

  useEffect(() => {
    if (!open) {
      setModelQuery('');
      return;
    }
    setModelQuery('');
  }, [activeProviderKey, open]);

  useLayoutEffect(() => {
    if (!open || !groupRef.current) return;
    const rect = groupRef.current.getBoundingClientRect();
    setMenuLayout(positionAroundTrigger(rect, PROVIDER_MENU_WIDTH, PROVIDER_MENU_MAX_HEIGHT));
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !activeProviderKey) return;
    const row = providerRefs.current.get(activeProviderKey);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    setSubmenuLayout(positionAroundRow(rect, MODEL_MENU_WIDTH, MODEL_MENU_MAX_HEIGHT));
  }, [activeProviderKey, open, providers]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (groupRef.current) {
        setMenuLayout(
          positionAroundTrigger(
            groupRef.current.getBoundingClientRect(),
            PROVIDER_MENU_WIDTH,
            PROVIDER_MENU_MAX_HEIGHT,
          ),
        );
      }
      if (activeProviderKey) {
        const row = providerRefs.current.get(activeProviderKey);
        if (row) {
          setSubmenuLayout(
            positionAroundRow(row.getBoundingClientRect(), MODEL_MENU_WIDTH, MODEL_MENU_MAX_HEIGHT),
          );
        }
      }
    };
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, activeProviderKey]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (groupRef.current?.contains(event.target)) return;
      if (providerMenuRef.current?.contains(event.target)) return;
      if (modelMenuRef.current?.contains(event.target)) return;
      for (const row of providerRefs.current.values()) {
        if (row.contains(event.target)) return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const activeProvider =
    activeProviderKey ? providers.find((provider) => providerKey(provider) === activeProviderKey) ?? null : null;
  const filteredModels = useMemo(
    () => activeProvider?.models.filter((model) => matchesModelQuery(model, modelQuery)) ?? [],
    [activeProvider, modelQuery],
  );
  const selectionLabel = useMemo(
    () => selectedRunLabel(providers, selection),
    [providers, selection],
  );

  return (
    <div ref={groupRef} className="nodrag nopan" style={{ position: 'relative' }}>
      {renderTrigger({
        open,
        loading,
        selectionLabel,
        toggle: () => setOpen((current) => !current),
      })}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                ref={providerMenuRef}
                role="menu"
                style={providerMenuStyle(menuLayout.position, menuLayout.height)}
              >
                {loading && providers.length === 0 ? (
                  <div style={emptyStyle}>{t('ui.node.loadingProviders')}</div>
                ) : null}
                {!loading && providers.length === 0 ? (
                  <div style={emptyStyle}>{t('ui.node.noProviders')}</div>
                ) : null}
                {providers.map((provider) => {
                  const key = providerKey(provider);
                  const isActive = key === activeProviderKey;
                  const isSelected = matchesSelection(provider, selection);
                  const isUnavailable = provider.availability === 'unavailable';
                  return (
                    <button
                      key={key}
                      ref={(node) => {
                        if (node) providerRefs.current.set(key, node);
                        else providerRefs.current.delete(key);
                      }}
                      type="button"
                      role="menuitem"
                      className="nodrag nopan"
                      title={isUnavailable ? provider.unavailableReason ?? t('ui.node.providerUnavailable') : undefined}
                      onMouseDown={(event) => event.stopPropagation()}
                      onMouseEnter={() => setActiveProviderKey(key)}
                      onFocus={() => setActiveProviderKey(key)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveProviderKey(key);
                      }}
                      style={providerRowStyle(isActive, isSelected, isUnavailable)}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{provider.label}</span>
                      {isUnavailable ? (
                        <span style={{ fontSize: 11, color: 'var(--z-menu-desc)' }}>
                          {t('ui.node.providerUnavailable')}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {activeProvider ? (
                <div
                  ref={modelMenuRef}
                  role="menu"
                  style={modelMenuStyle(submenuLayout.position, submenuLayout.height)}
                >
                  <div style={modelTitleStyle}>{activeProvider.label}</div>
                  {activeProvider.availability === 'unavailable' ? (
                    <div style={{ ...emptyStyle, padding: '12px 14px', display: 'grid', gap: 6 }}>
                      <span style={{ fontWeight: 600, color: 'var(--z-fg)' }}>
                        {t('ui.node.providerUnavailable')}
                      </span>
                      {activeProvider.unavailableReason ? (
                        <span style={{ fontSize: 11 }}>{activeProvider.unavailableReason}</span>
                      ) : null}
                      <span style={{ fontSize: 11 }}>{t('ui.node.providerUnavailableHelp')}</span>
                    </div>
                  ) : null}
                  <div style={searchWrapStyle}>
                    <input
                      value={modelQuery}
                      placeholder={t('ui.node.searchModels')}
                      spellCheck={false}
                      className="nodrag nopan"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setModelQuery(event.target.value)}
                      style={searchInputStyle}
                    />
                  </div>
                  <div style={{ display: 'grid', gap: 4, paddingTop: 8 }}>
                    {filteredModels.length === 0 ? (
                      <div style={emptyStyle}>{t('ui.node.noModelsMatch')}</div>
                    ) : null}
                    {filteredModels.map((model) => {
                      const selected = matchesSelection(activeProvider, selection, model);
                      const meta = modelMeta(model);
                      return (
                        <button
                          key={`${model.providerID}:${model.modelID}`}
                          type="button"
                          role="menuitem"
                          className="nodrag nopan"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen(false);
                            onSelect({
                              type: activeProvider.agentType,
                              model: {
                                providerID: model.providerID,
                                modelID: model.modelID,
                              },
                            });
                          }}
                          style={modelRowStyle(selected)}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{model.label}</span>
                          {meta || model.isDefault ? (
                            <span style={{ fontSize: 11, color: 'var(--z-menu-desc)' }}>
                              {meta}
                              {model.isDefault ? `${meta ? ' ' : ''}default` : ''}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

const emptyStyle = {
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--z-menu-desc)',
} as const;

function providerMenuStyle(position: MenuPosition, height: number) {
  return {
    position: 'fixed' as const,
    left: position.left,
    top: position.top,
    bottom: position.bottom,
    zIndex: 1200,
    width: PROVIDER_MENU_WIDTH,
    maxHeight: height,
    overflowY: 'auto' as const,
    padding: 8,
    borderRadius: 12,
    border: '1px solid var(--z-menu-border)',
    background: 'var(--z-menu-bg)',
    boxShadow: 'var(--z-menu-shadow)',
    backdropFilter: 'blur(16px)',
  };
}

function providerRowStyle(isActive: boolean, isSelected: boolean, isUnavailable = false) {
  return {
    width: '100%',
    display: 'grid',
    gap: 2,
    padding: '10px 12px',
    borderRadius: 10,
    border: isActive ? '1px solid var(--z-node-run-border)' : '1px solid transparent',
    background: isSelected ? 'var(--z-node-run-bg)' : 'var(--z-menu-item-bg)',
    color: 'var(--z-fg)',
    textAlign: 'left',
    cursor: 'pointer',
    opacity: isUnavailable ? 0.65 : 1,
  } as const;
}

function modelMenuStyle(position: MenuPosition, height: number) {
  return {
    position: 'fixed' as const,
    left: position.left,
    top: position.top,
    bottom: position.bottom,
    zIndex: 1201,
    width: MODEL_MENU_WIDTH,
    maxHeight: height,
    overflowY: 'auto' as const,
    padding: 8,
    borderRadius: 12,
    border: '1px solid var(--z-menu-border)',
    background: 'var(--z-menu-bg)',
    boxShadow: 'var(--z-menu-shadow)',
    backdropFilter: 'blur(16px)',
  };
}

const modelTitleStyle = {
  padding: '8px 10px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--z-menu-title)',
  borderBottom: '1px solid var(--z-border-muted)',
} as const;

const searchWrapStyle = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--z-border-muted)',
} as const;

const searchInputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  outline: 'none',
} as const;

function modelRowStyle(selected: boolean) {
  return {
    width: '100%',
    display: 'grid',
    gap: 2,
    padding: '10px 12px',
    borderRadius: 10,
    border: selected ? '1px solid var(--z-node-run-border)' : '1px solid transparent',
    background: selected ? 'var(--z-node-run-bg)' : 'var(--z-menu-item-bg)',
    color: 'var(--z-fg)',
    textAlign: 'left',
    cursor: 'pointer',
  } as const;
}
