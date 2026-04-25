import type {
  AgentCatalog,
  AgentCatalogProvider,
  AgentCatalogModel,
  AgentPromptPart,
  AgentType,
} from '@cepage/shared-core';
import type { AgentAdapter, AgentCatalogConfig, AgentLaunchConfig } from './adapter.js';
import { listClaudeCodeCatalog, runClaudeCodeStream } from './claude-code.js';
import { listCursorAgentCatalog, runCursorAgentStream } from './cursor-agent.js';
import { listOpenCodeCatalog, runOpenCodeStream } from './opencode-run.js';

function adapterOrder(type: AgentType): number {
  if (type === 'opencode') return 0;
  if (type === 'cursor_agent') return 1;
  if (type === 'claude_code') return 2;
  return 9;
}

function mergeAdapterCatalog(entry: {
  type: AgentType;
  label: string;
  catalog: AgentCatalog;
}): AgentCatalogProvider {
  const models = new Map<string, AgentCatalogModel>();
  for (const provider of entry.catalog.providers) {
    for (const model of provider.models) {
      const key = `${model.providerID}:${model.modelID}`;
      if (models.has(key)) continue;
      models.set(key, model);
    }
  }
  return {
    agentType: entry.type,
    providerID: entry.type,
    label: entry.label,
    availability: models.size === 0 ? 'unavailable' : 'ready',
    unavailableReason: models.size === 0 ? 'AGENT_CATALOG_EMPTY' : undefined,
    models: [...models.values()].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.label.localeCompare(b.label);
    }),
  };
}

function unavailableProvider(adapter: AgentAdapter, reason: string): AgentCatalogProvider {
  return {
    agentType: adapter.type,
    providerID: adapter.type,
    label: adapter.label,
    availability: 'unavailable',
    unavailableReason: reason,
    models: [],
  };
}

function hasNonText(parts?: AgentPromptPart[]): boolean {
  return (parts ?? []).some((part) => part.type !== 'text');
}

const ADAPTERS: AgentAdapter[] = [
  {
    type: 'opencode',
    label: 'OpenCode',
    async discoverCatalog(config) {
      return {
        type: 'opencode',
        label: 'OpenCode',
        catalog: await listOpenCodeCatalog({
          workingDirectory: config.workingDirectory,
          signal: config.signal,
          hostname: config.connection?.hostname,
          port: config.connection?.port,
        }),
      };
    },
    run(config) {
      return runOpenCodeStream({
        workingDirectory: config.workingDirectory,
        role: config.role,
        promptText: config.promptText,
        parts: config.parts,
        externalSessionId: config.externalSessionId,
        model: config.model,
        signal: config.signal,
        hostname: config.connection?.hostname,
        port: config.connection?.port,
      });
    },
  },
  {
    type: 'cursor_agent',
    label: 'Cursor Agent',
    async discoverCatalog(config) {
      return {
        type: 'cursor_agent',
        label: 'Cursor Agent',
        catalog: await listCursorAgentCatalog({
          workingDirectory: config.workingDirectory,
          signal: config.signal,
        }),
      };
    },
    run(config) {
      if (hasNonText(config.parts)) {
        throw new Error('AGENT_ADAPTER_MULTIMODAL_UNSUPPORTED:cursor_agent');
      }
      return runCursorAgentStream({
        workingDirectory: config.workingDirectory,
        promptText: config.promptText,
        model: config.model,
        signal: config.signal,
      });
    },
  },
  {
    type: 'claude_code',
    label: 'Claude Code',
    async discoverCatalog(config) {
      return {
        type: 'claude_code',
        label: 'Claude Code',
        catalog: await listClaudeCodeCatalog({
          workingDirectory: config.workingDirectory,
          signal: config.signal,
        }),
      };
    },
    run(config) {
      return runClaudeCodeStream({
        workingDirectory: config.workingDirectory,
        promptText: config.promptText,
        model: config.model,
        signal: config.signal,
      });
    },
  },
];

export function listAgentAdapters(): AgentAdapter[] {
  return ADAPTERS;
}

export function getAgentAdapter(type: AgentType): AgentAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.type === type);
}

export async function listAgentCatalog(config: AgentCatalogConfig = {}): Promise<AgentCatalog> {
  const adapters = config.type ? ADAPTERS.filter((adapter) => adapter.type === config.type) : ADAPTERS;
  const catalogs = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const entry = await adapter.discoverCatalog({ ...config, type: adapter.type });
        return { adapter, entry, error: null as string | null };
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
        return { adapter, entry: null, error: message };
      }
    }),
  );
  return {
    providers: catalogs
      .map(({ adapter, entry, error }) => {
        if (!entry) return unavailableProvider(adapter, error ?? 'AGENT_CATALOG_DISCOVERY_FAILED');
        return mergeAdapterCatalog(entry);
      })
      .sort(
        (a, b) =>
          adapterOrder(a.agentType) - adapterOrder(b.agentType) || a.label.localeCompare(b.label),
      ),
    fetchedAt: new Date().toISOString(),
  };
}

export function runAgentStream(config: AgentLaunchConfig) {
  const adapter = getAgentAdapter(config.type);
  if (!adapter) {
    throw new Error(`AGENT_ADAPTER_UNAVAILABLE:${config.type}`);
  }
  return adapter.run(config);
}
