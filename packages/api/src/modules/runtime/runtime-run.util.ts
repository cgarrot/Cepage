import * as net from 'node:net';
import * as path from 'node:path';
import {
  readRuntimeRunSummary,
  readRuntimeTargetSummary,
  type GraphEdge,
  type GraphNode,
  type RuntimeExecutionStatus,
  type RuntimePortSpec,
  type RuntimeRunSummary,
  type RuntimeTargetSummary,
  type RunnableArtifactManifest,
  type WebPreviewInfo,
} from '@cepage/shared-core';

export const RUNTIME_BIND_HOST = '127.0.0.1';

const LOG_TAIL_LIMIT = 16_000;
const RUNTIME_PREVIEW_HOST = 'localhost';

export type RuntimeTargetSeed = Omit<RuntimeTargetSummary, 'targetNodeId'>;

type TargetHit = {
  node: GraphNode;
  summary: RuntimeTargetSummary;
};

type RunHit = {
  node: GraphNode;
  summary: RuntimeRunSummary;
};

export function buildRunSummary(target: RuntimeTargetSummary, runNodeId: string): RuntimeRunSummary {
  return {
    runNodeId,
    targetNodeId: target.targetNodeId,
    sourceRunId: target.sourceRunId,
    targetKind: target.kind,
    launchMode: target.launchMode,
    serviceName: target.serviceName,
    cwd: target.cwd,
    command: target.command,
    args: target.args ?? [],
    ports: target.ports ?? [],
    entrypoint: target.entrypoint,
    monorepoRole: target.monorepoRole,
    docker: target.docker,
    status: 'planned',
  };
}

function defaultAutoRun(kind: RuntimeTargetSummary['kind']): boolean {
  return kind === 'web' || kind === 'api';
}

export function isStaticWebTarget(target: RuntimeTargetSummary): boolean {
  return (
    target.kind === 'web' &&
    (!target.command ||
      target.preview?.mode === 'static' ||
      readStaticEntrypoint(target).toLowerCase().endsWith('.html'))
  );
}

export function readStaticEntrypoint(target: RuntimeTargetSummary): string {
  return target.preview?.entry?.trim() || target.entrypoint?.trim() || 'index.html';
}

export function buildStaticPreviewInfo(
  sessionId: string,
  runNodeId: string,
  target: RuntimeTargetSummary,
): WebPreviewInfo {
  const entry = readStaticEntrypoint(target);
  return {
    status: 'running',
    strategy: 'static',
    root: path.dirname(entry),
    embedPath: `/api/v1/sessions/${sessionId}/runtime/runs/${runNodeId}/preview/`,
  };
}

export function buildScriptPreviewInfo(port: number): WebPreviewInfo {
  return {
    status: 'launching',
    strategy: 'script',
    port,
    url: `http://${RUNTIME_PREVIEW_HOST}:${port}`,
  };
}

export function dockerSpawnInput(
  target: RuntimeTargetSummary,
  command: string | undefined,
  args: string[],
  env: Record<string, string>,
  ports: RuntimePortSpec[],
): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const image = target.docker?.image?.trim();
  if (!image) {
    throw new Error('Docker runtime requires docker.image');
  }
  const workDir = target.docker?.workingDir?.trim() || target.cwd;
  const next = ['run', '--rm', '--init', '-w', workDir, '-v', `${target.cwd}:${workDir}`];
  for (const mount of target.docker?.mounts ?? []) {
    if (mount.trim()) {
      next.push('-v', mount.trim());
    }
  }
  for (const [key, value] of Object.entries(env)) {
    next.push('-e', `${key}=${value}`);
  }
  for (const port of ports) {
    next.push('-p', `${port.port}:${port.targetPort ?? port.port}`);
  }
  next.push(image);
  if (command) {
    next.push(command, ...args);
  }
  return {
    command: 'docker',
    args: next,
    cwd: target.cwd,
    env: process.env,
  };
}

export function runtimeTargetPosition(
  anchor: GraphNode['position'],
  index: number,
): GraphNode['position'] {
  return {
    x: anchor.x + 420,
    y: anchor.y + index * 190,
  };
}

