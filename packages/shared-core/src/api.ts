export interface ApiOk<T> {
  success: true;
  data: T;
}

export type ErrOpts = {
  details?: Record<string, unknown>;
  retryable?: boolean;
  key?: string;
  params?: Record<string, unknown>;
};

export interface ApiErr {
  success: false;
  error: {
    code: string;
    message: string;
    key?: string;
    params?: Record<string, unknown>;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function ok<T>(data: T): ApiOk<T> {
  return { success: true, data };
}

export function err(code: string, message: string, opts?: ErrOpts): ApiErr {
  return {
    success: false,
    error: {
      code,
      message,
      details: opts?.details,
      retryable: opts?.retryable,
      key: opts?.key,
      params: opts?.params,
    },
  };
}

/** WebSocket server → client graph / agent events */
export type WsServerEvent =
  | {
      type: 'graph.node_added';
      eventId: number;
      sessionId: string;
      runId?: string;
      wakeReason?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./graph').GraphNode;
    }
  | {
      type: 'graph.node_updated';
      eventId: number;
      sessionId: string;
      runId?: string;
      requestId?: string;
      wakeReason?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { nodeId: string; patch: Partial<import('./graph').GraphNode> };
    }
  | {
      type: 'graph.node_removed';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { nodeId: string };
    }
  | {
      type: 'graph.edge_added';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./graph').GraphEdge;
    }
  | {
      type: 'graph.edge_removed';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { edgeId: string };
    }
  | {
      type: 'graph.branch_created';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./graph').Branch;
    }
  | {
      type: 'graph.branch_merged';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { sourceBranchId: string; targetBranchId: string };
    }
  | {
      type: 'graph.branch_abandoned';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { branchId: string };
    }
  | {
      type: 'agent.status';
      eventId: number;
      sessionId: string;
      runId?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./agent').AgentRun;
    }
  | {
      type: 'agent.output_chunk';
      eventId: number;
      sessionId: string;
      runId?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: { agentRunId: string; executionId?: string; output: string; isStreaming: boolean };
    }
  | {
      type: 'agent.spawned';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./agent').AgentRun;
    }
  | {
      type: 'activity.logged';
      eventId: number;
      sessionId: string;
      runId?: string;
      wakeReason?: string;
      requestId?: string;
      workerId?: string;
      worktreeId?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: {
        id: string;
        summary: string;
        summaryKey?: string;
        summaryParams?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
        relatedNodeIds?: string[];
      };
    }
  | {
      type: 'workflow.controller_updated';
      eventId: number;
      sessionId: string;
      runId?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./workflow-control').WorkflowControllerState;
    }
  | {
      type: 'workflow.flow_updated';
      eventId: number;
      sessionId: string;
      runId?: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./workflow-control').WorkflowManagedFlowState;
    }
  | {
      type: 'workflow.copilot_thread_updated';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./workflow-copilot').WorkflowCopilotThread;
    }
  | {
      type: 'workflow.copilot_message_updated';
      eventId: number;
      sessionId: string;
      actor: { type: string; id: string };
      timestamp: string;
      payload: import('./workflow-copilot').WorkflowCopilotLiveMessagePayload;
    }
  | {
      type: 'system.resync_required';
      eventId: number;
      sessionId: string;
      payload: { reason: string };
    };
