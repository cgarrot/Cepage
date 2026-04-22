import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  GraphNode,
  GraphEdge,
  NodeType,
  EdgeRelation,
  EdgeDirection,
  Creator,
  NodeStatus,
} from '@cepage/shared-core';

export interface ExtractedSession {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: Record<string, unknown>;
  warnings: string[];
}

interface CursorToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | string;
}

interface CursorMessage {
  type?: string;
  content?: string;
  toolCalls?: CursorToolCall[];
}

@Injectable()
export class CursorExtractorService {
  private readonly logger = new Logger(CursorExtractorService.name);

  detectSchemaVersion(dbPath: string): number | 'unknown' {
    let db: { close(): void; prepare(sql: string): { get(): unknown } } | undefined;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      if (!db) return 'unknown';
      const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
      return row?.user_version ?? 'unknown';
    } catch (err) {
      this.logger.warn(`Failed to detect schema version: ${(err as Error).message}`);
      return 'unknown';
    } finally {
      db?.close();
    }
  }

  parse(dbPath: string): ExtractedSession {
    const warnings: string[] = [];
    let db:
      | {
          close(): void;
          prepare(sql: string): { all(): unknown; get(): unknown };
        }
      | undefined;

    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (err) {
      warnings.push(`Failed to open database: ${(err as Error).message}`);
      return { nodes: [], edges: [], metadata: {}, warnings };
    }

    try {
      if (!db) {
        return { nodes: [], edges: [], metadata: {}, warnings };
      }

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meta', 'blobs')`,
        )
        .all() as Array<{ name: string }>;

      const tableNames = new Set(tables.map((t) => t.name));
      if (!tableNames.has('blobs')) {
        warnings.push('Missing required table: blobs');
        return { nodes: [], edges: [], metadata: {}, warnings };
      }

      const version = this.detectSchemaVersion(dbPath);
      if (version === 'unknown') {
        warnings.push('Unknown schema version; proceeding with best-effort extraction');
      } else if (version !== 1) {
        warnings.push(`Schema version ${version} not explicitly supported; best-effort extraction`);
      }

      const metadata: Record<string, unknown> = {};
      if (tableNames.has('meta')) {
        const metaRows = db
          .prepare('SELECT key, value FROM meta')
          .all() as Array<{ key: string; value: Buffer }>;
        for (const row of metaRows) {
          try {
            metadata[row.key] = JSON.parse(row.value.toString());
          } catch {
            metadata[row.key] = row.value.toString();
          }
        }
      }

      const blobRows = db
        .prepare('SELECT id, data FROM blobs')
        .all() as Array<{ id: string; data: Buffer }>;

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const now = new Date().toISOString();
      const creator: Creator = { type: 'agent', agentType: 'cursor', agentId: 'cursor-extractor' };

      let previousNodeId: string | null = null;

      for (const row of blobRows) {
        let parsed: CursorMessage;
        try {
          parsed = JSON.parse(row.data.toString()) as CursorMessage;
        } catch (err) {
          warnings.push(`Failed to parse blob ${row.id}: ${(err as Error).message}`);
          continue;
        }

        const messageNodeId = this.makeId('msg', row.id);

        if (parsed.type === 'user') {
          const node = this.createNode(
            messageNodeId,
            'human_message',
            now,
            creator,
            { content: parsed.content ?? '', blobId: row.id },
          );
          nodes.push(node);
        } else if (parsed.type === 'assistant') {
          const node = this.createNode(
            messageNodeId,
            'agent_output',
            now,
            creator,
            { content: parsed.content ?? '', blobId: row.id },
          );
          nodes.push(node);

          if (parsed.toolCalls && Array.isArray(parsed.toolCalls)) {
            for (let i = 0; i < parsed.toolCalls.length; i++) {
              const tc = parsed.toolCalls[i];
              const toolNodeId = this.makeId('tool', `${row.id}-${i}`);

              let toolNodeType: NodeType;
              let toolContent: Record<string, unknown>;

              switch (tc.name) {
                case 'Shell':
                  toolNodeType = 'runtime_run';
                  toolContent = {
                    command: tc.input?.command,
                    ...(tc.input ?? {}),
                  };
                  break;
                case 'Write':
                  toolNodeType = 'file_diff';
                  toolContent = {
                    path: tc.input?.path,
                    content: tc.input?.content,
                    ...(tc.input ?? {}),
                  };
                  break;
                case 'Read':
                  toolNodeType = 'workspace_file';
                  toolContent = {
                    path: tc.input?.path,
                    ...(tc.input ?? {}),
                  };
                  break;
                default:
                  toolNodeType = 'agent_step';
                  toolContent = { toolName: tc.name, input: tc.input };
                  warnings.push(`Unknown tool type: ${tc.name}`);
              }

              const toolNode = this.createNode(
                toolNodeId,
                toolNodeType,
                now,
                creator,
                toolContent,
              );
              nodes.push(toolNode);

              edges.push(
                this.createEdge(
                  this.makeEdgeId('produces', messageNodeId, toolNodeId),
                  messageNodeId,
                  toolNodeId,
                  'produces',
                  creator,
                ),
              );
            }
          }
        } else {
          warnings.push(`Unknown message type: ${parsed.type}`);
          const node = this.createNode(
            messageNodeId,
            'agent_step',
            now,
            creator,
            { raw: parsed, blobId: row.id },
          );
          nodes.push(node);
        }

        if (previousNodeId) {
          edges.push(
            this.createEdge(
              this.makeEdgeId('responds_to', previousNodeId, messageNodeId),
              previousNodeId,
              messageNodeId,
              'responds_to',
              creator,
            ),
          );
        }

        previousNodeId = messageNodeId;
      }

      return { nodes, edges, metadata, warnings };
    } catch (err) {
      warnings.push(`Extraction error: ${(err as Error).message}`);
      return { nodes: [], edges: [], metadata: {}, warnings };
    } finally {
      db?.close();
    }
  }

  private makeId(prefix: string, id: string): string {
    return `${prefix}-${id}`;
  }

  private makeEdgeId(relation: string, source: string, target: string): string {
    return `edge-${relation}-${source}-${target}`;
  }

  private createNode(
    id: string,
    type: NodeType,
    createdAt: string,
    creator: Creator,
    content: Record<string, unknown>,
  ): GraphNode {
    return {
      id,
      type,
      createdAt,
      updatedAt: createdAt,
      content,
      creator,
      position: { x: 0, y: 0 },
      dimensions: { width: 0, height: 0 },
      metadata: {},
      status: 'active' as NodeStatus,
      branches: [],
    };
  }

  private createEdge(
    id: string,
    source: string,
    target: string,
    relation: EdgeRelation,
    creator: Creator,
  ): GraphEdge {
    return {
      id,
      source,
      target,
      relation,
      direction: 'source_to_target' as EdgeDirection,
      strength: 1,
      createdAt: new Date().toISOString(),
      creator,
      metadata: {},
    };
  }
}
