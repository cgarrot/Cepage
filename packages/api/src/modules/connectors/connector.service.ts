import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  readConnectorTargetContent,
  type ConnectorHttpTargetContent,
  type ConnectorProcessTargetContent,
  type ConnectorRunSummary,
  type ConnectorTargetContent,
  type GraphNode,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import type { ConnectorJobPayload } from '../execution/execution-job-payload';
import { GraphService } from '../graph/graph.service';

const CONNECTOR_STDIO_LIMIT = 512 * 1024;
type HttpRequestBody = string | Buffer;

@Injectable()
export class ConnectorService {
  private readonly log = new Logger(ConnectorService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly prisma: PrismaService,
  ) {}

  async executeQueuedConnectorJob(
    payload: ConnectorJobPayload,
    _workerId?: string,
  ): Promise<Record<string, unknown>> {
    const summary = await this.runTargetNow(payload.sessionId, payload.targetNodeId, payload.requestId);
    return {
      runNodeId: summary.runNodeId,
      status: summary.status,
      ...(summary.httpStatus != null ? { httpStatus: summary.httpStatus } : {}),
      ...(summary.exitCode != null ? { exitCode: summary.exitCode } : {}),
      ...(summary.outputPath ? { outputPath: summary.outputPath } : {}),
    };
  }

  async runManagedTarget(sessionId: string, targetNodeId: string, requestId?: string): Promise<ConnectorRunSummary> {
    return this.runTargetNow(sessionId, targetNodeId, requestId);
  }

  private async runTargetNow(
    sessionId: string,
    targetNodeId: string,
    requestId?: string,
  ): Promise<ConnectorRunSummary> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const targetNode = snapshot.nodes.find((entry) => entry.id === targetNodeId) ?? null;
    if (!targetNode) {
      throw new NotFoundException('CONNECTOR_TARGET_NOT_FOUND');
    }
    if (targetNode.type !== 'connector_target') {
      throw new BadRequestException('CONNECTOR_TARGET_INVALID');
    }
    const target = readConnectorTargetContent(targetNode.content);
    if (!target) {
      throw new BadRequestException('CONNECTOR_TARGET_INVALID_CONTENT');
    }

    const runNodeId = await this.createRunNode(sessionId, targetNode, requestId);
    const startedAt = new Date().toISOString();
    const baseSummary = this.buildInitialSummary(runNodeId, targetNode, target, startedAt);
    await this.patchRunNode(sessionId, runNodeId, baseSummary, requestId);

