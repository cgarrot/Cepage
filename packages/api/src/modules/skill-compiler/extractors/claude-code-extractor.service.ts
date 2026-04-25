import { Injectable } from '@nestjs/common';
import type {
  GraphNode,
  GraphEdge,
  NodeType,
  EdgeRelation,
  EdgeDirection,
  NodeStatus,
  Creator,
} from '@cepage/shared-core';

export type ClaudeCodeEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent;

export interface UserMessageEvent {
  type: 'user';
  content: string;
}

export interface AssistantMessageEvent {
  type: 'assistant';
  content?: string;
  thinking?: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  callId?: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  callId?: string;
  output?: string;
  error?: string;
  isError?: boolean;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

export interface ExtractedSession {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    eventCount: number;
    nodeCount: number;
    edgeCount: number;
    collapsedRetries: number;
    error?: string;
  };
}

interface PendingTool {
  event: ToolUseEvent;
  nodeId: string;
  result?: ToolResultEvent;
  retryOf?: string;
}

const AGENT_CREATOR: Creator = {
  type: 'agent',
  agentType: 'claude-code',
  agentId: 'claude-code-extractor',
};

function makeNodeId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

function makeEdgeId(index: number): string {
  return `edge-${String(index).padStart(4, '0')}`;
}

function now(): string {
  return new Date().toISOString();
}

function createBaseNode(
  id: string,
  nodeType: NodeType,
  content: Record<string, unknown>,
): GraphNode {
  return {
    id,
    type: nodeType,
    createdAt: now(),
    updatedAt: now(),
    content,
    creator: AGENT_CREATOR,
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 100 },
    metadata: {},
    status: 'active' as NodeStatus,
    branches: [],
  };
}

function createEdge(
  id: string,
  source: string,
  target: string,
  relation: EdgeRelation,
  direction: EdgeDirection = 'source_to_target',
): GraphEdge {
  return {
    id,
    source,
    target,
    relation,
    direction,
    strength: 1,
    createdAt: now(),
    creator: AGENT_CREATOR,
    metadata: {},
  };
}

function isFileTool(name: string): boolean {
  const fileTools = ['Write', 'Edit', 'MultiEdit', 'apply_patch'];
  return fileTools.includes(name);
}

function isReadTool(name: string): boolean {
  return name === 'Read';
}

function isCommandTool(name: string): boolean {
  return name === 'Bash';
}

function toolEventToNodeType(event: ToolUseEvent): NodeType {
  if (isFileTool(event.name)) return 'file_diff';
  if (isReadTool(event.name)) return 'workspace_file';
  return 'runtime_run';
}

function toolEventToContent(event: ToolUseEvent): Record<string, unknown> {
  if (isCommandTool(event.name)) {
    return {
      command: event.input.command,
      cwd: event.input.cwd,
      timeout: event.input.timeout,
      toolName: event.name,
      input: event.input,
      callId: event.callId,
    };
  }
  if (isFileTool(event.name)) {
    return {
      path: event.input.path ?? event.input.file_path,
      content: event.input.content,
      old_string: event.input.old_string,
      new_string: event.input.new_string,
      toolName: event.name,
      input: event.input,
      callId: event.callId,
    };
  }
  if (isReadTool(event.name)) {
    return {
      path: event.input.path ?? event.input.file_path,
      offset: event.input.offset,
      limit: event.input.limit,
      toolName: event.name,
      input: event.input,
      callId: event.callId,
    };
  }
  return {
    toolName: event.name,
    input: event.input,
    callId: event.callId,
  };
}

function nodeHadError(node: GraphNode): boolean {
  if (node.content.error || node.content.isError) return true;
  if (node.type === 'runtime_run' && typeof node.content.exitCode === 'number' && node.content.exitCode !== 0)
    return true;
  if (node.type === 'runtime_run' && node.content.stderr) return true;
  return false;
}

function matchesRetry(event: ToolUseEvent, prevNode: GraphNode): boolean {
  if (prevNode.type !== 'runtime_run' && prevNode.type !== 'file_diff' && prevNode.type !== 'workspace_file')
    return false;
  return prevNode.content.toolName === event.name;
}

