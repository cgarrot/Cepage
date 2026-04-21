import type { AgentModelRef, AgentRun, TimelineEntry } from '@cepage/shared-core';

export type StatusDescriptor = {
  key: string;
  params?: Record<string, unknown>;
  fallback?: string;
};

export type ActivityLine = TimelineEntry;

export type LiveRunDescriptor = {
  id: string;
  executionId?: string;
  type: AgentRun['type'];
  status: AgentRun['status'];
  agentLabel: string;
  model?: AgentModelRef;
  workspacePath?: string;
  rootNodeId?: string;
  outputNodeId?: string;
  sourceNodeId?: string;
  triggerNodeId?: string;
  stepNodeId?: string;
  seedNodeIds: string[];
  output: string;
  isStreaming: boolean;
  isActive: boolean;
  startedAt?: string;
  endedAt?: string;
  lastUpdateAt: string;
};
