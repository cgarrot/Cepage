'use client';

import { readWorkflowSubgraphContent, type GraphNode } from '@cepage/shared-core';
import { canRenderManagedFlowForm } from './managed-flow-helpers';
import { DecisionEditor } from './structured-node-editor/DecisionEditor';
import { LoopEditor } from './structured-node-editor/LoopEditor';
import { ManagedFlowEditor } from './structured-node-editor/ManagedFlowEditor';
import { readLooseWorkflowDecisionValidatorContent, readLooseWorkflowLoopContent } from './structured-node-editor/normalize';
import { SubgraphEditor } from './structured-node-editor/SubgraphEditor';
import type { StructuredNodeEditorProps } from './structured-node-editor/types';

export function canRenderStructuredForm(raw: GraphNode): boolean {
  if (raw.type === 'loop') {
    return Boolean(readLooseWorkflowLoopContent(raw.content));
  }
  if (raw.type === 'managed_flow') {
    return canRenderManagedFlowForm(raw);
  }
  if (raw.type === 'sub_graph') {
    return Boolean(readWorkflowSubgraphContent(raw.content));
  }
  if (raw.type === 'decision') {
    return Boolean(readLooseWorkflowDecisionValidatorContent(raw.content));
  }
  return false;
}

export function StructuredNodeEditor({ raw, onPatch }: StructuredNodeEditorProps) {
  if (raw.type === 'loop') {
    return <LoopEditor raw={raw} onPatch={onPatch} />;
  }
  if (raw.type === 'managed_flow') {
    return <ManagedFlowEditor raw={raw} onPatch={onPatch} />;
  }
  if (raw.type === 'sub_graph') {
    return <SubgraphEditor raw={raw} onPatch={onPatch} />;
  }
  if (raw.type === 'decision') {
    return <DecisionEditor raw={raw} onPatch={onPatch} />;
  }
  return null;
}
