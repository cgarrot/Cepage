import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import { getEnv } from '@cepage/config';
import {
  FILE_SUMMARY_LEGACY_ID,
  applyNodeAgentSelection,
  readFileSummaryContent,
  readNodeLockedSelection,
  type AgentModelRef,
  type AgentType,
  type FileSummaryContent,
  type FileSummaryItem,
  type FileSummaryStorage,
  type GraphNode,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace, resolveSessionWorkspace } from '../../common/utils/session-workspace.util';
import { ActivityService } from '../activity/activity.service';
import { GraphService } from './graph.service';
import {
  buildCombinedFileSummaryPrompt,
  buildFileSummaryPrompt,
  extractFileUpload,
} from './file-node.util';

const HUMAN = { type: 'human' as const, userId: 'local-user' };

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type SummarySelection = {
  type?: AgentType;
  model?: AgentModelRef;
};

type ResolvedSelection = {
  type: AgentType;
  model?: AgentModelRef;
};

type LoadedNode = {
  session: {
    id: string;
    workspaceParentDirectory: string | null;
    workspaceDirectoryName: string | null;
  };
  node: GraphNode;
  content: FileSummaryContent | null;
};

type StoredFile = NonNullable<FileSummaryItem['storage']>;

/**
 * `@cepage/agent-core` is ESM-only. Keep the runtime import dynamic here too.
 */
async function importAgentCore(): Promise<typeof import('@cepage/agent-core')> {
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof import('@cepage/agent-core')>;
  return runtimeImport('@cepage/agent-core');
}

