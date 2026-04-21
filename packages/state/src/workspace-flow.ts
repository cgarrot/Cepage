import type { Node } from '@xyflow/react';
import {
  formatAgentModelLabel,
  summarizeApprovalRequestContent,
  summarizeApprovalResolutionContent,
  summarizeBudgetAlertContent,
  summarizeIntegrationDecisionContent,
  summarizeLeaseConflictContent,
  summarizeReviewReportContent,
  summarizeSystemTriggerContent,
  summarizeTestReportContent,
  summarizeWorkerEventContent,
  readFileSummaryContent,
  readWorkflowControllerSummary,
  readWorkflowManagedFlowSummary,
  summarizeWorkflowDecisionValidatorContent,
  readWorkflowArtifactContent,
  readWorkflowInputContent,
  readRuntimeRunSummary,
  readRuntimeTargetSummary,
  readRunArtifactsSummary,
  summarizeWorkflowArtifactContent,
  summarizeWorkflowManagedFlowContent,
  summarizeWorkflowLoopContent,
  summarizeWorkflowSubgraphContent,
  summarizeWorkflowInputContent,
  type AgentModelRef,
  type FileSummaryContent,
  type GraphNode,
  type RuntimeRunSummary,
  type RuntimeTargetSummary,
  type RunArtifactsSummary,
  type WorkflowArtifactContent,
  type WorkflowInputContent,
} from '@cepage/shared-core';

export type WorkspaceFlowNodeData = {
  raw: GraphNode;
  text: string;
  artifacts: RunArtifactsSummary | null;
  runtimeTarget: RuntimeTargetSummary | null;
  runtimeRun: RuntimeRunSummary | null;
  fileSummary: FileSummaryContent | null;
  workflowArtifact: WorkflowArtifactContent | null;
  workflowInput: WorkflowInputContent | null;
};

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

export function summarizeSpawnContent(content: GraphNode['content']): string {
  const spawn = content as {
    agentType?: unknown;
    role?: unknown;
    label?: unknown;
    model?: unknown;
    config?: { workingDirectory?: unknown; contextNodeIds?: unknown };
  };
  const cfg = spawn.config;
  const agentType = readString((content as { agentType?: unknown }).agentType) ?? 'agent';
  const role = readString(spawn.role);
  const label = readString(spawn.label);
  const model = readAgentModelRef(spawn.model);
  const workingDirectory = readString(cfg?.workingDirectory) ?? '.';
  const contextCount = Array.isArray(cfg?.contextNodeIds) ? cfg.contextNodeIds.length : 0;
  const modelLine = model ? `\nmodel: ${formatAgentModelLabel(model)}` : '';
  return `${label ?? agentType}${role ? ` · ${role}` : ''}${modelLine}\ncwd: ${workingDirectory}\ncontext nodes: ${contextCount}`;
}

export function getNodeText(node: GraphNode): string {
  const text = readString((node.content as { text?: unknown }).text);
  const output = readString((node.content as { output?: unknown }).output);
  const message = readString((node.content as { message?: unknown }).message);
  const title = readString((node.content as { title?: unknown }).title);
  const fileSummary = readFileSummaryContent(node.content);
  const runtimeTarget = readRuntimeTargetSummary(node.metadata) ?? readRuntimeTargetSummary(node.content);
  const runtimeRun = readRuntimeRunSummary(node.metadata) ?? readRuntimeRunSummary(node.content);
  const controller = readWorkflowControllerSummary(node.metadata);

  if (node.type === 'agent_output') return output ?? text ?? '';
  if (node.type === 'agent_status') return message ?? text ?? '';
  if (node.type === 'agent_spawn' || node.type === 'agent_step') return text ?? summarizeSpawnContent(node.content);
  if (node.type === 'file_summary') {
    return (
      fileSummary?.summary ??
      fileSummary?.generatedSummary ??
      fileSummary?.files?.[0]?.file.name ??
      'Upload a file to summarize it.'
    );
  }
  if (node.type === 'workspace_file') {
    return summarizeWorkflowArtifactContent(node.content) || 'Reference a workspace file here.';
  }
  if (node.type === 'workflow_copilot') {
    const lines = [title ?? 'Workflow copilot', text ?? 'Use the right dock to drive workflow generation.'];
    return lines.filter(Boolean).join('\n');
  }
  if (node.type === 'system_trigger') {
    return summarizeSystemTriggerContent(node.content) || text || 'System trigger';
  }
  if (node.type === 'input') {
    return summarizeWorkflowInputContent(node.content) || 'Define workflow inputs here.';
  }
  if (node.type === 'loop') {
    const lines = [summarizeWorkflowLoopContent(node.content) || 'Loop controller'];
    if (controller) {
      lines.push(`status: ${controller.status}`);
      if (controller.currentItemLabel) {
        lines.push(`current: ${controller.currentItemLabel}`);
      }
      if (controller.totalItems != null) {
        const current =
          controller.currentIndex != null
            ? Math.min(controller.currentIndex + 1, controller.totalItems)
            : 0;
        lines.push(`progress: ${current}/${controller.totalItems}`);
      }
      if (controller.resolvedBoundNodeId) {
        lines.push(`bound input: ${controller.resolvedBoundNodeId}`);
      }
      if (controller.materializedItemCount != null) {
        const parts =
          controller.sourcePartCount != null ? ` from ${controller.sourcePartCount} part(s)` : '';
        lines.push(`materialized: ${controller.materializedItemCount} item(s)${parts}`);
      }
      if (controller.lastDecisionDetail) {
        lines.push(`detail: ${controller.lastDecisionDetail}`);
      }
      if (controller.materializationWarning) {
        lines.push(`warning: ${controller.materializationWarning}`);
      }
    }
    return lines.filter(Boolean).join('\n');
  }
  if (node.type === 'managed_flow') {
    const lines = [summarizeWorkflowManagedFlowContent(node.content) || 'Managed flow'];
    const flow = readWorkflowManagedFlowSummary(node.metadata);
    if (flow) {
      lines.push(`status: ${flow.status}`);
      if (flow.currentPhaseKind) {
        lines.push(`phase: ${flow.currentPhaseKind}`);
      }
      if (flow.phaseCount > 0) {
        lines.push(`progress: ${flow.completedPhaseCount}/${flow.phaseCount}`);
      }
      if (flow.waitDetail) {
        lines.push(`detail: ${flow.waitDetail}`);
      } else if (flow.lastDetail) {
        lines.push(`detail: ${flow.lastDetail}`);
      }
    }
    return lines.filter(Boolean).join('\n');
  }
  if (node.type === 'sub_graph') {
    return summarizeWorkflowSubgraphContent(node.content) || 'Reference a workflow to execute here.';
  }
  if (node.type === 'decision') {
    return (
      summarizeWorkflowDecisionValidatorContent(node.content) ||
      text ||
      'Define the validator checks and follow-up actions here.'
    );
  }
  if (node.type === 'approval_request') {
    return summarizeApprovalRequestContent(node.content) || text || 'Approval request';
  }
  if (node.type === 'approval_resolution') {
    return summarizeApprovalResolutionContent(node.content) || text || 'Approval resolution';
  }
  if (node.type === 'review_report') {
    return summarizeReviewReportContent(node.content) || text || 'Review report';
  }
  if (node.type === 'test_report') {
    return summarizeTestReportContent(node.content) || text || 'Test report';
  }
  if (node.type === 'integration_decision') {
    return summarizeIntegrationDecisionContent(node.content) || text || 'Integration decision';
  }
  if (node.type === 'lease_conflict') {
    return summarizeLeaseConflictContent(node.content) || text || 'Lease conflict';
  }
  if (node.type === 'budget_alert') {
    return summarizeBudgetAlertContent(node.content) || text || 'Budget alert';
  }
  if (node.type === 'worker_event') {
    return summarizeWorkerEventContent(node.content) || text || 'Worker event';
  }
  if (node.type === 'runtime_target' && runtimeTarget) {
    const command = runtimeTarget.command ? `\n${runtimeTarget.command} ${(runtimeTarget.args ?? []).join(' ')}` : '';
    return `${runtimeTarget.kind} target\n${runtimeTarget.serviceName}\n${runtimeTarget.cwd}${command}`;
  }
  if (node.type === 'runtime_run' && runtimeRun) {
    const command = runtimeRun.command ? `\n${runtimeRun.command} ${(runtimeRun.args ?? []).join(' ')}` : '';
    return `${runtimeRun.targetKind} run\n${runtimeRun.serviceName}\n${runtimeRun.status}${command}`;
  }

  return text ?? message ?? output ?? '';
}