export function runtimeRunPosition(anchor: GraphNode['position']): GraphNode['position'] {
  return {
    x: anchor.x + 20,
    y: anchor.y + 220,
  };
}

export function readRuntimeTargetFromNode(node: GraphNode): RuntimeTargetSummary | null {
  return readRuntimeTargetSummary(node.metadata) ?? readRuntimeTargetSummary(node.content);
}

export function readRuntimeRunFromNode(node: GraphNode): RuntimeRunSummary | null {
  return readRuntimeRunSummary(node.metadata) ?? readRuntimeRunSummary(node.content);
}

export function buildRuntimeTargetSeed(input: {
  sourceRunId: string;
  outputNodeId: string;
  manifest: RunnableArtifactManifest;
  source: RuntimeTargetSummary['source'];
}): RuntimeTargetSeed {
  return {
    sourceRunId: input.sourceRunId,
    outputNodeId: input.outputNodeId,
    kind: input.manifest.kind,
    launchMode: input.manifest.launchMode,
    serviceName: input.manifest.serviceName,
    cwd: input.manifest.cwd,
    command: input.manifest.command,
    args: input.manifest.args ?? [],
    env: input.manifest.env,
    ports: input.manifest.ports ?? [],
    entrypoint: input.manifest.entrypoint,
    preview: input.manifest.preview,
    monorepoRole: input.manifest.monorepoRole,
    docker: input.manifest.docker,
    autoRun: input.manifest.autoRun ?? defaultAutoRun(input.manifest.kind),
    source: input.source,
  };
}

export function readRuntimeTargetHits(snapshot: { nodes: GraphNode[] }): TargetHit[] {
  return snapshot.nodes
    .filter((node) => node.type === 'runtime_target')
    .flatMap((node) => {
      const summary = readRuntimeTargetFromNode(node);
      return summary ? [{ node, summary }] : [];
    });
}

export function readRuntimeRunHits(snapshot: { nodes: GraphNode[] }): RunHit[] {
  return snapshot.nodes
    .filter((node) => node.type === 'runtime_run')
    .flatMap((node) => {
      const summary = readRuntimeRunFromNode(node);
      return summary ? [{ node, summary }] : [];
    });
}

export function sameRuntimeTarget(
  target: RuntimeTargetSummary,
  seed: RuntimeTargetSeed,
): boolean {
  return runtimeTargetKey(target) === runtimeTargetKey(seed);
}

function runtimeTargetKey(target: RuntimeTargetSeed | RuntimeTargetSummary): string {
  return stableJson({
    outputNodeId: target.outputNodeId ?? '',
    kind: target.kind,
    launchMode: target.launchMode,
    serviceName: target.serviceName,
    cwd: target.cwd,
    command: target.command ?? '',
    args: target.args ?? [],
    env: target.env ?? {},
    ports: target.ports ?? [],
    entrypoint: target.entrypoint ?? '',
    preview: target.preview ?? {},
    monorepoRole: target.monorepoRole ?? '',
    docker: target.docker ?? {},
  });
}

export function mergeRuntimeRun(
  run: RuntimeRunSummary,
  target: RuntimeTargetSummary,
): RuntimeRunSummary {
  return {
    ...run,
    sourceRunId: target.sourceRunId,
    targetKind: target.kind,
    launchMode: target.launchMode,
    serviceName: target.serviceName,
    cwd: target.cwd,
    command: target.command,
    args: target.args ?? [],
    ports: target.ports ?? [],
    entrypoint: target.entrypoint,
    monorepoRole: target.monorepoRole,
    docker: target.docker,
  };
}

export function sortTargetHits(
  hits: TargetHit[],
  snapshot: { nodes: GraphNode[] },
  liveRunIds: ReadonlySet<string>,
): TargetHit[] {
  const runs = readRuntimeRunHits(snapshot);
  return [...hits].sort((a, b) => {
    const score = targetHitScore(b, runs, liveRunIds) - targetHitScore(a, runs, liveRunIds);
    if (score !== 0) {
      return score;
    }
    return compareNodeDesc(a.node, b.node);
  });
}