@Injectable()
export class FileNodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  private legacyRoot(): string {
    return path.resolve(process.cwd(), '..', '..', '.cepage-data', 'file-nodes');
  }

  private homeRoot(): string {
    return path.join(os.homedir(), '.cepage-data', 'file-nodes');
  }

  private legacyDir(sessionId: string, nodeId: string): string {
    return path.join(this.legacyRoot(), sessionId, nodeId);
  }

  private legacyFilesDir(sessionId: string, nodeId: string): string {
    return path.join(this.legacyDir(sessionId, nodeId), 'files');
  }

  private legacyFilePath(sessionId: string, nodeId: string, item: FileSummaryItem): string {
    return path.join(this.legacyFilesDir(sessionId, nodeId), `${item.id}${item.file.extension ?? ''}`);
  }

  private legacyAssetPath(sessionId: string, nodeId: string, item: FileSummaryItem): string {
    return path.join(this.legacyDir(sessionId, nodeId), `asset${item.file.extension ?? ''}`);
  }

  private workspace(session: LoadedNode['session']) {
    return readSessionWorkspace(process.cwd(), session);
  }

  private storageRelativePath(sessionId: string, nodeId: string, item: Pick<FileSummaryItem, 'id' | 'file'>): string {
    return path.posix.join(sessionId, nodeId, 'files', `${item.id}${item.file.extension ?? ''}`);
  }

  private workspaceStorageRelativePath(
    sessionId: string,
    nodeId: string,
    item: Pick<FileSummaryItem, 'id' | 'file'>,
  ): string {
    return path.posix.join('.cepage', 'file-nodes', this.storageRelativePath(sessionId, nodeId, item));
  }

  // Persist the original storage target so later workspace changes do not orphan old uploads.
  private storage(
    session: LoadedNode['session'],
    sessionId: string,
    nodeId: string,
    item: Pick<FileSummaryItem, 'id' | 'file'>,
  ): StoredFile {
    const workspace = this.workspace(session);
    if (workspace) {
      return {
        kind: 'workspace',
        relativePath: this.workspaceStorageRelativePath(sessionId, nodeId, item),
        parentDirectory: workspace.parentDirectory,
        directoryName: workspace.directoryName,
      };
    }
    return {
      kind: 'home',
      relativePath: this.storageRelativePath(sessionId, nodeId, item),
    };
  }

  private storageRoot(storage: StoredFile): string {
    if (storage.kind === 'home') {
      return this.homeRoot();
    }
    return resolveSessionWorkspace(
      process.cwd(),
      storage.parentDirectory,
      storage.directoryName,
    ).workingDirectory;
  }

  private storagePath(storage: StoredFile): string {
    return path.resolve(this.storageRoot(storage), storage.relativePath);
  }

  private readPaths(
    sessionId: string,
    nodeId: string,
    item: FileSummaryItem,
    fileCount: number,
  ): string[] {
    const paths = item.storage ? [this.storagePath(item.storage)] : [];
    paths.push(this.legacyFilePath(sessionId, nodeId, item));
    if (item.id === FILE_SUMMARY_LEGACY_ID || fileCount === 1) {
      paths.push(this.legacyAssetPath(sessionId, nodeId, item));
    }
    return [...new Set(paths)];
  }

  private cloneItem(item: FileSummaryItem): FileSummaryItem {
    return {
      ...item,
      file: { ...item.file },
      ...(item.storage ? { storage: { ...item.storage } as FileSummaryStorage } : {}),
    };
  }

  private cloneContent(content: FileSummaryContent | null): FileSummaryContent {
    if (!content) return { files: [], status: 'empty' };
    return {
      ...(content.files ? { files: content.files.map((item) => this.cloneItem(item)) } : { files: [] }),
      ...(content.agentType ? { agentType: content.agentType } : {}),
      ...(content.model ? { model: { ...content.model } } : {}),
      ...(content.agentSelection ? { agentSelection: content.agentSelection } : {}),
      ...(content.summary !== undefined ? { summary: content.summary } : {}),
      ...(content.summaryUpdatedAt ? { summaryUpdatedAt: content.summaryUpdatedAt } : {}),
      ...(content.generatedSummary !== undefined ? { generatedSummary: content.generatedSummary } : {}),
      ...(content.generatedSummaryUpdatedAt
        ? { generatedSummaryUpdatedAt: content.generatedSummaryUpdatedAt }
        : {}),
      ...(content.summarySource ? { summarySource: content.summarySource } : {}),
      ...(content.status ? { status: content.status } : {}),
      ...(content.error ? { error: content.error } : {}),
    };
  }

  private async loadNode(sessionId: string, nodeId: string): Promise<LoadedNode> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        workspaceParentDirectory: true,
        workspaceDirectoryName: true,
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const snap = await this.graph.loadSnapshot(sessionId);
    const node = snap.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      throw new NotFoundException('FILE_NODE_NOT_FOUND');
    }
    if (node.type !== 'file_summary') {
      throw new BadRequestException('FILE_NODE_INVALID_TYPE');
    }
    return {
      session,
      node,
      content: readFileSummaryContent(node.content),
    };
  }

  private cwd(session: LoadedNode['session']): string {
    const workspace = this.workspace(session);
    if (workspace?.workingDirectory) {
      return workspace.workingDirectory;
    }
    return path.resolve(process.cwd(), getEnv().AGENT_WORKING_DIRECTORY);
  }

  private nodeStatus(content: FileSummaryContent): GraphNode['status'] {
    return this.computeStatus(content) === 'error' ? 'error' : 'active';
  }

  private computeStatus(content: FileSummaryContent): FileSummaryContent['status'] {
    const files = content.files ?? [];
    if (files.length === 0) return 'empty';
    if (files.some((item) => item.status === 'summarizing')) return 'summarizing';
    if (files.some((item) => item.status === 'pending' || item.status === 'ready')) return 'pending';
    if (files.some((item) => item.status === 'done')) return 'done';
    if (files.some((item) => item.status === 'error')) return 'error';
    return content.summary || content.generatedSummary ? 'done' : 'ready';
  }

  private contentWithSelection(
    content: FileSummaryContent | null,
    selection?: SummarySelection,
  ): FileSummaryContent {
    const next = this.cloneContent(content);
    if (!selection) return next;
    return applyNodeAgentSelection('file_summary', next as GraphNode['content'], {
      mode: 'locked',
      selection: {
        type: selection.type ?? 'opencode',
        ...(selection.model ? { model: selection.model } : {}),
      },
    }) as FileSummaryContent;
  }

  private resolveSelection(
    content: FileSummaryContent | null,
    selection?: SummarySelection,
  ): ResolvedSelection {
    const node = selection ?? readNodeLockedSelection(content);
    const type = node?.type ?? (content?.agentType as AgentType | undefined);
    if (!type) {
      throw new BadRequestException('FILE_NODE_SELECTION_REQUIRED');
    }
    const model = node?.model ?? content?.model;
    return {
      type,
      ...(model ? { model } : {}),
    };
  }

  private async patchNode(
    sessionId: string,
    nodeId: string,
    content: FileSummaryContent,
  ) {
    const env = await this.graph.patchNode(
      sessionId,
      nodeId,
      {
        content: {
          ...content,
          status: this.computeStatus(content),
        } as GraphNode['content'],
        status: this.nodeStatus(content),
      },
      HUMAN,
    );
    if (env.payload.type !== 'node_updated') {
      throw new Error('unexpected file node patch');
    }
    return {
      eventId: env.eventId,
      patch: env.payload.patch,
    };
  }

  private async log(
    sessionId: string,
    eventId: number,
    nodeId: string,
    summary: string,
    summaryKey?: string,
    summaryParams?: Record<string, string>,
  ): Promise<void> {
    await this.activity.log({
      sessionId,
      eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary,
      summaryKey,
      summaryParams,
      relatedNodeIds: [nodeId],
    });
  }

  private uploadedItem(
    session: LoadedNode['session'],
    sessionId: string,
    nodeId: string,
    file: UploadFile,
    status: FileSummaryItem['status'],
  ): FileSummaryItem {
    const next = extractFileUpload({
      name: file.originalname || 'upload.bin',
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      buffer: file.buffer,
    });
    const item: FileSummaryItem = {
      id: randomUUID(),
      file: next.file,
      ...(next.extractedText !== undefined ? { extractedText: next.extractedText } : {}),
      ...(next.extractedTextChars != null ? { extractedTextChars: next.extractedTextChars } : {}),
      ...(next.extractedTextTruncated != null
        ? { extractedTextTruncated: next.extractedTextTruncated }
        : {}),
      ...(status ? { status } : {}),
    };
    return {
      ...item,
      storage: this.storage(session, sessionId, nodeId, item),
    };
  }

  private shouldSummarize(item: FileSummaryItem, targets?: Set<string>): boolean {
    if (targets && !targets.has(item.id)) return false;
    if (!item.summary?.trim()) return true;
    return item.status === 'pending' || item.status === 'ready' || item.status === 'error';
  }

  private async writeAsset(
    item: FileSummaryItem,
    buffer: Buffer,
  ): Promise<void> {
    if (!item.storage) {
      throw new Error('FILE_NODE_STORAGE_MISSING');
    }
    const filePath = this.storagePath(item.storage);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  private async runSummary(
    workingDirectory: string,
    selection: ResolvedSelection,
    promptText: string,
  ): Promise<string> {
    const { getAgentAdapter, runAgentStream } = await importAgentCore();
    if (!getAgentAdapter(selection.type)) {
      throw new NotFoundException('AGENT_ADAPTER_UNAVAILABLE');
    }
    const stream = runAgentStream({
      sessionId: `file-summary-${Date.now()}`,
      type: selection.type,
      runtime: { kind: 'local_process', cwd: workingDirectory },
      role: 'summarizer',
      model: selection.model,
      workingDirectory,
      promptText,
      wakeReason: 'manual',
      seedNodeIds: [],
      connection: { port: getEnv().OPENCODE_PORT, hostname: getEnv().OPENCODE_HOST },
    });
    let text = '';
    let snapshot = '';
    for await (const ev of stream) {
      if (ev.type === 'stdout') {
        text += ev.chunk;
      }
      if (ev.type === 'snapshot') {
        snapshot = ev.output;
      }
      if (ev.type === 'error') {
        throw new Error(ev.message);
      }
    }
    const summary = (snapshot || text).trim();
    if (!summary) {
      throw new Error('No summary output was produced.');
    }
    return summary;
  }

  private prepareSummaryPass(
    content: FileSummaryContent,
    targets?: Set<string>,
  ): FileSummaryContent {
    const next = this.cloneContent(content);
    next.files = (next.files ?? []).map((item) =>
      this.shouldSummarize(item, targets)
        ? {
            ...this.cloneItem(item),
            status: 'summarizing',
            error: undefined,
          }
        : this.cloneItem(item),
    );
    next.error = undefined;
    next.status = this.computeStatus(next);
    return next;
  }

  private async summarizeContent(
    session: LoadedNode['session'],
    content: FileSummaryContent,
    selection: ResolvedSelection,
    targets?: Set<string>,
  ): Promise<FileSummaryContent> {
    const workingDirectory = this.cwd(session);
    await fs.mkdir(workingDirectory, { recursive: true });
    const next = this.cloneContent(content);
    next.files = [];
    for (const item of content.files ?? []) {
      if (!this.shouldSummarize(item, targets)) {
        next.files.push(this.cloneItem(item));
        continue;
      }
      try {
        const summary = await this.runSummary(workingDirectory, selection, buildFileSummaryPrompt(item));
        next.files.push({
          ...this.cloneItem(item),
          summary,
          summaryUpdatedAt: new Date().toISOString(),
          status: 'done',
          error: undefined,
        });
      } catch (errorValue) {
        next.files.push({
          ...this.cloneItem(item),
          status: 'error',
          error: errorValue instanceof Error ? errorValue.message : String(errorValue),
        });
      }
    }

    const prompt = buildCombinedFileSummaryPrompt(next);
    if (prompt) {
      try {
        const summary = await this.runSummary(workingDirectory, selection, prompt);
        const stamp = new Date().toISOString();
        next.generatedSummary = summary;
        next.generatedSummaryUpdatedAt = stamp;
        if (next.summarySource !== 'user' || next.summary === undefined) {
          next.summary = summary;
          next.summaryUpdatedAt = stamp;
          next.summarySource = 'generated';
        }
        next.error = undefined;
      } catch (errorValue) {
        next.error = errorValue instanceof Error ? errorValue.message : String(errorValue);
      }
    }

    next.status = this.computeStatus(next);
    return next;
  }

  async upload(sessionId: string, nodeId: string, files: UploadFile[] = []) {
    const valid = files.filter((file) => file?.buffer);
    if (valid.length === 0) {
      throw new BadRequestException('FILE_NODE_FILE_REQUIRED');
    }
    const loaded = await this.loadNode(sessionId, nodeId);
    const base = this.contentWithSelection(loaded.content);
    const auto = Boolean(base.agentType);
    const items = valid.map((file) =>
      this.uploadedItem(loaded.session, sessionId, nodeId, file, auto ? 'summarizing' : 'pending'),
    );
    for (let i = 0; i < valid.length; i += 1) {
      await this.writeAsset(items[i], valid[i].buffer);
    }
    const content: FileSummaryContent = {
      ...base,
      files: [...(base.files ?? []), ...items],
      status: auto ? 'summarizing' : 'pending',
      error: undefined,
    };
    await this.patchNode(sessionId, nodeId, content);
    const next = auto
      ? await this.summarizeContent(
          loaded.session,
          content,
          this.resolveSelection(content),
          new Set(
            content.files
              ?.filter((item) => !item.summary?.trim() || item.status === 'pending')
              .map((item) => item.id) ?? [],
          ),
        )
      : {
          ...content,
          status: this.computeStatus(content),
        };
    const env = await this.patchNode(sessionId, nodeId, next);
    const summary =
      valid.length === 1 ? `Uploaded ${items[0].file.name}` : `Uploaded ${valid.length} files`;
    await this.log(sessionId, env.eventId, nodeId, summary);
    return { nodeId, patch: env.patch, eventId: env.eventId };
  }

  async summarize(sessionId: string, nodeId: string, selection?: SummarySelection) {
    const loaded = await this.loadNode(sessionId, nodeId);
    const files = loaded.content?.files ?? [];
    if (files.length === 0) {
      throw new BadRequestException('FILE_NODE_EMPTY');
    }
    const nextSelection = this.resolveSelection(loaded.content, selection);
    const base = this.contentWithSelection(loaded.content, nextSelection);
    const targets = new Set(
      files
        .filter(
          (item) =>
            !item.summary?.trim() ||
            item.status === 'pending' ||
            item.status === 'ready' ||
            item.status === 'error',
        )
        .map((item) => item.id),
    );
    const running = this.prepareSummaryPass(base, targets.size > 0 ? targets : undefined);
    await this.patchNode(sessionId, nodeId, running);
    const next = await this.summarizeContent(
      loaded.session,
      running,
      nextSelection,
      targets.size > 0 ? targets : undefined,
    );
    const env = await this.patchNode(sessionId, nodeId, next);
    await this.log(sessionId, env.eventId, nodeId, 'Updated file summaries');
    return {
      nodeId,
      patch: env.patch,
      eventId: env.eventId,
    };
  }

  async readAsset(sessionId: string, nodeId: string, fileId?: string) {
    const loaded = await this.loadNode(sessionId, nodeId);
    const files = loaded.content?.files ?? [];
    if (files.length === 0) {
      throw new NotFoundException('FILE_NODE_ASSET_NOT_FOUND');
    }
    const item =
      (fileId ? files.find((entry) => entry.id === fileId) : undefined) ??
      files[0];
    if (!item) {
      throw new NotFoundException('FILE_NODE_ASSET_NOT_FOUND');
    }
    for (const filePath of this.readPaths(sessionId, nodeId, item, files.length)) {
      try {
        const data = await fs.readFile(filePath);
        return {
          data,
          file: item.file,
        };
      } catch {
        continue;
      }
    }
    throw new NotFoundException('FILE_NODE_ASSET_NOT_FOUND');
  }
}
