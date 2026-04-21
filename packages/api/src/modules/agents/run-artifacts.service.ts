import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  readRunArtifactsBundle,
  readWorkflowArtifactContent,
  resolveWorkflowArtifactRelativePath,
  type GraphNode,
  type RunArtifactFileSnapshot,
  type RunArtifactsBundle,
  type WebPreviewInfo,
  type WorkflowArtifactContent,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { GraphService } from '../graph/graph.service';
import { detectPreviewLaunchSpec } from './preview-detect.util';
import {
  buildRunArtifactsBundle,
  captureWorkspaceState,
  createInitialRunArtifactsBundle,
  readWorkspaceFileSnapshot,
  resolveWorkspaceFilePath,
} from './run-artifacts.util';

type RunRow = {
  id: string;
  sessionId: string;
  providerMetadata: unknown;
};

function trimText(value: string | undefined, limit: number): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  return next.length > limit ? `${next.slice(0, limit)}…` : next;
}

function claimRef(runId: string, relativePath: string): string {
  return `artifact://run/${runId}/${encodeURIComponent(relativePath)}`;
}

@Injectable()
export class RunArtifactsService {
  private readonly baselineByRun = new Map<string, Awaited<ReturnType<typeof captureWorkspaceState>>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  async captureRunStart(runId: string, cwd: string): Promise<void> {
    this.baselineByRun.set(runId, await captureWorkspaceState(cwd));
  }

  async initializeRunArtifacts(
    sessionId: string,
    executionId: string | undefined,
    runId: string,
    ownerNodeId: string,
    cwd: string,
  ): Promise<RunArtifactsBundle> {
    const bundle = this.decorateBundle(
      sessionId,
      runId,
      createInitialRunArtifactsBundle({ runId, executionId, ownerNodeId, cwd }),
    );
    await this.persistBundle(sessionId, runId, bundle);
    await this.syncNodeSummary(sessionId, bundle);
    return bundle;
  }

  async finalizeRun(
    sessionId: string,
    executionId: string | undefined,
    runId: string,
    ownerNodeId: string,
    cwd: string,
  ): Promise<RunArtifactsBundle> {
    const before = this.baselineByRun.get(runId) ?? new Map();
    this.baselineByRun.delete(runId);
    const after = await captureWorkspaceState(cwd);
    const preview = (await detectPreviewLaunchSpec(cwd)).preview;
    const bundle = this.decorateBundle(
      sessionId,
      runId,
      buildRunArtifactsBundle({
        runId,
        executionId,
        ownerNodeId,
        cwd,
        before,
        after,
        preview,
      }),
    );
    await this.persistBundle(sessionId, runId, bundle);
    await this.syncNodeSummary(sessionId, bundle);
    await this.syncWorkspaceFileNodes(sessionId, bundle);
    return bundle;
  }

  async getRunArtifacts(sessionId: string, runId: string): Promise<RunArtifactsBundle> {
    const run = await this.getRunRow(sessionId, runId);
    const bundle = readRunArtifactsBundle(run.providerMetadata);
    if (!bundle) {
      throw new NotFoundException('RUN_ARTIFACTS_NOT_FOUND');
    }
    return this.decorateBundle(sessionId, runId, bundle);
  }

