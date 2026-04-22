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

export type OpenCodeEvent =
  | MessageStartEvent
  | ContentBlockDeltaEvent
  | MessageStopEvent
  | ToolUseEvent
  | ToolResultEvent
  | FileEditEvent
  | CommandExecutionEvent
  | ErrorEvent;

export interface MessageStartEvent {
  type: 'message_start';
  role?: string;
  content?: string;
  messageId?: string;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  delta: string;
  blockType?: 'text' | 'reasoning' | 'tool_use';
  messageId?: string;
  partId?: string;
}

export interface MessageStopEvent {
  type: 'message_stop';
  messageId?: string;
  stopReason?: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  callId?: string;
  messageId?: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  callId?: string;
  output?: string;
  error?: string;
  isError?: boolean;
  messageId?: string;
}

export interface FileEditEvent {
  type: 'file_edit';
  path: string;
  operation: 'write' | 'patch' | 'delete';
  content?: string;
  patch?: string;
  callId?: string;
  messageId?: string;
}

export interface CommandExecutionEvent {
  type: 'command_execution';
  command: string;
  cwd?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  callId?: string;
  messageId?: string;
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
    stopReason?: string;
    error?: string;
  };
}

interface PendingTool {
  event: ToolUseEvent | FileEditEvent | CommandExecutionEvent;
  nodeId: string;
  result?: ToolResultEvent;
  retryOf?: string;
}

interface TextAccumulator {
  text: string;
  reasoning: string;
  messageId?: string;
}

const AGENT_CREATOR: Creator = {
  type: 'agent',
  agentType: 'opencode',
  agentId: 'opencode-extractor',
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
  const fileTools = ['file_write', 'write_file', 'file_edit', 'edit_file', 'patch_file', 'apply_patch'];
  return fileTools.includes(name);
}

function isFileEditEvent(event: OpenCodeEvent): event is FileEditEvent {
  return event.type === 'file_edit';
}

function isCommandEvent(event: OpenCodeEvent): event is CommandExecutionEvent {
  return event.type === 'command_execution';
}

function toolEventToNodeType(event: ToolUseEvent | FileEditEvent | CommandExecutionEvent): NodeType {
  if (isFileEditEvent(event)) return 'file_diff';
  if (isCommandEvent(event)) return 'runtime_run';
  if (isFileTool(event.name)) return 'file_diff';
  return 'runtime_run';
}

function toolEventToContent(
  event: ToolUseEvent | FileEditEvent | CommandExecutionEvent,
): Record<string, unknown> {
  if (isFileEditEvent(event)) {
    return {
      path: event.path,
      operation: event.operation,
      content: event.content,
      patch: event.patch,
      callId: event.callId,
    };
  }
  if (isCommandEvent(event)) {
    return {
      command: event.command,
      cwd: event.cwd,
      exitCode: event.exitCode,
      stdout: event.stdout,
      stderr: event.stderr,
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

@Injectable()
export class OpencodeExtractorService {
  parse(events: OpenCodeEvent[]): ExtractedSession {
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

    const textAcc: TextAccumulator = { text: '', reasoning: '' };
    let pendingTool: PendingTool | null = null;
    const completedToolNodeIds: string[] = [];
    let lastAgentNodeId: string | null = null;
    const retryReplacements = new Map<string, string>();

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

    const flushTextAccumulator = () => {
      if (!textAcc.text && !textAcc.reasoning) return;

      const nodeId = makeNodeId('out', nodeIndex++);
      const content: Record<string, unknown> = {
        text: textAcc.text,
      };
      if (textAcc.reasoning) {
        content.reasoning = textAcc.reasoning;
      }

      const node = createBaseNode(nodeId, 'agent_output', content);
      addNode(node, 'produces');
      lastAgentNodeId = nodeId;

      textAcc.text = '';
      textAcc.reasoning = '';
      textAcc.messageId = undefined;
    };

    for (const event of events) {
      switch (event.type) {
        case 'message_start': {
          flushPendingTool();
          flushTextAccumulator();
          textAcc.messageId = event.messageId;
          break;
        }

        case 'content_block_delta': {
          if (event.blockType === 'reasoning') {
            textAcc.reasoning += event.delta;
          } else {
            textAcc.text += event.delta;
          }
          break;
        }

        case 'tool_use': {
          flushPendingTool();
          flushTextAccumulator();

          let retryOf: string | undefined;
          for (let i = completedToolNodeIds.length - 1; i >= 0; i--) {
            const prevId = completedToolNodeIds[i];
            const prevNode = nodes.find((n) => n.id === prevId);
            if (!prevNode) continue;
            if (nodeHadError(prevNode) && this.matchesRetry(event, prevNode)) {
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

        case 'file_edit': {
          flushPendingTool();
          flushTextAccumulator();

          let retryOf: string | undefined;
          for (let i = completedToolNodeIds.length - 1; i >= 0; i--) {
            const prevId = completedToolNodeIds[i];
            const prevNode = nodes.find((n) => n.id === prevId);
            if (!prevNode) continue;
            if (
              nodeHadError(prevNode) &&
              prevNode.type === 'file_diff' &&
              prevNode.content.path === event.path
            ) {
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

        case 'command_execution': {
          flushPendingTool();
          flushTextAccumulator();

          let retryOf: string | undefined;
          for (let i = completedToolNodeIds.length - 1; i >= 0; i--) {
            const prevId = completedToolNodeIds[i];
            const prevNode = nodes.find((n) => n.id === prevId);
            if (!prevNode) continue;
            if (
              nodeHadError(prevNode) &&
              prevNode.type === 'runtime_run' &&
              prevNode.content.command === event.command
            ) {
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

        case 'message_stop': {
          flushPendingTool();
          flushTextAccumulator();
          if (event.stopReason && lastAgentNodeId) {
            const lastNode = nodes.find((n) => n.id === lastAgentNodeId);
            if (lastNode) {
              lastNode.content.stopReason = event.stopReason;
            }
          }
          break;
        }

        case 'error': {
          flushPendingTool();
          flushTextAccumulator();

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
    flushTextAccumulator();

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
      (n) => n.type === 'runtime_run' || n.type === 'file_diff',
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

  private matchesRetry(
    event: ToolUseEvent,
    prevNode: GraphNode,
  ): boolean {
    if (prevNode.type !== 'runtime_run' && prevNode.type !== 'file_diff')
      return false;
    return prevNode.content.toolName === event.name;
  }
}
