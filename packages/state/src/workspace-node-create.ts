import type { Node } from '@xyflow/react';
import type { GraphNode } from '@cepage/shared-core';

export function buildCreateNodeContent(type: GraphNode['type'], text: string = ''): GraphNode['content'] {
  if (type === 'human_message' || type === 'note') {
    return { text, format: 'markdown' };
  }

  if (type === 'input') {
    return {
      mode: 'template',
      label: 'Input',
      accepts: ['text', 'image', 'file'],
      multiple: true,
      required: false,
      instructions: text,
    };
  }

  if (type === 'agent_step') {
    return {
      agentType: 'opencode',
      role: 'builder',
      label: 'Agent step',
    };
  }

  if (type === 'loop') {
    return {
      mode: 'for_each',
      source: {
        kind: 'inline_list',
        items: ['item-1', 'item-2'],
      },
      bodyNodeId: 'replace-body-node-id',
      advancePolicy: 'only_on_pass',
      sessionPolicy: {
        withinItem: 'reuse_execution',
        betweenItems: 'new_execution',
      },
      blockedPolicy: 'pause_controller',
      itemLabel: '{{item.label}}',
    };
  }

  if (type === 'managed_flow') {
    return {
      title: 'Managed flow',
      syncMode: 'managed',
      entryPhaseId: 'phase-1',
      phases: [
        {
          id: 'phase-1',
          kind: 'loop_phase',
          nodeId: 'replace-loop-node-id',
          title: 'Dev loop',
        },
      ],
    };
  }

  if (type === 'sub_graph') {
    return {
      workflowRef: {
        kind: 'session',
        sessionId: 'replace-session-id',
      },
      inputMap: {},
      execution: {
        newExecution: true,
      },
      expectedOutputs: [],
    };
  }

  if (type === 'decision') {
    return {
      mode: 'workspace_validator',
      requirements: ['Describe what must be true before the loop advances.'],
      checks: [],
      passAction: 'pass',
      failAction: 'retry_same_item',
      blockAction: 'block',
    };
  }

  if (type === 'workspace_file') {
    return {
      title: 'Workspace file',
      relativePath: 'notes.md',
      pathMode: 'static',
      role: 'output',
      origin: 'derived',
      kind: 'text',
      transferMode: 'reference',
      status: 'declared',
    };
  }

  if (type === 'file_summary') {
    return { files: [], status: 'empty' };
  }

  if (type === 'workflow_copilot') {
    return {
      title: 'Workflow copilot',
      text,
      scope: { kind: 'node' },
      autoApply: true,
      autoRun: true,
    };
  }

  if (!text) {
    return {};
  }

  return { text };
}

export function getDefaultCreatePosition(
  nodes: ReadonlyArray<Pick<Node, 'position'>>,
): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 120, y: 120 };
  }

  const anchor = nodes.reduce((best, node) => {
    if (node.position.y > best.position.y) {
      return node;
    }
    return best;
  });

  return {
    x: anchor.position.x + 40,
    y: anchor.position.y + 140,
  };
}