@Injectable()
export class ClaudeCodeExtractorService {
  parse(events: ClaudeCodeEvent[]): ExtractedSession {
    if (!events || events.length === 0) {
      return {
        nodes: [],
        edges: [],
        metadata: {
          eventCount: 0,
          nodeCount: 0,
          edgeCount: 0,
          collapsedRetries: 0,
        },
      };
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let nodeIndex = 0;
    let edgeIndex = 0;
    let collapsedRetries = 0;

    let pendingTool: PendingTool | null = null;
    const completedToolNodeIds: string[] = [];
    let lastAgentNodeId: string | null = null;
    const retryReplacements = new Map<string, string>();

    let assistantText = '';
    let assistantThinking = '';

    const addNode = (node: GraphNode, relation?: EdgeRelation) => {
      nodes.push(node);
      if (lastAgentNodeId && relation) {
        edges.push(
          createEdge(makeEdgeId(edgeIndex++), lastAgentNodeId, node.id, relation),
        );
      }
      return node;
    };

    const flushPendingTool = () => {
      if (!pendingTool) return;

      const nodeType = toolEventToNodeType(pendingTool.event);
      const content = toolEventToContent(pendingTool.event);

      if (pendingTool.result) {
        content.output = pendingTool.result.output;
        content.error = pendingTool.result.error;
        content.isError = pendingTool.result.isError;
        if (isCommandTool(pendingTool.event.name) && pendingTool.result.isError) {
          content.exitCode = 1;
          content.stderr = pendingTool.result.error;
        }
      }

      if (pendingTool.retryOf) {
        const failedNodeId = pendingTool.retryOf;
        const replacementId = makeNodeId('tool', nodeIndex++);
        retryReplacements.set(failedNodeId, replacementId);

        for (const edge of edges) {
          if (edge.target === failedNodeId) {
            edge.target = replacementId;
          }
          if (edge.source === failedNodeId) {
            edge.source = replacementId;
          }
        }

        const failedIdx = nodes.findIndex((n) => n.id === failedNodeId);
        if (failedIdx !== -1) {
          nodes.splice(failedIdx, 1);
        }

        const replacementNode = createBaseNode(replacementId, nodeType, content);
        replacementNode.metadata = {
          ...replacementNode.metadata,
          isRetry: true,
          originalNodeId: failedNodeId,
        };
        nodes.push(replacementNode);

        if (lastAgentNodeId) {
          edges.push(
            createEdge(
              makeEdgeId(edgeIndex++),
              lastAgentNodeId,
              replacementId,
              nodeType === 'file_diff' ? 'revises' : 'produces',
            ),
          );
        }

        completedToolNodeIds.push(replacementId);
        pendingTool = null;
        collapsedRetries++;
        return;
      }

      const nodeId = makeNodeId('tool', nodeIndex++);
      const node = createBaseNode(nodeId, nodeType, content);
      addNode(
        node,
        nodeType === 'file_diff' ? 'revises' : 'produces',
      );
      completedToolNodeIds.push(nodeId);
      pendingTool = null;
    };

    const flushAssistantAccumulator = () => {
      if (!assistantText && !assistantThinking) return;

      const nodeId = makeNodeId('out', nodeIndex++);
      const content: Record<string, unknown> = {
        text: assistantText,
      };
      if (assistantThinking) {
        content.reasoning = assistantThinking;
      }

      const node = createBaseNode(nodeId, 'agent_output', content);
      addNode(node, 'produces');
      lastAgentNodeId = nodeId;

      assistantText = '';
      assistantThinking = '';
    };

    for (const event of events) {
      switch (event.type) {
        case 'user': {
          flushPendingTool();
          flushAssistantAccumulator();

          const nodeId = makeNodeId('msg', nodeIndex++);
          const node = createBaseNode(nodeId, 'human_message', {
            text: event.content,
          });
          nodes.push(node);
          break;
        }

        case 'assistant': {
          flushPendingTool();

          if (event.content) {
            assistantText += event.content;
          }
          if (event.thinking) {
            assistantThinking += event.thinking;
          }
          break;
        }

        case 'tool_use': {
          flushPendingTool();
          flushAssistantAccumulator();

          let retryOf: string | undefined;
          for (let i = completedToolNodeIds.length - 1; i >= 0; i--) {
            const prevId = completedToolNodeIds[i];
            const prevNode = nodes.find((n) => n.id === prevId);
            if (!prevNode) continue;
            if (nodeHadError(prevNode) && matchesRetry(event, prevNode)) {
              retryOf = prevId;
              break;
            }
          }

          pendingTool = {
            event,
            nodeId: makeNodeId('tool', nodeIndex++),
            retryOf,
          };
          break;
        }

        case 'tool_result': {
          if (pendingTool) {
            pendingTool.result = event;
          }
          break;
        }

        case 'error': {
          flushPendingTool();
          flushAssistantAccumulator();

          const nodeId = makeNodeId('out', nodeIndex++);
          const node = createBaseNode(nodeId, 'agent_output', {
            text: '',
            error: event.message,
            code: event.code,
          });
          node.status = 'error';
          addNode(node, 'produces');
          lastAgentNodeId = nodeId;
          break;
        }

        default:
          break;
      }
    }

    flushPendingTool();
    flushAssistantAccumulator();

    this.injectAgentSteps(nodes, edges);

    let ei = 0;
    for (const edge of edges) {
      edge.id = makeEdgeId(ei++);
    }

    return {
      nodes,
      edges,
      metadata: {
        eventCount: events.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        collapsedRetries,
      },
    };
  }

  private injectAgentSteps(nodes: GraphNode[], edges: GraphEdge[]) {
    const outputNodes = nodes.filter((n) => n.type === 'agent_output');
    const toolNodes = nodes.filter(
      (n) => n.type === 'runtime_run' || n.type === 'file_diff' || n.type === 'workspace_file',
    );

    if (outputNodes.length === 0 && toolNodes.length === 0) return;

    if (outputNodes.length === 0 && toolNodes.length > 0) {
      const stepId = makeNodeId('step', 0);
      const stepNode = createBaseNode(stepId, 'agent_step', {
        summary: 'Autonomous tool execution',
      });
      nodes.unshift(stepNode);
      for (const tn of toolNodes) {
        edges.push(createEdge(makeEdgeId(edges.length), stepId, tn.id, 'spawns'));
      }
      return;
    }

    let stepIndex = 0;
    for (let i = 0; i < outputNodes.length; i++) {
      const outNode = outputNodes[i];
      const prevOut = i > 0 ? outputNodes[i - 1] : null;

      const toolsBetween = toolNodes.filter((tn) => {
        const toolIdx = nodes.indexOf(tn);
        const outIdx = nodes.indexOf(outNode);
        const prevIdx = prevOut ? nodes.indexOf(prevOut) : -1;
        return toolIdx > prevIdx && toolIdx < outIdx;
      });

      if (toolsBetween.length > 0 || i === 0) {
        const stepId = makeNodeId('step', stepIndex++);
        const reasoning = outNode.content.reasoning as string | undefined;
        const stepNode = createBaseNode(stepId, 'agent_step', {
          summary: reasoning
            ? 'Reasoning + action'
            : toolsBetween.length > 0
              ? 'Tool execution step'
              : 'Agent response',
          reasoning,
        });

        const outIdx = nodes.indexOf(outNode);
        nodes.splice(outIdx, 0, stepNode);

        for (const tn of toolsBetween) {
          edges.push(
            createEdge(makeEdgeId(edges.length), stepId, tn.id, 'spawns'),
          );
        }

        edges.push(
          createEdge(makeEdgeId(edges.length), stepId, outNode.id, 'feeds_into'),
        );

        for (const edge of edges) {
          if (
            edge.target === outNode.id &&
            (edge.source.startsWith('tool-') || edge.relation === 'produces')
          ) {
            edge.target = stepId;
          }
        }

        if (prevOut) {
          edges.push(
            createEdge(
              makeEdgeId(edges.length),
              prevOut.id,
              stepId,
              'feeds_into',
            ),
          );
        }
      }
    }
  }
}
