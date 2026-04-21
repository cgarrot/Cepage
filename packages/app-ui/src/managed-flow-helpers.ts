import { readLooseWorkflowManagedFlowContent, type GraphNode } from '@cepage/shared-core';

export function canRenderManagedFlowForm(raw: GraphNode): boolean {
  return raw.type === 'managed_flow' && Boolean(readLooseWorkflowManagedFlowContent(raw.content));
}
