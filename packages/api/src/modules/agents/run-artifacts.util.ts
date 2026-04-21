import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  RunArtifactFileChange,
  RunArtifactFileSnapshot,
  RunArtifactsBundle,
  WebPreviewInfo,
} from '@cepage/shared-core';

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.idea',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store']);

export const ARTIFACT_SUMMARY_LIMIT = 8;
export const SNAPSHOT_CAPTURE_BYTES = 128 * 1024;
export const VIEWER_CAPTURE_BYTES = 512 * 1024;

export type CapturedWorkspaceFile = {
  path: string;
  size: number;
  mtimeMs: number;
  snapshot: RunArtifactFileSnapshot;
};

export type CapturedWorkspaceState = Map<string, CapturedWorkspaceFile>;

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function shouldIgnoreEntry(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return IGNORED_DIRECTORY_NAMES.has(name);
  return IGNORED_FILE_NAMES.has(name);
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  let controlCount = 0;
  for (const byte of buffer) {
    if (byte < 7 || (byte > 13 && byte < 32)) {
      controlCount += 1;
    }
  }
  return controlCount / buffer.length < 0.2;
}

async function readFileSample(absolutePath: string, maxBytes: number, size: number): Promise<Buffer> {
  if (size === 0) {
    return Buffer.alloc(0);
  }
  if (size <= maxBytes) {
    return fs.readFile(absolutePath);
  }
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readWorkspaceFileSnapshot(
  absolutePath: string,
  maxBytes: number = VIEWER_CAPTURE_BYTES,
): Promise<RunArtifactFileSnapshot> {
  const stat = await fs.stat(absolutePath);
  const sample = await readFileSample(absolutePath, maxBytes, stat.size);
  if (!isProbablyText(sample)) {
    return {
      kind: 'binary',
      size: stat.size,
    };
  }
  return {
    kind: 'text',
    text: sample.toString('utf8'),
    size: stat.size,
    truncated: stat.size > sample.length,
  };
}

async function captureWorkspaceFile(root: string, absolutePath: string): Promise<CapturedWorkspaceFile> {
  const stat = await fs.stat(absolutePath);
  return {
    path: normalizeRelativePath(path.relative(root, absolutePath)),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    snapshot: await readWorkspaceFileSnapshot(absolutePath, SNAPSHOT_CAPTURE_BYTES),
  };
}

export async function captureWorkspaceState(root: string): Promise<CapturedWorkspaceState> {
  const files = new Map<string, CapturedWorkspaceFile>();
  async function visit(dir: string): Promise<void> {
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    for (const entry of entries) {
      const entryName = String(entry.name);
      if (shouldIgnoreEntry(entryName, entry.isDirectory())) {
        continue;
      }
      const absolutePath = path.join(dir, entryName);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const captured = await captureWorkspaceFile(root, absolutePath);
      files.set(captured.path, captured);
    }
  }
  await visit(root);
  return files;
}

function snapshotsEqual(a: CapturedWorkspaceFile, b: CapturedWorkspaceFile): boolean {
  if (a.size !== b.size) return false;
  if (a.snapshot.kind !== b.snapshot.kind) return false;
  if (a.snapshot.kind === 'text' && b.snapshot.kind === 'text' && !a.snapshot.truncated && !b.snapshot.truncated) {
    return a.snapshot.text === b.snapshot.text;
  }
  return Math.round(a.mtimeMs) === Math.round(b.mtimeMs);
}

function compareArtifactFiles(a: RunArtifactFileChange, b: RunArtifactFileChange): number {
  const order = { added: 0, modified: 1, deleted: 2 } as const;
  const left = order[a.kind as keyof typeof order];
  const right = order[b.kind as keyof typeof order];
  if (left !== right) {
    return left - right;
  }
  return a.path.localeCompare(b.path);
}

export function createInitialRunArtifactsBundle(input: {
  runId: string;
  executionId?: string;
  ownerNodeId: string;
  cwd: string;
}): RunArtifactsBundle {
  return {
    summary: {
      runId: input.runId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ownerNodeId: input.ownerNodeId,
      outputNodeId: input.ownerNodeId,
      cwd: input.cwd,
      generatedAt: new Date().toISOString(),
      counts: {
        added: 0,
        modified: 0,
        deleted: 0,
        total: 0,
      },
      files: [],
      preview: {
        status: 'idle',
      },
    },
    files: [],
  };
}

export function buildRunArtifactsBundle(input: {
  runId: string;
  executionId?: string;
  ownerNodeId: string;
  cwd: string;
  before: CapturedWorkspaceState;
  after: CapturedWorkspaceState;
  preview: WebPreviewInfo;
}): RunArtifactsBundle {
  const files: RunArtifactFileChange[] = [];
  for (const [filePath, nextFile] of input.after) {
    const previousFile = input.before.get(filePath);
    if (!previousFile) {
      files.push({
        path: filePath,
        kind: 'added',
        after: nextFile.snapshot,
      });
      continue;
    }
    if (snapshotsEqual(previousFile, nextFile)) {
      continue;
    }
    files.push({
      path: filePath,
      kind: 'modified',
      before: previousFile.snapshot,
      after: nextFile.snapshot,
    });
  }
  for (const [filePath, previousFile] of input.before) {
    if (input.after.has(filePath)) {
      continue;
    }
    files.push({
      path: filePath,
      kind: 'deleted',
      before: previousFile.snapshot,
      after: {
        kind: 'missing',
        size: 0,
      },
    });
  }
  files.sort(compareArtifactFiles);
  const counts = files.reduce(
    (result, file) => {
      if (file.kind === 'added') result.added += 1;
      if (file.kind === 'modified') result.modified += 1;
      if (file.kind === 'deleted') result.deleted += 1;
      return result;
    },
    { added: 0, modified: 0, deleted: 0 },
  );
  return {
    summary: {
      runId: input.runId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ownerNodeId: input.ownerNodeId,
      outputNodeId: input.ownerNodeId,
      cwd: input.cwd,
      generatedAt: new Date().toISOString(),
      counts: {
        ...counts,
        total: files.length,
      },
      files: files.slice(0, ARTIFACT_SUMMARY_LIMIT).map((file) => ({
        path: file.path,
        kind: file.kind,
      })),
      preview: input.preview,
    },
    files,
  };
}

export function resolveWorkspaceFilePath(root: string, requestedPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  if (!requestedPath || !requestedPath.trim()) {
    throw new Error('WORKSPACE_FILE_PATH_REQUIRED');
  }
  const relativePath = normalizeRelativePath(requestedPath.trim()).replace(/^\/+/, '');
  const absolutePath = path.resolve(root, relativePath);
  const relativeFromRoot = path.relative(root, absolutePath);
  if (
    relativeFromRoot === '' ||
    relativeFromRoot === '.' ||
    relativeFromRoot.startsWith('..') ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error('WORKSPACE_FILE_PATH_INVALID');
  }
  return {
    absolutePath,
    relativePath: normalizeRelativePath(relativeFromRoot),
  };
}
