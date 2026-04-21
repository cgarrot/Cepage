import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { GraphNode } from '@cepage/shared-core';
import { RunArtifactsService } from '../run-artifacts.service.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 320, height: 180 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

test('finalizeRun patches declared outputs and auto-adopts produced files without a matching workspace_file node', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-run-artifacts-'));
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const addedNodes: Array<{ type: GraphNode['type']; content: GraphNode['content'] }> = [];
  const addedEdges: Array<{ source: string; target: string; relation: string }> = [];

  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'agent-output-1',
        type: 'agent_output',
        creator: { type: 'agent', agentId: 'run-1', agentType: 'opencode' },
        position: { x: 120, y: 160 },
      }),
      node({
        id: 'declared-output-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        position: { x: 520, y: 180 },
        content: {
          title: 'Sources',
          relativePath: 'sources.md',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'agent-output-1',
        target: 'declared-output-1',
        relation: 'produces',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    agentRun: {
      findFirst: async () => ({
        id: 'run-1',
        sessionId: 'session-1',
        providerMetadata: {},
      }),
      update: async () => ({}),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (_sessionId: string, nodeId: string, patch: Record<string, unknown>) => {
      patches.push({ nodeId, patch });
      return { eventId: patches.length, payload: { type: 'node_updated' as const } };
    },
    addNode: async (
      _sessionId: string,
      input: { type: GraphNode['type']; content: GraphNode['content']; position: GraphNode['position']; creator: GraphNode['creator'] },
    ) => {
      const id = `artifact-${addedNodes.length + 1}`;
      addedNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 100 + addedNodes.length,
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: node({
            id,
            type: input.type,
            creator: input.creator,
            content: input.content,
            position: input.position,
          }),
        },
      };
    },
    addEdge: async (
      _sessionId: string,
      input: { source: string; target: string; relation: string },
    ) => {
      addedEdges.push({ source: input.source, target: input.target, relation: input.relation });
      return {
        eventId: 200 + addedEdges.length,
        payload: { type: 'edge_added' as const },
      };
    },
  };

  try {
    const service = new RunArtifactsService(prisma as never, graph as never);
    await service.captureRunStart('run-1', cwd);
    await fs.writeFile(path.join(cwd, 'sources.md'), '# Sources\n- https://example.com');
    await fs.writeFile(path.join(cwd, 'structured_notes.md'), '{"facts":["a"]}');

    const bundle = await service.finalizeRun('session-1', undefined, 'run-1', 'agent-output-1', cwd);

    assert.equal(bundle.files.length, 2);
    assert.equal(
      patches.some(
        (entry) =>
          entry.nodeId === 'declared-output-1' &&
          (entry.patch.content as { status?: string; relativePath?: string }).status === 'available' &&
          (entry.patch.content as { relativePath?: string }).relativePath === 'sources.md',
      ),
      true,
    );
    // structured_notes.md had no declared workspace_file node: it must be
    // auto-adopted so the user can still see it in the files panel.
    assert.equal(addedNodes.length, 1);
    assert.equal(addedNodes[0]?.type, 'workspace_file');
    assert.deepEqual(
      {
        relativePath: (addedNodes[0]?.content as { relativePath?: string } | undefined)?.relativePath,
        role: (addedNodes[0]?.content as { role?: string } | undefined)?.role,
        status: (addedNodes[0]?.content as { status?: string } | undefined)?.status,
        origin: (addedNodes[0]?.content as { origin?: string } | undefined)?.origin,
        sourceRunId: (addedNodes[0]?.content as { sourceRunId?: string } | undefined)?.sourceRunId,
        change: (addedNodes[0]?.content as { change?: string } | undefined)?.change,
      },
      {
        relativePath: 'structured_notes.md',
        role: 'output',
        status: 'available',
        origin: 'agent_output',
        sourceRunId: 'run-1',
        change: 'added',
      },
    );
    assert.equal(addedEdges.length, 0);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('finalizeRun matches per-run workspace file outputs against the resolved path', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-run-artifacts-'));
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const runId = '550e8400-e29b-41d4-a716-446655440000';

  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'agent-output-1',
        type: 'agent_output',
        creator: { type: 'agent', agentId: runId, agentType: 'opencode' },
        position: { x: 120, y: 160 },
      }),
      node({
        id: 'declared-output-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        position: { x: 520, y: 180 },
        content: {
          title: 'Sources',
          relativePath: 'research/sources.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'claim_check',
          status: 'declared',
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'agent-output-1',
        target: 'declared-output-1',
        relation: 'produces',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    agentRun: {
      findFirst: async () => ({
        id: runId,
        sessionId: 'session-1',
        providerMetadata: {},
      }),
      update: async () => ({}),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (_sessionId: string, nodeId: string, patch: Record<string, unknown>) => {
      patches.push({ nodeId, patch });
      return { eventId: patches.length, payload: { type: 'node_updated' as const } };
    },
    addNode: async () => {
      throw new Error('unexpected addNode');
    },
    addEdge: async () => {
      throw new Error('unexpected addEdge');
    },
  };

  try {
    const service = new RunArtifactsService(prisma as never, graph as never);
    await service.captureRunStart(runId, cwd);
    await fs.mkdir(path.join(cwd, 'research/run-550e8400'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'research/run-550e8400/sources.md'), '# Sources\n- https://example.com');

    const bundle = await service.finalizeRun('session-1', undefined, runId, 'agent-output-1', cwd);

    assert.equal(bundle.files.some((entry) => entry.path === 'research/run-550e8400/sources.md'), true);
    assert.deepEqual(
      patches.find((entry) => entry.nodeId === 'declared-output-1')?.patch.content,
      {
        title: 'Sources',
        relativePath: 'research/sources.md',
        pathMode: 'per_run',
        resolvedRelativePath: 'research/run-550e8400/sources.md',
        role: 'output',
        origin: 'derived',
        kind: 'text',
        size: '# Sources\n- https://example.com'.length,
        transferMode: 'claim_check',
        excerpt: '# Sources\n- https://example.com',
        sourceRunId: runId,
        claimRef: 'artifact://run/550e8400-e29b-41d4-a716-446655440000/research%2Frun-550e8400%2Fsources.md',
        status: 'available',
        lastSeenAt: (patches.find((entry) => entry.nodeId === 'declared-output-1')?.patch.content as { lastSeenAt?: string })
          ?.lastSeenAt,
        change: 'added',
      },
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('finalizeRun auto-adopts every produced file when no workspace_file node is declared', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-run-artifacts-'));
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const addedNodes: Array<{ type: GraphNode['type']; content: GraphNode['content']; position: GraphNode['position'] }> = [];

  const snapshot = {
    version: 1 as const,
    id: 'session-adopt',
    createdAt: '2026-04-21T10:00:00.000Z',
    nodes: [
      node({
        id: 'agent-step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        position: { x: 350, y: 130 },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    agentRun: {
      findFirst: async () => ({
        id: 'run-adopt',
        sessionId: 'session-adopt',
        providerMetadata: {},
      }),
      update: async () => ({}),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (_sessionId: string, nodeId: string, patch: Record<string, unknown>) => {
      patches.push({ nodeId, patch });
      return { eventId: patches.length, payload: { type: 'node_updated' as const } };
    },
    addNode: async (
      _sessionId: string,
      input: {
        type: GraphNode['type'];
        content: GraphNode['content'];
        position: GraphNode['position'];
        creator: GraphNode['creator'];
      },
    ) => {
      const id = `adopted-${addedNodes.length + 1}`;
      addedNodes.push({ type: input.type, content: input.content, position: input.position });
      return {
        eventId: 100 + addedNodes.length,
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: node({
            id,
            type: input.type,
            creator: input.creator,
            content: input.content,
            position: input.position,
          }),
        },
      };
    },
    addEdge: async () => ({
      eventId: 999,
      payload: { type: 'edge_added' as const },
    }),
  };

  try {
    const service = new RunArtifactsService(prisma as never, graph as never);
    await service.captureRunStart('run-adopt', cwd);
    await fs.mkdir(path.join(cwd, 'outputs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'outputs/research-raw.md'), '# Research\nraw notes');
    await fs.writeFile(path.join(cwd, 'outputs/analysis.md'), '## Analysis\npoints');

    const bundle = await service.finalizeRun(
      'session-adopt',
      'exec-1',
      'run-adopt',
      'agent-step-1',
      cwd,
    );

    assert.equal(bundle.files.length, 2);
    assert.equal(addedNodes.length, 2);
    const paths = addedNodes
      .map((entry) => (entry.content as { relativePath?: string }).relativePath)
      .sort();
    assert.deepEqual(paths, ['outputs/analysis.md', 'outputs/research-raw.md']);
    for (const entry of addedNodes) {
      const content = entry.content as {
        role?: string;
        origin?: string;
        status?: string;
        sourceRunId?: string;
        sourceExecutionId?: string;
      };
      assert.equal(entry.type, 'workspace_file');
      assert.equal(content.role, 'output');
      assert.equal(content.origin, 'agent_output');
      assert.equal(content.status, 'available');
      assert.equal(content.sourceRunId, 'run-adopt');
      assert.equal(content.sourceExecutionId, 'exec-1');
    }
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('finalizeRun does not re-adopt a file already declared in a different component', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-run-artifacts-'));
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const addedNodes: Array<{ type: GraphNode['type']; content: GraphNode['content'] }> = [];

  const snapshot = {
    version: 1 as const,
    id: 'session-nodup',
    createdAt: '2026-04-21T10:00:00.000Z',
    nodes: [
      node({
        id: 'agent-step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
      }),
      // Declared in an UNCONNECTED component — still must count as covered so
      // we never produce a duplicate row in the files panel.
      node({
        id: 'disconnected-declared',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Report',
          relativePath: 'outputs/report.md',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    agentRun: {
      findFirst: async () => ({
        id: 'run-nodup',
        sessionId: 'session-nodup',
        providerMetadata: {},
      }),
      update: async () => ({}),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (_sessionId: string, nodeId: string, patch: Record<string, unknown>) => {
      patches.push({ nodeId, patch });
      return { eventId: patches.length, payload: { type: 'node_updated' as const } };
    },
    addNode: async (
      _sessionId: string,
      input: { type: GraphNode['type']; content: GraphNode['content'] },
    ) => {
      addedNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 100 + addedNodes.length,
        payload: {
          type: 'node_added' as const,
          nodeId: `added-${addedNodes.length}`,
          node: node({
            id: `added-${addedNodes.length}`,
            type: input.type,
            creator: { type: 'system', reason: 'test' },
            content: input.content,
          }),
        },
      };
    },
    addEdge: async () => ({
      eventId: 999,
      payload: { type: 'edge_added' as const },
    }),
  };

  try {
    const service = new RunArtifactsService(prisma as never, graph as never);
    await service.captureRunStart('run-nodup', cwd);
    await fs.mkdir(path.join(cwd, 'outputs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'outputs/report.md'), '# Report');

    await service.finalizeRun('session-nodup', undefined, 'run-nodup', 'agent-step-1', cwd);

    assert.equal(addedNodes.length, 0, 'already-declared file must not be re-adopted');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
