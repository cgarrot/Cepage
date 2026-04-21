import type {
  AgentCatalog,
  AgentCatalogProvider,
  AgentModelRef,
  AgentSpawnRequest,
  WorkflowCopilotThread,
} from '@cepage/shared-core';

export type AgentRunSelection = Pick<AgentSpawnRequest, 'type' | 'model'>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readAgentModelRef(value: unknown): AgentModelRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const providerID = readString((value as { providerID?: unknown }).providerID);
  const modelID = readString((value as { modelID?: unknown }).modelID);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function normalizeSelection(selection?: AgentRunSelection | null): AgentRunSelection {
  return {
    type: selection?.type ?? 'opencode',
    model: readAgentModelRef(selection?.model),
  };
}

export function selectionMatchesCatalog(
  provider: AgentCatalogProvider,
  selection: AgentRunSelection | null | undefined,
): boolean {
  if (!selection || provider.agentType !== selection.type) return false;
  if (!selection.model) return false;
  return provider.models.some(
    (model) =>
      model.providerID === selection.model?.providerID && model.modelID === selection.model?.modelID,
  );
}

function defaultSelectionFromCatalog(providers: AgentCatalog['providers']): AgentRunSelection | null {
  const provider = providers.find((entry) => entry.models.length > 0);
  if (!provider) return null;
  const model = provider.models.find((entry) => entry.isDefault) ?? provider.models[0];
  return {
    type: provider.agentType,
    model: model
      ? {
          providerID: model.providerID,
          modelID: model.modelID,
        }
      : undefined,
  };
}

export function resolveSelection(
  providers: AgentCatalog['providers'],
  explicit?: AgentRunSelection | null,
  fallback?: AgentRunSelection | null,
): AgentRunSelection {
  const normalizedExplicit = explicit ? normalizeSelection(explicit) : null;
  if (normalizedExplicit && providers.some((provider) => selectionMatchesCatalog(provider, normalizedExplicit))) {
    return normalizedExplicit;
  }
  const normalizedFallback = fallback ? normalizeSelection(fallback) : null;
  if (normalizedFallback && providers.some((provider) => selectionMatchesCatalog(provider, normalizedFallback))) {
    return normalizedFallback;
  }
  return defaultSelectionFromCatalog(providers) ?? normalizeSelection(explicit ?? fallback);
}

export function selectionFromThread(thread: WorkflowCopilotThread | null): AgentRunSelection | null {
  if (!thread) return null;
  return normalizeSelection({
    type: thread.agentType,
    model: thread.model,
  });
}

export function sameWorkflowCopilotThread(
  a: WorkflowCopilotThread | null | undefined,
  b: WorkflowCopilotThread | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.id === b.id
    || (a.sessionId === b.sessionId
      && a.surface === b.surface
      && (a.ownerNodeId ?? null) === (b.ownerNodeId ?? null))
  );
}