  async readArtifactFile(
    sessionId: string,
    runId: string,
    requestedPath: string,
  ): Promise<{
    path: string;
    change: RunArtifactsBundle['files'][number] | null;
    current: RunArtifactFileSnapshot;
  }> {
    const bundle = await this.getRunArtifacts(sessionId, runId);
    const change = bundle.files.find((entry: RunArtifactsBundle['files'][number]) => entry.path === requestedPath) ?? null;
    if (change?.kind === 'deleted') {
      return {
        path: requestedPath,
        change,
        current: {
          kind: 'missing',
          size: 0,
        },
      };
    }
    const { absolutePath, relativePath } = this.safeResolvePath(bundle.summary.cwd, requestedPath);
    try {
      return {
        path: relativePath,
        change,
        current: await readWorkspaceFileSnapshot(absolutePath),
      };
    } catch (errorValue) {
      if ((errorValue as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw errorValue;
      }
      return {
        path: relativePath,
        change,
        current: {
          kind: 'missing',
          size: 0,
        },
      };
    }
  }

  async updatePreviewInfo(
    sessionId: string,
    runId: string,
    preview: WebPreviewInfo,
  ): Promise<RunArtifactsBundle> {
    const run = await this.getRunRow(sessionId, runId);
    const existing = readRunArtifactsBundle(run.providerMetadata);
    if (!existing) {
      throw new NotFoundException('RUN_ARTIFACTS_NOT_FOUND');
    }
    const bundle = this.decorateBundle(sessionId, runId, {
      ...existing,
      summary: {
        ...existing.summary,
        preview,
      },
    });
    await this.persistBundle(sessionId, runId, bundle);
    await this.syncNodeSummary(sessionId, bundle);
    return bundle;
  }

  async getStaticPreviewFile(sessionId: string, runId: string, requestedPath: string): Promise<Buffer> {
    const bundle = await this.getRunArtifacts(sessionId, runId);
    const preview = bundle.summary.preview;
    if (preview.strategy !== 'static' || preview.status === 'unavailable') {
      throw new NotFoundException('RUN_PREVIEW_UNAVAILABLE');
    }
    const relativePath = requestedPath.trim() || 'index.html';
    const root =
      preview.root && preview.root !== '.'
        ? path.join(bundle.summary.cwd, preview.root)
        : bundle.summary.cwd;
    const { absolutePath } = this.safeResolvePath(root, relativePath);
    return fs.readFile(absolutePath);
  }

  private decorateBundle(sessionId: string, runId: string, bundle: RunArtifactsBundle): RunArtifactsBundle {
    const previewRoot = `/api/v1/sessions/${sessionId}/agents/${runId}/preview`;
    const preview = {
      ...bundle.summary.preview,
      embedPath:
        bundle.summary.preview.strategy === 'static' && bundle.summary.preview.status !== 'unavailable'
          ? `${previewRoot}/`
          : `${previewRoot}/frame`,
    };
    return {
      ...bundle,
      summary: {
        ...bundle.summary,
        preview,
      },
    };
  }

  private async persistBundle(sessionId: string, runId: string, bundle: RunArtifactsBundle): Promise<void> {
    const run = await this.getRunRow(sessionId, runId);
    const currentMeta =
      run.providerMetadata && typeof run.providerMetadata === 'object' && !Array.isArray(run.providerMetadata)
        ? (run.providerMetadata as Record<string, unknown>)
        : {};
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        providerMetadata: {
          ...currentMeta,
          artifacts: bundle,
        } as object,
      },
    });
  }

  private async syncNodeSummary(sessionId: string, bundle: RunArtifactsBundle): Promise<void> {
    await this.graph.patchNode(
      sessionId,
      bundle.summary.ownerNodeId,
      {
        metadata: {
          artifacts: bundle.summary,
        },
      },
      { type: 'system', reason: 'run-artifacts' },
    );
  }

  private componentNodeIds(
    snapshot: { nodes: GraphNode[]; edges: Array<{ source: string; target: string }> },
    startNodeId: string,
  ): Set<string> {
    const seen = new Set<string>();
    const queue = [startNodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const edge of snapshot.edges) {
        const next =
          edge.source === current ? edge.target : edge.target === current ? edge.source : null;
        if (!next || seen.has(next)) continue;
        queue.push(next);
      }
    }
    return seen;
  }

  private async readCurrentSnapshot(
    root: string,
    requestedPath: string,
    kind?: WorkflowArtifactContent['kind'],
  ): Promise<RunArtifactFileSnapshot> {
    const { absolutePath } = this.safeResolvePath(root, requestedPath);
    try {
      if (kind === 'directory') {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          return {
            kind: 'binary',
            size: 0,
          };
        }
      }
      return await readWorkspaceFileSnapshot(absolutePath);
    } catch (errorValue) {
      const code = (errorValue as NodeJS.ErrnoException).code;
      if (code === 'EISDIR') {
        return {
          kind: 'binary',
          size: 0,
        };
      }
      if (code !== 'ENOENT') {
        throw errorValue;
      }
      return {
        kind: 'missing',
        size: 0,
      };
    }
  }

  private buildWorkspaceFileContent(input: {
    executionId?: string;
    runId: string;
    relativePath: string;
    resolvedRelativePath: string;
    current: RunArtifactFileSnapshot;
    change?: 'added' | 'modified' | 'deleted';
    existing?: WorkflowArtifactContent | null;
  }): WorkflowArtifactContent {
    const transferMode = input.existing?.transferMode ?? 'reference';
    const claim =
      transferMode === 'claim_check'
        ? claimRef(input.runId, input.resolvedRelativePath)
        : input.existing?.claimRef;
    const currentKind =
      input.existing?.kind === 'directory'
        ? 'directory'
        : input.current.kind === 'text'
        ? 'text'
        : input.current.kind === 'binary'
          ? 'binary'
          : (input.existing?.kind ?? 'binary');
    return {
      title: input.existing?.title ?? path.basename(input.relativePath),
      relativePath: input.relativePath,
      ...(input.existing?.pathMode ? { pathMode: input.existing.pathMode } : {}),
      ...(input.resolvedRelativePath !== input.relativePath
        ? { resolvedRelativePath: input.resolvedRelativePath }
        : {}),
      role: input.existing?.role ?? 'output',
      origin: input.existing?.origin ?? 'agent_output',
      kind: currentKind,
      ...(input.existing?.mimeType ? { mimeType: input.existing.mimeType } : {}),
      ...(input.current.kind !== 'missing'
        ? { size: input.current.size }
        : input.existing?.size != null
          ? { size: input.existing.size }
          : {}),
      transferMode,
      ...(input.existing?.summary ? { summary: input.existing.summary } : {}),
      ...(input.current.kind === 'text'
        ? { excerpt: trimText(input.current.text, 800) }
        : input.existing?.excerpt
          ? { excerpt: input.existing.excerpt }
          : {}),
      ...(input.existing?.sourceTemplateNodeId
        ? { sourceTemplateNodeId: input.existing.sourceTemplateNodeId }
        : {}),
      ...(input.executionId ? { sourceExecutionId: input.executionId } : {}),
      sourceRunId: input.runId,
      ...(claim ? { claimRef: claim } : {}),
      status: input.change === 'deleted' ? 'deleted' : input.current.kind === 'missing' ? 'missing' : 'available',
      lastSeenAt: new Date().toISOString(),
      ...(input.change ? { change: input.change } : input.existing?.change ? { change: input.existing.change } : {}),
    };
  }

  private async syncWorkspaceFileNodes(sessionId: string, bundle: RunArtifactsBundle): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const component = this.componentNodeIds(snapshot, bundle.summary.ownerNodeId);
    const files = snapshot.nodes
      .filter((node) => component.has(node.id) && node.type === 'workspace_file')
      .map((node) => ({ node, content: readWorkflowArtifactContent(node.content) }))
      .filter(
        (
          entry,
        ): entry is {
          node: GraphNode;
          content: WorkflowArtifactContent;
        } => entry.content?.role === 'output',
      );

    // Covered = every relative path already represented by a workspace_file
    // node anywhere in the session. We widen the lookup to the full snapshot
    // (not just the owner's component) so we never create duplicates when a
    // copilot or another phase already declared the same artifact elsewhere.
    const coveredPaths = new Set<string>();
    for (const node of snapshot.nodes) {
      if (node.type !== 'workspace_file') continue;
      const content = readWorkflowArtifactContent(node.content);
      if (!content) continue;
      coveredPaths.add(resolveWorkflowArtifactRelativePath(content, bundle.summary.runId));
      if (content.relativePath) coveredPaths.add(content.relativePath);
    }

    for (const entry of files) {
      const resolvedRelativePath = resolveWorkflowArtifactRelativePath(entry.content, bundle.summary.runId);
      const change = bundle.files.find((file) => file.path === resolvedRelativePath)?.kind;
      const current = await this.readCurrentSnapshot(bundle.summary.cwd, resolvedRelativePath, entry.content.kind);
      await this.graph.patchNode(
        sessionId,
        entry.node.id,
        {
          content: this.buildWorkspaceFileContent({
            executionId: bundle.summary.executionId,
            runId: bundle.summary.runId,
            relativePath: entry.content.relativePath,
            resolvedRelativePath,
            current,
            change,
            existing: entry.content,
          }) as unknown as GraphNode['content'],
        },
        { type: 'system', reason: 'run-artifacts' },
      );
    }

    // Auto-adopt: every file the run wrote that nothing has declared yet
    // becomes its own workspace_file node, so the right-side panel shows
    // exactly what actually landed on disk (e.g., intermediate phase outputs
    // the user never pre-declared).
    const ownerNode = snapshot.nodes.find((node) => node.id === bundle.summary.ownerNodeId) ?? null;
    const baseX = (ownerNode?.position?.x ?? 0) + 400;
    const baseY = (ownerNode?.position?.y ?? 0) + 200;
    let adopted = 0;
    for (const change of bundle.files) {
      if (change.kind !== 'added' && change.kind !== 'modified') continue;
      if (coveredPaths.has(change.path)) continue;
      const current = await this.readCurrentSnapshot(bundle.summary.cwd, change.path);
      if (current.kind === 'missing') continue;
      const content = this.buildAdoptedWorkspaceFileContent({
        executionId: bundle.summary.executionId,
        runId: bundle.summary.runId,
        relativePath: change.path,
        current,
        change: change.kind,
      });
      await this.graph.addNode(sessionId, {
        type: 'workspace_file',
        content: content as unknown as GraphNode['content'],
        position: { x: baseX, y: baseY + adopted * 72 },
        creator: { type: 'system', reason: 'run-artifacts' },
        metadata: { adoptedByRun: bundle.summary.runId },
      });
      coveredPaths.add(change.path);
      adopted += 1;
    }
  }

  private buildAdoptedWorkspaceFileContent(input: {
    executionId?: string;
    runId: string;
    relativePath: string;
    current: RunArtifactFileSnapshot;
    change: 'added' | 'modified';
  }): WorkflowArtifactContent {
    return {
      title: path.basename(input.relativePath),
      relativePath: input.relativePath,
      role: 'output',
      origin: 'agent_output',
      kind: input.current.kind === 'text' ? 'text' : 'binary',
      transferMode: 'reference',
      ...(input.current.kind !== 'missing' ? { size: input.current.size } : {}),
      ...(input.current.kind === 'text' ? { excerpt: trimText(input.current.text, 800) } : {}),
      ...(input.executionId ? { sourceExecutionId: input.executionId } : {}),
      sourceRunId: input.runId,
      status: 'available',
      lastSeenAt: new Date().toISOString(),
      change: input.change,
    };
  }

  private safeResolvePath(root: string, requestedPath: string) {
    try {
      return resolveWorkspaceFilePath(root, requestedPath);
    } catch (errorValue) {
      throw new BadRequestException(
        errorValue instanceof Error ? errorValue.message : 'WORKSPACE_FILE_PATH_INVALID',
      );
    }
  }

  private async getRunRow(sessionId: string, runId: string): Promise<RunRow> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, sessionId },
      select: {
        id: true,
        sessionId: true,
        providerMetadata: true,
      },
    });
    if (!run) {
      throw new NotFoundException('RUN_NOT_FOUND');
    }
    return run;
  }
}