export function toFlowNode(n: GraphNode): Node<WorkspaceFlowNodeData> {
  const width =
    n.type === 'agent_spawn'
      || n.type === 'agent_step'
      ? 320
      : n.type === 'agent_output'
        ? 420
        : n.type === 'input'
          ? 360
        : n.type === 'loop'
          ? 360
        : n.type === 'managed_flow'
          ? 380
        : n.type === 'sub_graph'
          ? 360
        : n.type === 'decision'
          ? 340
        : n.type === 'workspace_file'
          ? 420
        : n.type === 'workflow_copilot'
          ? 360
        : n.type === 'file_summary'
          ? 500
        : n.type === 'runtime_target'
          ? 360
          : n.type === 'runtime_run'
            ? 420
        : n.type === 'agent_status'
          ? 240
          : (n.dimensions?.width ?? 280);
  const minHeight =
    n.type === 'agent_spawn'
      || n.type === 'agent_step'
      ? 210
      : n.type === 'agent_output'
        ? 220
        : n.type === 'input'
          ? 220
        : n.type === 'loop'
          ? 240
        : n.type === 'managed_flow'
          ? 240
        : n.type === 'sub_graph'
          ? 220
        : n.type === 'decision'
          ? 220
        : n.type === 'workspace_file'
          ? 220
        : n.type === 'workflow_copilot'
          ? 260
        : n.type === 'file_summary'
          ? 380
        : n.type === 'runtime_target'
          ? 220
          : n.type === 'runtime_run'
            ? 280
        : n.type === 'agent_status'
          ? 110
          : 120;
  const artifacts = readRunArtifactsSummary(n.metadata);
  const runtimeTarget = readRuntimeTargetSummary(n.metadata) ?? readRuntimeTargetSummary(n.content);
  const runtimeRun = readRuntimeRunSummary(n.metadata) ?? readRuntimeRunSummary(n.content);
  const fileSummary = readFileSummaryContent(n.content);
  const workflowArtifact = readWorkflowArtifactContent(n.content);
  const workflowInput = readWorkflowInputContent(n.content);
  return {
    id: n.id,
    type:
      n.type === 'agent_output'
        ? 'agentOutput'
        : n.type === 'input'
          ? 'inputNode'
        : n.type === 'agent_step'
          ? 'editableText'
        : n.type === 'workspace_file'
          ? 'workspaceFile'
        : n.type === 'file_summary'
          ? 'fileSummary'
        : n.type === 'workflow_copilot'
          ? 'workflowCopilot'
        : n.type === 'runtime_target'
          ? 'runtimeTarget'
          : n.type === 'runtime_run'
            ? 'runtimeRun'
            : 'editableText',
    position: n.position,
    data: { text: getNodeText(n), raw: n, artifacts, runtimeTarget, runtimeRun, fileSummary, workflowArtifact, workflowInput },
    style: { width, minHeight },
  };
}
