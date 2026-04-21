import type {
  AgentCatalog,
  AgentDelegationContext,
  AgentKernelRecallEntry,
  AgentModelRef,
  AgentPromptPart,
  AgentRuntime,
  AgentToolsetId,
  AgentRuntimeEvent,
  AgentType,
  WakeReason,
} from '@cepage/shared-core';

export interface AgentConnectionOptions {
  port?: number;
  hostname?: string;
}

export interface AgentCatalogConfig {
  type?: AgentType;
  workingDirectory?: string;
  signal?: AbortSignal;
  connection?: AgentConnectionOptions;
}

export interface AgentLaunchConfig {
  sessionId: string;
  type: AgentType;
  runtime: AgentRuntime;
  role: string;
  model?: AgentModelRef;
  workingDirectory: string;
  /** Assembled prompt text for the selected adapter. */
  promptText: string;
  /** Multimodal prompt parts when the adapter supports them. */
  parts?: AgentPromptPart[];
  /** External adapter session id for long-horizon continuation. */
  externalSessionId?: string;
  /** Kernel role policy applied to this run. */
  toolset?: AgentToolsetId;
  /** Durable recall injected for this turn. */
  recall?: AgentKernelRecallEntry[];
  /** Delegation context when this run was spawned by another run. */
  delegation?: AgentDelegationContext;
  wakeReason: WakeReason;
  seedNodeIds: string[];
  signal?: AbortSignal;
  connection?: AgentConnectionOptions;
}

export type AgentAdapterEvent =
  | AgentRuntimeEvent
  | { type: 'session'; externalSessionId: string }
  | { type: 'snapshot'; output: string };

export interface AgentAdapterCatalog {
  type: AgentType;
  label: string;
  catalog: AgentCatalog;
}

export interface AgentAdapter {
  type: AgentType;
  label: string;
  discoverCatalog(config: AgentCatalogConfig): Promise<AgentAdapterCatalog>;
  run(config: AgentLaunchConfig): AsyncGenerator<AgentAdapterEvent>;
}