    try {
      const completed =
        target.kind === 'http'
          ? await this.executeHttpTarget(sessionId, baseSummary, target)
          : await this.executeProcessTarget(sessionId, baseSummary, target);
      await this.patchRunNode(sessionId, runNodeId, completed, requestId);
      return completed;
    } catch (errorValue) {
      const detail = errorValue instanceof Error ? errorValue.message : String(errorValue);
      this.log.warn(`connector ${targetNodeId} failed: ${detail}`);
      const failed: ConnectorRunSummary = {
        ...baseSummary,
        status: 'failed',
        endedAt: new Date().toISOString(),
        error: detail,
        detail,
      };
      await this.safeWriteFailureMetadata(target, sessionId, failed);
      await this.patchRunNode(sessionId, runNodeId, failed, requestId);
      return failed;
    }
  }

  private buildInitialSummary(
    runNodeId: string,
    targetNode: GraphNode,
    target: ConnectorTargetContent,
    startedAt: string,
  ): ConnectorRunSummary {
    const base: ConnectorRunSummary = {
      runNodeId,
      targetNodeId: targetNode.id,
      kind: target.kind,
      args: target.kind === 'process' ? target.args : [],
      status: 'running',
      startedAt,
      timeoutMs: target.timeoutMs,
      ...(target.title ? { title: target.title } : {}),
      ...(target.kind === 'http'
        ? {
            method: target.method,
          }
        : {
            command: target.command,
            args: target.args,
            ...(target.cwd ? { cwd: target.cwd } : {}),
          }),
    };
    return base;
  }

  private async createRunNode(
    sessionId: string,
    targetNode: GraphNode,
    requestId?: string,
  ): Promise<string> {
    const env = await this.graph.addNode(sessionId, {
      type: 'connector_run',
      content: {},
      position: {
        x: targetNode.position.x + 20,
        y: targetNode.position.y + 220,
      },
      creator: { type: 'system', reason: 'connector_run' },
      metadata: {
        runtimeOwned: 'connector',
      },
      requestId,
    });
    const runNodeId = env.payload.type === 'node_added' ? env.payload.node.id : null;
    if (!runNodeId) {
      throw new Error('CONNECTOR_RUN_NODE_CREATE_FAILED');
    }
    await this.graph.addEdge(sessionId, {
      source: targetNode.id,
      target: runNodeId,
      relation: 'produces',
      direction: 'source_to_target',
      creator: { type: 'system', reason: 'connector_run' },
      requestId,
      metadata: {
        runtimeOwned: 'connector',
      },
    });
    return runNodeId;
  }

  private async patchRunNode(
    sessionId: string,
    runNodeId: string,
    summary: ConnectorRunSummary,
    requestId?: string,
  ): Promise<void> {
    await this.graph.patchNode(
      sessionId,
      runNodeId,
      {
        content: { connectorRun: summary },
        metadata: {
          runtimeOwned: 'connector',
          connectorRun: summary,
        },
      },
      { type: 'system', reason: 'connector_run' },
      requestId,
    );
  }

  private async executeHttpTarget(
    sessionId: string,
    summary: ConnectorRunSummary,
    target: ConnectorHttpTargetContent,
  ): Promise<ConnectorRunSummary> {
    const workspaceRoot = await this.resolveWorkspaceRoot(sessionId);
    const url = await this.resolveHttpUrl(workspaceRoot, target.url);
    const headers = await this.resolveHeaderMap(target.headers);
    const { body, contentType } = await this.resolveHttpBody(workspaceRoot, target.body);
    if (contentType && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = contentType;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), target.timeoutMs);
    try {
      const response = await fetch(url, {
        method: target.method,
        headers,
        body,
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const statusOk = (target.successStatusCodes ?? []).length > 0
        ? target.successStatusCodes?.includes(response.status) === true
        : response.ok;

      const outputPath = target.output?.path
        ? await this.writeHttpOutput(workspaceRoot, target.output.path, target.output.format, buffer)
        : undefined;
      if (target.metadataPath) {
        await this.writeJsonFile(this.resolveWorkspacePath(workspaceRoot, target.metadataPath), {
          kind: 'http',
          status: statusOk ? 'completed' : 'failed',
          method: target.method,
          url,
          httpStatus: response.status,
          ok: statusOk,
          outputPath,
          outputBytes: buffer.length,
          headers: Object.fromEntries(response.headers.entries()),
          startedAt: summary.startedAt,
          endedAt: new Date().toISOString(),
        });
      }

      if (!statusOk) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      return {
        ...summary,
        status: 'completed',
        endedAt: new Date().toISOString(),
        url,
        httpStatus: response.status,
        ...(outputPath ? { outputPath } : {}),
        ...(target.metadataPath ? { metadataPath: target.metadataPath } : {}),
        outputBytes: buffer.length,
        detail: `${target.method} ${response.status} ${url}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeProcessTarget(
    sessionId: string,
    summary: ConnectorRunSummary,
    target: ConnectorProcessTargetContent,
  ): Promise<ConnectorRunSummary> {
    const workspaceRoot = await this.resolveWorkspaceRoot(sessionId);
    const cwd = this.resolveWorkspacePath(workspaceRoot, target.cwd ?? '.');
    const env = {
      ...process.env,
      ...await this.resolveEnvMap(target.env),
    };
    const stdin = await this.resolveProcessStdin(workspaceRoot, target.stdin);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const child = spawn(target.command, target.args, {
      cwd,
      env,
      stdio: 'pipe',
    });

    const pushChunk = (bucket: Buffer[], value: Buffer, totalBytes: number) => {
      if (totalBytes >= CONNECTOR_STDIO_LIMIT) {
        return totalBytes;
      }
      const remaining = CONNECTOR_STDIO_LIMIT - totalBytes;
      bucket.push(value.subarray(0, remaining));
      return totalBytes + value.length;
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes = pushChunk(stdoutChunks, buffer, stdoutBytes);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes = pushChunk(stderrChunks, buffer, stderrBytes);
    });

    if (stdin) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, target.timeoutMs);

    try {
      const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
      });

      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      if (target.stdoutPath) {
        await this.writeBufferFile(this.resolveWorkspacePath(workspaceRoot, target.stdoutPath), stdout);
      }
      if (target.stderrPath) {
        await this.writeBufferFile(this.resolveWorkspacePath(workspaceRoot, target.stderrPath), stderr);
      }

      const successExitCodes = target.successExitCodes ?? [0];
      const ok = !timedOut && result.signal == null && successExitCodes.includes(result.exitCode ?? -1);
      if (target.metadataPath) {
        await this.writeJsonFile(this.resolveWorkspacePath(workspaceRoot, target.metadataPath), {
          kind: 'process',
          status: ok ? 'completed' : 'failed',
          command: target.command,
          args: target.args,
          cwd: target.cwd ?? '.',
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut,
          stdoutPath: target.stdoutPath,
          stderrPath: target.stderrPath,
          stdoutBytes: stdout.length,
          stderrBytes: stderr.length,
          startedAt: summary.startedAt,
          endedAt: new Date().toISOString(),
        });
      }

      if (!ok) {
        const detail =
          timedOut
            ? `process timeout after ${target.timeoutMs}ms`
            : result.signal
              ? `process killed by ${result.signal}`
              : `process exit ${String(result.exitCode ?? 'unknown')}`;
        throw new Error(detail);
      }

      return {
        ...summary,
        status: 'completed',
        endedAt: new Date().toISOString(),
        exitCode: result.exitCode ?? 0,
        cwd: target.cwd ?? '.',
        ...(target.stdoutPath ? { stdoutPath: target.stdoutPath } : {}),
        ...(target.stderrPath ? { stderrPath: target.stderrPath } : {}),
        ...(target.metadataPath ? { metadataPath: target.metadataPath } : {}),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
        detail: `${target.command} exited ${result.exitCode ?? 0}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async safeWriteFailureMetadata(
    target: ConnectorTargetContent,
    sessionId: string,
    summary: ConnectorRunSummary,
  ): Promise<void> {
    const metadataPath = target.metadataPath;
    if (!metadataPath) {
      return;
    }
    try {
      const workspaceRoot = await this.resolveWorkspaceRoot(sessionId);
      await this.writeJsonFile(this.resolveWorkspacePath(workspaceRoot, metadataPath), {
        kind: target.kind,
        status: 'failed',
        error: summary.error,
        detail: summary.detail,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
      });
    } catch {
      // Metadata is best effort when the primary connector execution has already failed.
    }
  }

  private async resolveWorkspaceRoot(sessionId: string): Promise<string> {
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
    const workspace = readSessionWorkspace(process.cwd(), session);
    if (!workspace) {
      return process.cwd();
    }
    return workspace.workingDirectory;
  }

  private resolveWorkspacePath(workspaceRoot: string, value: string): string {
    return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
  }

  private async resolveHeaderMap(input: Record<string, string | { kind: 'env'; name: string; optional?: boolean }>) {
    const entries = await Promise.all(
      Object.entries(input).map(async ([key, value]) => [key, await this.resolveValueSource(value)] as const),
    );
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'));
  }

  private async resolveEnvMap(input: Record<string, string | { kind: 'env'; name: string; optional?: boolean }>) {
    const entries = await Promise.all(
      Object.entries(input).map(async ([key, value]) => [key, await this.resolveValueSource(value)] as const),
    );
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'));
  }

  private async resolveValueSource(
    value: string | { kind: 'env'; name: string; optional?: boolean },
  ): Promise<string | undefined> {
    if (typeof value === 'string') {
      return value;
    }
    const envValue = process.env[value.name];
    if (typeof envValue === 'string' && envValue.length > 0) {
      return envValue;
    }
    if (value.optional) {
      return undefined;
    }
    throw new Error(`Missing required env var ${value.name}`);
  }

  private async resolveHttpUrl(
    workspaceRoot: string,
    value: string | { path: string; jsonPath?: string },
  ): Promise<string> {
    if (typeof value === 'string') {
      return value;
    }
    const absolute = this.resolveWorkspacePath(workspaceRoot, value.path);
    const raw = await fs.readFile(absolute, 'utf8');
    if (!value.jsonPath?.trim()) {
      const url = raw.trim();
      if (!url) {
        throw new Error(`HTTP url source is empty: ${value.path}`);
      }
      return url;
    }
    const parsed = JSON.parse(raw);
    const resolved = readJsonPath(parsed, value.jsonPath);
    if (typeof resolved !== 'string' || !resolved.trim()) {
      throw new Error(`HTTP url source missing ${value.jsonPath} in ${value.path}`);
    }
    return resolved.trim();
  }

  private async resolveHttpBody(
    workspaceRoot: string,
    body: ConnectorHttpTargetContent['body'],
  ): Promise<{ body?: HttpRequestBody; contentType?: string }> {
    if (!body) {
      return {};
    }
    if (body.kind === 'text') {
      return {
        body: body.text,
        contentType: 'text/plain; charset=utf-8',
      };
    }
    if (body.kind === 'json') {
      return {
        body: JSON.stringify(body.value, null, 2),
        contentType: 'application/json',
      };
    }
    const absolute = this.resolveWorkspacePath(workspaceRoot, body.path);
    if (body.format === 'binary') {
      return {
        body: await fs.readFile(absolute),
      };
    }
    const text = await fs.readFile(absolute, 'utf8');
    return {
      body: text,
      contentType: body.format === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
    };
  }

  private async resolveProcessStdin(
    workspaceRoot: string,
    stdin: ConnectorProcessTargetContent['stdin'],
  ): Promise<Buffer | undefined> {
    if (!stdin) {
      return undefined;
    }
    if (stdin.kind === 'text') {
      return Buffer.from(stdin.text, 'utf8');
    }
    const absolute = this.resolveWorkspacePath(workspaceRoot, stdin.path);
    return fs.readFile(absolute);
  }

  private async writeHttpOutput(
    workspaceRoot: string,
    relativePath: string,
    format: 'text' | 'json' | 'binary',
    body: Buffer,
  ): Promise<string> {
    const absolute = this.resolveWorkspacePath(workspaceRoot, relativePath);
    if (format === 'binary') {
      await this.writeBufferFile(absolute, body);
      return relativePath;
    }
    const text = body.toString('utf8');
    if (format === 'json') {
      const parsed = JSON.parse(text);
      await this.writeJsonFile(absolute, parsed);
      return relativePath;
    }
    await this.writeTextFile(absolute, text);
    return relativePath;
  }

  private async writeTextFile(absolutePath: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, text, 'utf8');
  }

  private async writeBufferFile(absolutePath: string, value: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, value);
  }

  private async writeJsonFile(absolutePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

function readJsonPath(value: unknown, pathExpression: string): unknown {
  const parts = pathExpression
    .split('.')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