function targetHitScore(
  hit: TargetHit,
  runs: RunHit[],
  liveRunIds: ReadonlySet<string>,
): number {
  const own = runs.filter((entry) => entry.summary.targetNodeId === hit.node.id);
  if (own.some((entry) => canReuseRuntimeRun(entry.summary, hit.summary, liveRunIds))) {
    return 2;
  }
  if (own.some((entry) => isActiveRuntimeRun(entry.summary.status))) {
    return 1;
  }
  return 0;
}

export function sortRunHits(
  hits: RunHit[],
  target: RuntimeTargetSummary,
  liveRunIds: ReadonlySet<string>,
): RunHit[] {
  return [...hits].sort((a, b) => {
    const score = runHitScore(b, target, liveRunIds) - runHitScore(a, target, liveRunIds);
    if (score !== 0) {
      return score;
    }
    return compareNodeDesc(a.node, b.node);
  });
}

function runHitScore(
  hit: RunHit,
  target: RuntimeTargetSummary,
  liveRunIds: ReadonlySet<string>,
): number {
  if (canReuseRuntimeRun(hit.summary, target, liveRunIds)) {
    return 2;
  }
  if (isActiveRuntimeRun(hit.summary.status)) {
    return 1;
  }
  return 0;
}

export function canReuseRuntimeRun(
  run: RuntimeRunSummary,
  target: RuntimeTargetSummary,
  liveRunIds: ReadonlySet<string>,
): boolean {
  if (!isActiveRuntimeRun(run.status)) {
    return false;
  }
  if (target.launchMode === 'docker' || isStaticWebTarget(target)) {
    return true;
  }
  return liveRunIds.has(run.runNodeId);
}

export function isActiveRuntimeRun(status: RuntimeExecutionStatus): boolean {
  return status === 'running' || status === 'launching';
}

export function recoveredRuntimeRun(run: RuntimeRunSummary): RuntimeRunSummary {
  const error = 'Runtime stopped during recovery because live process state was lost on restart.';
  return {
    ...run,
    status: 'stopped',
    endedAt: run.endedAt ?? new Date().toISOString(),
    error,
    preview: run.preview
      ? {
          ...run.preview,
          status: 'unavailable',
          error,
        }
      : undefined,
  };
}

function compareNodeDesc(a: GraphNode, b: GraphNode): number {
  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.createdAt.localeCompare(a.createdAt) ||
    b.id.localeCompare(a.id)
  );
}

export function hasRuntimeEdge(
  snapshot: { edges?: Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> },
  source: string,
  target: string,
): boolean {
  return (snapshot.edges ?? []).some(
    (edge) =>
      edge.source === source && edge.target === target && edge.relation === 'produces',
  );
}

export function isDuplicateEdgeError(errorValue: unknown): boolean {
  return errorValue instanceof Error && errorValue.message === 'EDGE_DUPLICATE';
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortJson((value as Record<string, unknown>)[key])]),
  );
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, RUNTIME_BIND_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('RUNTIME_PORT_UNAVAILABLE'));
        return;
      }
      const { port } = address;
      server.close((errorValue) => {
        if (errorValue) {
          reject(errorValue);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function materializePorts(
  ports: RuntimePortSpec[] | undefined,
): Promise<RuntimePortSpec[]> {
  if (!ports || ports.length === 0) {
    return [];
  }
  const resolved: RuntimePortSpec[] = [];
  for (const port of ports) {
    resolved.push({
      ...port,
      port: port.port > 0 ? port.port : await reservePort(),
    });
  }
  return resolved;
}

export function firstHttpPort(ports: RuntimePortSpec[]): RuntimePortSpec | null {
  return ports.find((entry) => entry.protocol === 'http' || entry.protocol === 'https') ?? null;
}

export async function isHttpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status > 0;
  } catch {
    return false;
  }
}

export function trimLog(value: string): string {
  return value.length > LOG_TAIL_LIMIT ? value.slice(-LOG_TAIL_LIMIT) : value;
}
