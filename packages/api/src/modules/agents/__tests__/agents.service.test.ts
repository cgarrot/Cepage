import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { GraphNode, GraphSnapshot } from '@cepage/shared-core';
import { AgentsService } from '../agents.service.js';

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

function buildStartInputHarness(snapshot: GraphSnapshot) {
  const addedNodes: Array<{ content: GraphNode['content']; type: GraphNode['type']; id: string }> = [];
  const addedEdges: Array<{ source: string; target: string; relation: string }> = [];
  let spawnBody: Record<string, unknown> | null = null;
  let spawnRunId = '';

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowExecution: {
      findFirst: async () => null,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    addNode: async (
      _sessionId: string,
      input: {
        type: GraphNode['type'];
        content: GraphNode['content'];
        position: GraphNode['position'];
        creator: GraphNode['creator'];
      },
    ) => {
      const id = `bound-${addedNodes.length + 1}`;
      addedNodes.push({ id, type: input.type, content: input.content });
      return {
        eventId: 20 + addedNodes.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
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
      input: {
        source: string;
        target: string;
        relation: string;
        direction?: string;
        creator: GraphNode['creator'];
      },
    ) => {
      addedEdges.push({ source: input.source, target: input.target, relation: input.relation });
      return {
        eventId: 30 + addedEdges.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
        payload: {
          type: 'edge_added' as const,
          edgeId: `edge-${addedEdges.length}`,
          edge: {
            id: `edge-${addedEdges.length}`,
            source: input.source,
            target: input.target,
            relation: input.relation as never,
            direction: (input.direction ?? 'source_to_target') as 'source_to_target',
            strength: 1,
            createdAt: '2026-04-03T10:00:00.000Z',
            creator: input.creator,
            metadata: {},
          },
        },
      };
    },
  };

  const service = new AgentsService(
    prisma as never,
    graph as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (service as unknown as {
    writeInputAsset: (
      sessionId: string,
      nodeId: string,
      part: unknown,
      buffer: Buffer,
    ) => Promise<void>;
  }).writeInputAsset = async () => {};
  (service as unknown as {
    createSpawn: (
      session: unknown,
      body: Record<string, unknown>,
      input: { runId?: string; executionId?: string; stepNodeId?: string | null },
    ) => Promise<{
      success: true;
      data: {
        agentRunId: string;
        rootNodeId: string;
        status: 'booting';
        wakeReason: 'external_event';
      };
    }>;
  }).createSpawn = async (
    _session: unknown,
    body: Record<string, unknown>,
    input: { runId?: string; executionId?: string; stepNodeId?: string | null },
  ) => {
    spawnBody = body;
    spawnRunId = String(input.runId);
    return {
      success: true,
      data: {
        agentRunId: String(input.runId),
        rootNodeId: 'spawn-1',
        status: 'booting',
        wakeReason: 'external_event',
      },
    };
  };

  return {
    service,
    addedNodes,
    addedEdges,
    readSpawnBody: () => spawnBody,
    readSpawnRunId: () => spawnRunId,
  };
}

function buildSpawnHarness(snapshot: GraphSnapshot) {
  const runs: Array<{ rootNodeId: string | null; triggerNodeId: string | null; stepNodeId: string | null }> = [];
  const executions: Array<{ triggerNodeId: string | null; stepNodeId: string | null }> = [];
  const starts: Array<{ ownerNodeId: string; triggerNodeId: string | null; stepNodeId: string | null }> = [];
  const service = new AgentsService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
      workflowExecution: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          executions.push({
            triggerNodeId: (data.triggerNodeId as string | null) ?? null,
            stepNodeId: (data.stepNodeId as string | null) ?? null,
          });
          return { id: data.id as string };
        },
        update: async () => ({}),
        findUnique: async () => null,
      },
      agentRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          runs.push({
            rootNodeId: (data.rootNodeId as string | null) ?? null,
            triggerNodeId: (data.triggerNodeId as string | null) ?? null,
            stepNodeId: (data.stepNodeId as string | null) ?? null,
          });
          return { id: data.id as string };
        },
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
    } as never,
    { emitSession: () => {} } as never,
    {} as never,
    {
      initializeRunArtifacts: async () => {},
      captureRunStart: async () => {},
    } as never,
    {} as never,
  );
  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      startExecutionRun: (input: {
        ownerNodeId: string;
        triggerNodeId?: string | null;
        stepNodeId?: string | null;
      }) => void;
    }
  ).startExecutionRun = (input) => {
    starts.push({
      ownerNodeId: input.ownerNodeId,
      triggerNodeId: input.triggerNodeId ?? null,
      stepNodeId: input.stepNodeId ?? null,
    });
  };
  return {
    service,
    runs,
    executions,
    starts,
  };
}

test('buildPrompt includes connected file summary context', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const prompt = (
    service as unknown as {
      buildPrompt: (nodes: GraphNode[], seedNodeIds: string[]) => string;
    }
  ).buildPrompt(
    [
      node({
        id: 'file-1',
        type: 'file_summary',
        creator: { type: 'human', userId: 'u1' },
        content: {
          status: 'done',
          summary: '# Combined\n- A short implementation plan.',
          generatedSummary: '# Combined\n- A short implementation plan.',
          files: [
            {
              id: 'plan-file',
              file: {
                name: 'plan.md',
                mimeType: 'text/markdown',
                size: 256,
                kind: 'text',
                uploadedAt: '2026-04-06T10:00:00.000Z',
                extension: '.md',
              },
              summary: 'A short implementation plan.',
              extractedText: '# Plan\nShip the uploader node.',
              extractedTextChars: 30,
              extractedTextTruncated: false,
              status: 'done',
            },
            {
              id: 'todo-file',
              file: {
                name: 'todo.txt',
                mimeType: 'text/plain',
                size: 64,
                kind: 'text',
                uploadedAt: '2026-04-06T10:02:00.000Z',
                extension: '.txt',
              },
              status: 'pending',
            },
          ],
        },
      }),
    ],
    ['file-1'],
  );

  assert.match(prompt, /\[Uploaded files context\]/);
  assert.match(prompt, /Combined summary:/);
  assert.match(prompt, /plan\.md/);
  assert.match(prompt, /A short implementation plan/);
  assert.match(prompt, /Ship the uploader node/);
  assert.match(prompt, /Status: pending/);
});

test('buildPrompt includes workspace file references and claim checks', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const prompt = (
    service as unknown as {
      buildPrompt: (nodes: GraphNode[], seedNodeIds: string[]) => string;
    }
  ).buildPrompt(
    [
      node({
        id: 'artifact-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Research brief',
          relativePath: '.cepage/workflow-inputs/brief/brief.md',
          role: 'input',
          origin: 'user_upload',
          kind: 'text',
          transferMode: 'claim_check',
          claimRef: 'artifact://run/run-1/.cepage%2Fworkflow-inputs%2Fbrief%2Fbrief.md',
          excerpt: 'Brief the agent on the target market.',
          status: 'available',
        },
      }),
    ],
    ['artifact-1'],
  );

  assert.match(prompt, /\[Workspace file: Research brief\]/);
  assert.match(prompt, /Path: \.cepage\/workflow-inputs\/brief\/brief\.md/);
  assert.match(prompt, /Transfer: claim_check/);
  assert.match(prompt, /Claim check: artifact:\/\/run\/run-1\//);
});

test('buildPrompt includes delegation lineage when a parent run exists', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const prompt = (
    service as unknown as {
      buildPrompt: (
        nodes: GraphNode[],
        seedNodeIds: string[],
        runId?: string,
        contract?: {
          phaseKind: 'agent_phase' | 'runtime_verify_phase';
          expectedOutputs: string[];
          validatorNodeId?: string;
        },
        kernel?: {
          delegation?: {
            parentRunId?: string;
            depth?: number;
            allowed?: boolean;
          };
        },
      ) => string;
    }
  ).buildPrompt([], [], undefined, undefined, {
    delegation: {
      parentRunId: 'run-parent-1',
      depth: 2,
      allowed: false,
    },
  });

  assert.match(prompt, /\[Delegation\]/);
  assert.match(prompt, /Parent run: run-parent-1/);
  assert.match(prompt, /Delegation depth: 2/);
  assert.match(prompt, /Nested delegation is disabled for this run/i);
});

test('buildPrompt resolves per-run workspace file outputs for the current run', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const runId = '550e8400-e29b-41d4-a716-446655440000';
  const prompt = (
    service as unknown as {
      buildPrompt: (nodes: GraphNode[], seedNodeIds: string[], runId?: string) => string;
    }
  ).buildPrompt(
    [
      node({
        id: 'artifact-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Research synthesis',
          relativePath: 'research/synthesis.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
    ],
    ['artifact-1'],
    runId,
  );

  assert.match(prompt, /Path: research\/run-550e8400\/synthesis\.md/);
  assert.match(prompt, /Template path: research\/synthesis\.md/);
  assert.match(prompt, /Path mode: per_run/);
});

test('buildPrompt includes workflow step brief metadata for agent steps', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const prompt = (
    service as unknown as {
      buildPrompt: (nodes: GraphNode[], seedNodeIds: string[]) => string;
    }
  ).buildPrompt(
    [
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
        metadata: {
          brief: 'Produce outputs/gap-report.json with an items array and a short summary.',
        },
      }),
    ],
    ['step-1'],
  );

  assert.match(prompt, /\[Workflow step brief\]/);
  assert.match(prompt, /Produce outputs\/gap-report\.json with an items array and a short summary\./);
});

test('buildPrompt appends the managed verify contract after the runtime manifest appendix', () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const prompt = (
    service as unknown as {
      buildPrompt: (
        nodes: GraphNode[],
        seedNodeIds: string[],
        runId?: string,
        contract?: {
          phaseKind: 'agent_phase' | 'runtime_verify_phase';
          expectedOutputs: string[];
          validatorNodeId?: string;
        },
      ) => string;
    }
  ).buildPrompt(
    [
      node({
        id: 'verify-step',
        type: 'runtime_target',
        creator: { type: 'human', userId: 'u1' },
        metadata: {
          brief: 'Verify the generated docs pack and write the final verification summary.',
        },
      }),
      node({
        id: 'verify-out',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Verify summary',
          relativePath: 'outputs/verify.txt',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'validator-1',
        type: 'decision',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'workspace_validator',
          requirements: ['Summarize the verification result in the output file.'],
          evidenceFrom: ['outputs/verify.txt'],
          checks: [
            {
              kind: 'file_last_line_equals',
              path: 'outputs/verify.txt',
              text: 'VERIFY_OK',
            },
          ],
          passAction: 'complete',
          failAction: 'retry_new_execution',
          blockAction: 'block',
        },
      }),
    ],
    ['verify-step'],
    undefined,
    {
      phaseKind: 'runtime_verify_phase',
      expectedOutputs: ['outputs/verify.txt'],
      validatorNodeId: 'validator-1',
    },
  );

  assert.match(prompt, /\[Workflow step brief\]/);
  assert.match(prompt, /Write or overwrite the required outputs in this run before finishing\./);
  assert.match(prompt, /outputs\/verify\.txt/);
  assert.match(prompt, /file_last_line_equals: outputs\/verify\.txt last non-empty line == "VERIFY_OK"/);
  assert.match(prompt, /Do not stop at analysis or background work/);
  assert.ok(prompt.indexOf('[Managed phase contract]') > prompt.indexOf('cepage-run.json'));
});

test('buildPromptParts only inlines context files for opencode', async () => {
  const service = new AgentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-agent-parts-'));
  await fs.mkdir(path.join(cwd, '.cepage/workflow-inputs/brief'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.cepage/workflow-inputs/brief/ctx.txt'), 'Ship the release notes.');
  await fs.writeFile(path.join(cwd, '.cepage/workflow-inputs/brief/claim.txt'), 'Keep this by reference.');

  try {
    const nodes = [
      node({
        id: 'input-1',
        type: 'input',
        creator: { type: 'system', reason: 'workflow-run' },
        content: {
          mode: 'bound',
          key: 'brief',
          label: 'Brief',
          runId: 'run-1',
          parts: [
            {
              id: 'ctx',
              type: 'file',
              file: {
                name: 'ctx.txt',
                mimeType: 'text/plain',
                size: 24,
                kind: 'text',
                uploadedAt: '2026-04-06T10:00:00.000Z',
                extension: '.txt',
              },
              relativePath: '.cepage/workflow-inputs/brief/ctx.txt',
              transferMode: 'context',
            },
            {
              id: 'claim',
              type: 'file',
              file: {
                name: 'claim.txt',
                mimeType: 'text/plain',
                size: 24,
                kind: 'text',
                uploadedAt: '2026-04-06T10:00:00.000Z',
                extension: '.txt',
              },
              relativePath: '.cepage/workflow-inputs/brief/claim.txt',
              transferMode: 'claim_check',
              claimRef: 'artifact://run/run-1/.cepage%2Fworkflow-inputs%2Fbrief%2Fclaim.txt',
            },
          ],
          summary: 'brief',
        },
      }),
    ];

    const opencodeParts = await (
      service as unknown as {
        buildPromptParts: (
          type: string,
          cwd: string,
          sessionId: string,
          nodes: GraphNode[],
          seedNodeIds: string[],
          promptText: string,
        ) => Promise<Array<{ type: string; url?: string }>>;
      }
    ).buildPromptParts('opencode', cwd, 'session-1', nodes, ['input-1'], 'Prompt text');
    assert.equal(opencodeParts.length, 2);
    assert.equal(opencodeParts[1]?.type, 'file');
    assert.match(String(opencodeParts[1]?.url ?? ''), /^data:text\/plain;base64,/);

    const codexParts = await (
      service as unknown as {
        buildPromptParts: (
          type: string,
          cwd: string,
          sessionId: string,
          nodes: GraphNode[],
          seedNodeIds: string[],
          promptText: string,
        ) => Promise<Array<{ type: string }>>;
      }
    ).buildPromptParts('codex', cwd, 'session-1', nodes, ['input-1'], 'Prompt text');
    assert.deepEqual(codexParts, [{ type: 'text', text: 'Prompt text' }]);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('runWorkflow materializes bound inputs and appends them to spawn context', async () => {
  const addedNodes: Array<{ content: GraphNode['content']; type: GraphNode['type']; id: string }> = [];
  const addedEdges: Array<{ source: string; target: string; relation: string }> = [];
  let spawnBody: Record<string, unknown> | null = null;
  let spawnRunId = '';

  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Implement the uploader workflow.' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'screenshots',
          label: 'Screenshots',
          accepts: ['image'],
          multiple: true,
          required: true,
          instructions: 'Attach the UI screenshots for this run.',
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowExecution: {
      findFirst: async () => null,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    addNode: async (
      _sessionId: string,
      input: {
        type: GraphNode['type'];
        content: GraphNode['content'];
        position: GraphNode['position'];
        creator: GraphNode['creator'];
      },
    ) => {
      const id = `bound-${addedNodes.length + 1}`;
      addedNodes.push({ id, type: input.type, content: input.content });
      return {
        eventId: 20 + addedNodes.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
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
      input: {
        source: string;
        target: string;
        relation: string;
        direction?: string;
        creator: GraphNode['creator'];
      },
    ) => {
      addedEdges.push({ source: input.source, target: input.target, relation: input.relation });
      return {
        eventId: 30 + addedEdges.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
        payload: {
          type: 'edge_added' as const,
          edgeId: `edge-${addedEdges.length}`,
          edge: {
            id: `edge-${addedEdges.length}`,
            source: input.source,
            target: input.target,
            relation: input.relation as never,
            direction: (input.direction ?? 'source_to_target') as 'source_to_target',
            strength: 1,
            createdAt: '2026-04-03T10:00:00.000Z',
            creator: input.creator,
            metadata: {},
          },
        },
      };
    },
  };

  const service = new AgentsService(
    prisma as never,
    graph as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (service as unknown as {
    writeInputAsset: (
      sessionId: string,
      nodeId: string,
      part: unknown,
      buffer: Buffer,
    ) => Promise<void>;
  }).writeInputAsset = async () => {};
  (service as unknown as {
    createSpawn: (
      session: unknown,
      body: Record<string, unknown>,
      input: { runId?: string; executionId?: string; stepNodeId?: string | null },
    ) => Promise<{
      success: true;
      data: {
        agentRunId: string;
        rootNodeId: string;
        status: 'booting';
        wakeReason: 'external_event';
      };
    }>;
  }).createSpawn = async (
    _session: unknown,
    body: Record<string, unknown>,
    input: { runId?: string; executionId?: string; stepNodeId?: string | null },
  ) => {
    spawnBody = body;
    spawnRunId = String(input.runId);
    return {
      success: true,
      data: {
        agentRunId: String(input.runId),
        rootNodeId: 'spawn-1',
        status: 'booting',
        wakeReason: 'external_event',
      },
    };
  };

  const res = await service.runWorkflow(
    'session-1',
    {
      type: 'opencode',
      role: 'builder',
      workingDirectory: '/tmp/demo',
      input: {
        parts: [{ type: 'text', text: 'Ship the workflow input support.' }],
      },
      inputs: {
        screenshots: {
          parts: [{ type: 'image', field: 'screens' }],
        },
      },
    },
    [
      {
        fieldname: 'screens',
        originalname: 'screen.png',
        mimetype: 'image/png',
        size: 24,
        buffer: Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex'),
      },
    ],
  );

  assert.equal(res.boundNodeIds.length, 2);
  assert.equal(res.agentRunId, spawnRunId);
  assert.equal(addedNodes.length, 3);
  assert.equal((addedNodes[0]?.content as { mode?: string }).mode, 'bound');
  assert.equal((addedNodes[1]?.content as { templateNodeId?: string }).templateNodeId, 'input-template-1');
  assert.equal(addedNodes[2]?.type, 'workspace_file');
  assert.match(
    String(((addedNodes[1]?.content as { parts?: Array<{ relativePath?: string }> }).parts?.[0]?.relativePath ?? '')),
    /^\.cepage\/workflow-inputs\/screenshots\//,
  );
  assert.match(
    String(((addedNodes[2]?.content as { relativePath?: string }).relativePath ?? '')),
    /^\.cepage\/workflow-inputs\/screenshots\//,
  );
  assert.equal(
    addedEdges.some((edge) => edge.source === 'input-template-1' && edge.target === 'bound-2' && edge.relation === 'derived_from'),
    true,
  );
  assert.equal(
    addedEdges.some((edge) => edge.source === 'bound-2' && edge.target === 'bound-3' && edge.relation === 'contains'),
    true,
  );
  assert.deepEqual((spawnBody as unknown as { seedNodeIds?: unknown } | null)?.seedNodeIds, [
    'note-1',
    'input-template-1',
    'bound-1',
    'bound-2',
    'bound-3',
  ]);
});

test('startInputNode creates the targeted bound input and reuses latest sibling bounds', async () => {
  const addedNodes: Array<{ content: GraphNode['content']; type: GraphNode['type']; id: string }> = [];
  const addedEdges: Array<{ source: string; target: string; relation: string }> = [];
  let spawnBody: Record<string, unknown> | null = null;
  let spawnRunId = '';

  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Release workflow' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief',
          label: 'Brief',
          accepts: ['text'],
          multiple: false,
          required: true,
        },
      }),
      node({
        id: 'input-template-2',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'screenshots',
          label: 'Screenshots',
          accepts: ['image'],
          multiple: true,
          required: true,
        },
      }),
      node({
        id: 'bound-existing',
        type: 'input',
        creator: { type: 'system', reason: 'workflow-run' },
        updatedAt: '2026-04-04T10:00:00.000Z',
        content: {
          mode: 'bound',
          key: 'screenshots',
          label: 'Screenshots',
          templateNodeId: 'input-template-2',
          runId: 'run-prev',
          parts: [
            {
              id: 'part-1',
              type: 'image',
              file: {
                name: 'screen.png',
                mimeType: 'image/png',
                size: 24,
                kind: 'image',
                uploadedAt: '2026-04-04T10:00:00.000Z',
                width: 10,
                height: 10,
              },
            },
          ],
          summary: 'screen.png',
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'note-1',
        target: 'input-template-2',
        relation: 'references',
        direction: 'source_to_target',
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
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowExecution: {
      findFirst: async () => null,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    addNode: async (
      _sessionId: string,
      input: {
        type: GraphNode['type'];
        content: GraphNode['content'];
        position: GraphNode['position'];
        creator: GraphNode['creator'];
      },
    ) => {
      const id = `bound-${addedNodes.length + 1}`;
      addedNodes.push({ id, type: input.type, content: input.content });
      return {
        eventId: 20 + addedNodes.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
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
      input: {
        source: string;
        target: string;
        relation: string;
        direction?: string;
        creator: GraphNode['creator'];
      },
    ) => {
      addedEdges.push({ source: input.source, target: input.target, relation: input.relation });
      return {
        eventId: 30 + addedEdges.length,
        sessionId: 'session-1',
        actor: input.creator,
        timestamp: new Date().toISOString(),
        payload: {
          type: 'edge_added' as const,
          edgeId: `edge-${addedEdges.length}`,
          edge: {
            id: `edge-${addedEdges.length}`,
            source: input.source,
            target: input.target,
            relation: input.relation as never,
            direction: (input.direction ?? 'source_to_target') as 'source_to_target',
            strength: 1,
            createdAt: '2026-04-03T10:00:00.000Z',
            creator: input.creator,
            metadata: {},
          },
        },
      };
    },
  };

  const service = new AgentsService(
    prisma as never,
    graph as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (service as unknown as {
    writeInputAsset: (
      sessionId: string,
      nodeId: string,
      part: unknown,
      buffer: Buffer,
    ) => Promise<void>;
  }).writeInputAsset = async () => {};
  (service as unknown as {
    createSpawn: (
      session: unknown,
      body: Record<string, unknown>,
      input: { runId?: string; executionId?: string; stepNodeId?: string | null },
    ) => Promise<{
      success: true;
      data: {
        agentRunId: string;
        rootNodeId: string;
        status: 'booting';
        wakeReason: 'external_event';
      };
    }>;
  }).createSpawn = async (
    _session: unknown,
    body: Record<string, unknown>,
    input: { runId?: string; executionId?: string; stepNodeId?: string | null },
  ) => {
    spawnBody = body;
    spawnRunId = String(input.runId);
    return {
      success: true,
      data: {
        agentRunId: String(input.runId),
        rootNodeId: 'spawn-1',
        status: 'booting',
        wakeReason: 'external_event',
      },
    };
  };

  const res = await service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
    input: {
      parts: [{ type: 'text', text: 'Prepare the release notes.' }],
    },
  });

  assert.equal(res.agentRunId, spawnRunId);
  assert.deepEqual(res.boundNodeIds, ['bound-1']);
  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.deepEqual(res.reusedBoundNodeIds, ['bound-existing']);
  assert.equal(addedNodes.length, 1);
  assert.equal((addedNodes[0]?.content as { templateNodeId?: string }).templateNodeId, 'input-template-1');
  assert.equal(addedEdges[0]?.source, 'input-template-1');
  assert.equal(addedEdges[0]?.relation, 'derived_from');
  assert.deepEqual((spawnBody as unknown as { seedNodeIds?: unknown } | null)?.seedNodeIds, [
    'note-1',
    'input-template-1',
    'input-template-2',
    'bound-1',
    'bound-existing',
  ]);
});

test('startInputNode splits multiline text for multiple text inputs', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Chunk workflow' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'chunks',
          label: 'Chunks',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);
  const res = await harness.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
    input: {
      parts: [{ type: 'text', text: 'Chunk A\n- Chunk B\n3. Chunk C' }],
    },
  });

  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.deepEqual(
    ((harness.addedNodes[0]?.content as { parts?: Array<{ text?: string }> }).parts ?? []).map((part) => part.text),
    ['Chunk A', 'Chunk B', 'Chunk C'],
  );
});

test('startInputNode rejects runs when a required sibling input has no bound value', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Workflow start' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief',
          label: 'Brief',
          accepts: ['text'],
          multiple: false,
          required: false,
        },
      }),
      node({
        id: 'input-template-2',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'screenshots',
          label: 'Screenshots',
          accepts: ['image'],
          multiple: true,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'note-1',
        target: 'input-template-2',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);

  await assert.rejects(
    () =>
      harness.service.startInputNode('session-1', 'input-template-1', {
        type: 'opencode',
        role: 'builder',
        workingDirectory: '/tmp/demo',
      }),
    /WORKFLOW_INPUT_REQUIRED:screenshots/,
  );
});

test('startInputNode infers a required text input from one linked note', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Use this linked brief.', format: 'markdown' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief',
          label: 'Brief',
          accepts: ['text'],
          multiple: false,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);
  const res = await harness.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
  });

  assert.equal(res.agentRunId, harness.readSpawnRunId());
  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.deepEqual(res.boundNodeIds, ['bound-1']);
  assert.equal(
    ((harness.addedNodes[0]?.content as { parts?: Array<{ type?: string; text?: string }> }).parts?.[0]?.text),
    'Use this linked brief.',
  );
  assert.equal(
    harness.addedEdges.some(
      (edge) => edge.source === 'note-1' && edge.target === 'bound-1' && edge.relation === 'derived_from',
    ),
    true,
  );
});

test('startInputNode can bind a linked workspace_file without creating a duplicate file node', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'artifact-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Research brief',
          relativePath: 'inputs/research-brief.md',
          role: 'input',
          origin: 'workspace_existing',
          kind: 'text',
          transferMode: 'claim_check',
          claimRef: 'artifact://run/run-prev/inputs%2Fresearch-brief.md',
          summary: 'Existing workspace brief',
          status: 'available',
        },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief_file',
          label: 'Brief file',
          accepts: ['file'],
          multiple: false,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'artifact-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);
  const res = await harness.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
  });

  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.equal(harness.addedNodes.length, 1);
  assert.deepEqual(
    (harness.addedNodes[0]?.content as {
      parts?: Array<{ type?: string; relativePath?: string; workspaceFileNodeId?: string; claimRef?: string }>;
    }).parts?.[0],
    {
      id: (harness.addedNodes[0]?.content as { parts?: Array<{ id?: string }> }).parts?.[0]?.id,
      type: 'file',
      relativePath: 'inputs/research-brief.md',
      workspaceFileNodeId: 'artifact-1',
      claimRef: 'artifact://run/run-prev/inputs%2Fresearch-brief.md',
      file: (harness.addedNodes[0]?.content as { parts?: Array<{ file?: unknown }> }).parts?.[0]?.file,
      transferMode: 'claim_check',
      extractedText: 'Existing workspace brief',
    },
  );
});

test('startInputNode prefers a workspace file resolved path when binding linked artifacts', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'artifact-1',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Research brief',
          relativePath: 'inputs/research-brief.md',
          resolvedRelativePath: 'inputs/run-550e8400/research-brief.md',
          pathMode: 'per_run',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'claim_check',
          sourceRunId: '550e8400-e29b-41d4-a716-446655440000',
          summary: 'Existing workspace brief',
          status: 'available',
        },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief_file',
          label: 'Brief file',
          accepts: ['file'],
          multiple: false,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'artifact-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);
  await harness.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
  });

  assert.deepEqual(
    (harness.addedNodes[0]?.content as {
      parts?: Array<{ type?: string; relativePath?: string; workspaceFileNodeId?: string; claimRef?: string }>;
    }).parts?.[0],
    {
      id: (harness.addedNodes[0]?.content as { parts?: Array<{ id?: string }> }).parts?.[0]?.id,
      type: 'file',
      relativePath: 'inputs/run-550e8400/research-brief.md',
      workspaceFileNodeId: 'artifact-1',
      claimRef: 'artifact://run/550e8400-e29b-41d4-a716-446655440000/inputs%2Frun-550e8400%2Fresearch-brief.md',
      file: (harness.addedNodes[0]?.content as { parts?: Array<{ file?: unknown }> }).parts?.[0]?.file,
      transferMode: 'claim_check',
      extractedText: 'Existing workspace brief',
    },
  );
});

test('startInputNode can bind linked agent output text', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'agent-output-1',
        type: 'agent_output',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        content: { output: 'Summarize the last customer interview.' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief',
          label: 'Brief',
          accepts: ['text'],
          multiple: false,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'agent-output-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const harness = buildStartInputHarness(snapshot);
  const res = await harness.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
  });

  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.equal(
    ((harness.addedNodes[0]?.content as { parts?: Array<{ text?: string }> }).parts?.[0]?.text),
    'Summarize the last customer interview.',
  );
});

test('startInputNode requires an explicit choice when several linked parents match', async () => {
  const snapshot: GraphSnapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'note-1',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'First brief', format: 'markdown' },
      }),
      node({
        id: 'agent-output-1',
        type: 'agent_output',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        content: { output: 'Second brief' },
      }),
      node({
        id: 'input-template-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'brief',
          label: 'Brief',
          accepts: ['text'],
          multiple: false,
          required: true,
        },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'agent-output-1',
        target: 'input-template-1',
        relation: 'references',
        direction: 'source_to_target' as const,
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' } as const,
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const blocked = buildStartInputHarness(snapshot);
  await assert.rejects(
    () =>
      blocked.service.startInputNode('session-1', 'input-template-1', {
        type: 'opencode',
        role: 'builder',
        workingDirectory: '/tmp/demo',
      }),
    /WORKFLOW_INPUT_REQUIRED:brief/,
  );

  const selected = buildStartInputHarness(snapshot);
  const res = await selected.service.startInputNode('session-1', 'input-template-1', {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/tmp/demo',
    sourceNodeIds: ['agent-output-1'],
  });

  assert.equal(res.createdBoundNodeId, 'bound-1');
  assert.equal(
    ((selected.addedNodes[0]?.content as { parts?: Array<{ text?: string }> }).parts?.[0]?.text),
    'Second brief',
  );
});

test('rerun reuses the existing run nodes and clears stale state first', async () => {
  const updates: unknown[] = [];
  const patched: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const removed: string[] = [];
  const emitted: Array<Record<string, unknown>> = [];
  const initCalls: unknown[][] = [];
  const captureCalls: unknown[][] = [];
  const runtimeClears: Array<{ sessionId: string; runId: string }> = [];
  const starts: Array<{
    rootNodeId?: string;
    outputNodeId?: string;
    promptText?: string;
  }> = [];
  let aborted = false;
  let nextEventId = 40;

  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [
      node({
        id: 'human-1',
        type: 'human_message',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'Ship the board rerun flow.' },
        position: { x: 60, y: 160 },
      }),
      node({
        id: 'spawn-1',
        type: 'agent_spawn',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        content: {
          agentType: 'opencode',
          model: {
            providerID: 'anthropic',
            modelID: 'claude-4.5-sonnet',
          },
          config: {
            workingDirectory: '/tmp/work',
            contextNodeIds: ['human-1'],
            triggerNodeId: 'human-1',
          },
        },
        position: { x: 320, y: 120 },
      }),
      node({
        id: 'output-1',
        type: 'agent_output',
        creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' },
        content: {
          output: 'old output',
          outputType: 'stdout',
          isStreaming: false,
        },
        position: { x: 520, y: 120 },
      }),
      node({
        id: 'msg-1',
        type: 'system_message',
        creator: { type: 'system', reason: 'opencode-run' },
        content: { text: 'old failure', level: 'error' },
        metadata: { agentRunId: 'run-1' },
      }),
      node({
        id: 'msg-2',
        type: 'system_message',
        creator: { type: 'system', reason: 'opencode-run' },
        content: { text: 'keep me', level: 'error' },
        metadata: { agentRunId: 'run-2' },
      }),
    ],
    edges: [
      { id: 'edge-1', source: 'human-1', target: 'spawn-1', relation: 'spawns', direction: 'source_to_target', strength: 1, createdAt: '2026-04-03T10:00:00.000Z', creator: { type: 'human', userId: 'u1' }, metadata: {} },
      { id: 'edge-2', source: 'spawn-1', target: 'output-1', relation: 'produces', direction: 'source_to_target', strength: 1, createdAt: '2026-04-03T10:00:00.000Z', creator: { type: 'agent', agentType: 'opencode', agentId: 'run-1' }, metadata: {} },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prisma = {
    agentRun: {
      findFirst: async () => ({
        id: 'run-1',
        sessionId: 'session-1',
        agentType: 'opencode',
        role: 'builder',
        status: 'running',
        wakeReason: 'human_prompt',
        runtime: { kind: 'local_process', cwd: '/tmp/work' },
        seedNodeIds: ['human-1'],
        rootNodeId: 'spawn-1',
        modelProviderId: 'anthropic',
        modelId: 'claude-4.5-sonnet',
      }),
      update: async ({ data }: { data: unknown }) => {
        updates.push(data);
        return data;
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (
      _sessionId: string,
      nodeId: string,
      patch: Record<string, unknown>,
    ) => {
      patched.push({ nodeId, patch });
      nextEventId += 1;
      return {
        eventId: nextEventId,
        sessionId: 'session-1',
        actor: { type: 'system', reason: 'test' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_updated' as const, nodeId, patch },
      };
    },
    removeNode: async (_sessionId: string, nodeId: string) => {
      removed.push(nodeId);
      nextEventId += 1;
      return {
        eventId: nextEventId,
        sessionId: 'session-1',
        actor: { type: 'system', reason: 'agent-rerun' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_removed' as const, nodeId, affectedEdges: [] },
      };
    },
  };

  const collaboration = {
    emitSession: (_sessionId: string, event: Record<string, unknown>) => {
      emitted.push(event);
    },
  };
  const activity = {};
  const artifacts = {
    initializeRunArtifacts: async (...args: unknown[]) => {
      initCalls.push(args);
    },
    captureRunStart: async (...args: unknown[]) => {
      captureCalls.push(args);
    },
  };
  const runtime = {
    clearAgentRun: async (sessionId: string, runId: string) => {
      runtimeClears.push({ sessionId, runId });
    },
  };

  const service = new AgentsService(
    prisma as never,
    graph as never,
    collaboration as never,
    activity as never,
    artifacts as never,
    runtime as never,
  );

  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (service as unknown as {
    startRun: (input: { rootNodeId?: string; outputNodeId?: string; promptText?: string }) => void;
  }).startRun = (input: { rootNodeId?: string; outputNodeId?: string; promptText?: string }) => {
    starts.push(input);
  };
  (service as unknown as { abortByRun: Map<string, { abort: () => void }> }).abortByRun.set('run-1', {
    abort: () => {
      aborted = true;
    },
  });
  (service as unknown as { runJobByRun: Map<string, Promise<void>> }).runJobByRun.set(
    'run-1',
    Promise.resolve(),
  );

  const res = await service.rerun('session-1', 'run-1', {
    type: 'cursor_agent',
    model: {
      providerID: 'openai',
      modelID: 'gpt-5.4-medium',
    },
  });

  assert.equal(aborted, true);
  assert.deepEqual(runtimeClears, [{ sessionId: 'session-1', runId: 'run-1' }]);
  assert.deepEqual(removed, ['msg-1']);
  assert.equal(res.data.agentRunId, 'run-1');
  assert.equal(res.data.rootNodeId, 'spawn-1');
  assert.equal(patched[0]?.nodeId, 'spawn-1');
  assert.equal((patched[0]?.patch.content as { agentType?: string }).agentType, 'cursor_agent');
  assert.equal(patched[1]?.nodeId, 'output-1');
  assert.equal((patched[1]?.patch.content as { output?: string }).output, '');
  assert.equal(initCalls[0]?.[3], 'output-1');
  assert.equal(captureCalls[0]?.[0], 'run-1');
  const start = starts[0];
  if (!start) {
    throw new Error('startRun was not called');
  }
  assert.equal(start.rootNodeId, 'spawn-1');
  assert.equal(start.outputNodeId, 'output-1');
  assert.match(String(start.promptText), /Ship the board rerun flow/);
  assert.equal(emitted[0]?.type, 'agent.status');
  assert.equal((emitted[0]?.payload as { status?: string }).status, 'booting');
  assert.equal((updates[0] as { agentType?: string }).agentType, 'cursor_agent');
  assert.equal((updates[0] as { status?: string }).status, 'booting');
  assert.equal((updates[0] as { wakeReason?: string }).wakeReason, 'manual');
  assert.deepEqual((updates[0] as { runtime?: unknown }).runtime, {
    kind: 'local_process',
    cwd: '/tmp/work',
  });
  assert.ok((updates[0] as { startedAt?: Date }).startedAt instanceof Date);
  assert.equal((updates[0] as { endedAt?: null }).endedAt, null);
  assert.deepEqual((updates[0] as { seedNodeIds?: unknown }).seedNodeIds, ['human-1']);
  assert.equal((updates[0] as { modelProviderId?: string | null }).modelProviderId, 'openai');
  assert.equal((updates[0] as { modelId?: string | null }).modelId, 'gpt-5.4-medium');
  assert.equal((updates[0] as { externalSessionId?: null }).externalSessionId, null);
});

test('rerun creates a new execution-backed attempt without requiring legacy output nodes', async () => {
  const createSpawnCalls: Array<{
    body: Record<string, unknown>;
    input: { runId?: string; executionId?: string; stepNodeId?: string | null; retryOfRunId?: string | null };
  }> = [];
  const runtimeClears: Array<{ sessionId: string; runId: string }> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
  };
  const graph = {};
  const collaboration = {};
  const activity = {};
  const artifacts = {};
  const runtime = {
    clearAgentRun: async (sessionId: string, runId: string) => {
      runtimeClears.push({ sessionId, runId });
    },
  };

  const service = new AgentsService(
    prisma as never,
    graph as never,
    collaboration as never,
    activity as never,
    artifacts as never,
    runtime as never,
  );

  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      loadRunState: (sessionId: string, runId: string) => Promise<unknown>;
    }
  ).loadRunState = async () => ({
    run: {
      id: 'run-1',
      sessionId: 'session-1',
      executionId: 'exec-1',
      requestId: 'req-1',
      agentType: 'opencode',
      role: 'builder',
      status: 'completed',
      wakeReason: 'manual',
      runtime: { kind: 'local_process', cwd: '/tmp/work' },
      seedNodeIds: ['input-1'],
      rootNodeId: 'step-1',
      triggerNodeId: 'input-1',
      stepNodeId: 'step-1',
      modelProviderId: 'openai',
      modelId: 'gpt-5.4',
    },
    snapshot: {
      version: 1,
      id: 'session-1',
      createdAt: '2026-04-03T10:00:00.000Z',
      lastEventId: 0,
      nodes: [
        node({
          id: 'input-1',
          type: 'input',
          creator: { type: 'human', userId: 'u1' },
          content: { mode: 'template', key: 'brief', label: 'Brief', accepts: ['text'] },
        }),
        node({
          id: 'step-1',
          type: 'agent_step',
          creator: { type: 'human', userId: 'u1' },
          content: { agentType: 'opencode' },
        }),
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'input-1',
          target: 'step-1',
          relation: 'feeds_into',
          direction: 'source_to_target' as const,
          strength: 1,
          createdAt: '2026-04-03T10:00:00.000Z',
          creator: { type: 'human', userId: 'u1' },
          metadata: {},
        },
      ],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    rootNode: node({
      id: 'step-1',
      type: 'agent_step',
      creator: { type: 'human', userId: 'u1' },
      content: { agentType: 'opencode' },
    }),
    outputNode: null,
    seedNodeIds: ['input-1'],
    triggerNode: node({
      id: 'input-1',
      type: 'input',
      creator: { type: 'human', userId: 'u1' },
      content: { mode: 'template', key: 'brief', label: 'Brief', accepts: ['text'] },
    }),
    cwd: '/tmp/work',
    errorPosition: { x: 0, y: 0 },
  });
  (
    service as unknown as {
      createSpawn: (
        session: unknown,
        body: Record<string, unknown>,
        input: { runId?: string; executionId?: string; stepNodeId?: string | null; retryOfRunId?: string | null },
      ) => Promise<{
        success: true;
        data: {
          agentRunId: string;
          rootNodeId: string;
          status: 'booting';
          wakeReason: 'manual';
        };
      }>;
    }
  ).createSpawn = async (_session, body, input) => {
    createSpawnCalls.push({ body, input });
    return {
      success: true,
      data: {
        agentRunId: String(input.runId),
        rootNodeId: 'step-1',
        status: 'booting',
        wakeReason: 'manual',
      },
    };
  };

  const res = await service.rerun(
    'session-1',
    'run-1',
    {
      type: 'cursor_agent',
      model: {
        providerID: 'openai',
        modelID: 'gpt-5.4-medium',
      },
      requestId: 'req-rerun',
      newExecution: true,
    },
    {
      runId: 'run-override',
    },
  );

  assert.equal(res.success, true);
  assert.equal(createSpawnCalls.length, 1);
  assert.deepEqual(runtimeClears, []);
  assert.equal(createSpawnCalls[0]?.body.requestId, 'req-rerun');
  assert.equal(createSpawnCalls[0]?.body.type, 'cursor_agent');
  assert.equal(createSpawnCalls[0]?.body.triggerNodeId, 'input-1');
  assert.equal(createSpawnCalls[0]?.body.newExecution, true);
  assert.equal(createSpawnCalls[0]?.input.retryOfRunId, 'run-1');
  assert.equal(createSpawnCalls[0]?.input.stepNodeId, 'step-1');
  assert.equal(createSpawnCalls[0]?.input.runId, 'run-override');
  assert.notEqual(createSpawnCalls[0]?.input.executionId, 'exec-1');
  assert.equal(res.data.rootNodeId, 'step-1');
});

test('runWorkflow rejects loop components that must start via the controller', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loop-run-'));
  const snapshot: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: { kind: 'input_parts', templateNodeId: 'input-1' },
          bodyNodeId: 'body-1',
        },
      }),
      node({
        id: 'body-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          entryNodeId: 'step-1',
        },
      }),
      node({
        id: 'input-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: { mode: 'template', key: 'chunks', label: 'Chunks', accepts: ['text'], multiple: true },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'loop-1',
        target: 'body-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'body-1',
        target: 'step-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-3',
        source: 'input-1',
        target: 'step-1',
        relation: 'feeds_into',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let createSpawnCalled = false;
  const service = new AgentsService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      createSpawn: (
        session: unknown,
        body: Record<string, unknown>,
        input: { runId?: string; executionId?: string; stepNodeId?: string | null },
      ) => Promise<unknown>;
    }
  ).createSpawn = async () => {
    createSpawnCalled = true;
    return {
      success: true,
      data: {
        agentRunId: 'run-1',
        rootNodeId: 'step-1',
        status: 'booting',
        wakeReason: 'manual',
      },
    };
  };

  await assert.rejects(
    () =>
      service.runWorkflow('session-1', {
        type: 'opencode',
        role: 'builder',
        workingDirectory: cwd,
        triggerNodeId: 'step-1',
      }),
    /WORKFLOW_LOOP_USE_CONTROLLER/,
  );
  assert.equal(createSpawnCalled, false);
});

test('spawn rejects direct runs inside loop components', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loop-spawn-'));
  const snapshot: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'body-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'loop-1',
        target: 'body-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'body-1',
        target: 'step-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let createSpawnCalled = false;
  const service = new AgentsService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      createSpawn: (session: unknown, body: Record<string, unknown>) => Promise<unknown>;
    }
  ).createSpawn = async () => {
    createSpawnCalled = true;
    return {
      success: true,
      data: {
        agentRunId: 'run-1',
        rootNodeId: 'step-1',
        status: 'booting',
        wakeReason: 'manual',
      },
    };
  };

  await assert.rejects(
    () =>
      service.spawn('session-1', {
        type: 'opencode',
        role: 'builder',
        runtime: { kind: 'local_process', cwd },
        workingDirectory: cwd,
        triggerNodeId: 'step-1',
        wakeReason: 'manual',
        seedNodeIds: ['step-1'],
      }),
    /WORKFLOW_LOOP_USE_CONTROLLER/,
  );
  assert.equal(createSpawnCalled, false);
});

test('spawn allows orchestrated runs inside loop components when explicitly flagged', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loop-orchestrated-'));
  const snapshot: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'body-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'step-1',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'loop-1',
        target: 'body-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'body-1',
        target: 'step-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let createSpawnCalled = false;
  const service = new AgentsService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
    } as never,
    {
      loadSnapshot: async () => snapshot,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      createSpawn: (session: unknown, body: Record<string, unknown>) => Promise<{
        success: true;
        data: {
          agentRunId: string;
          rootNodeId: string;
          status: 'booting';
          wakeReason: 'manual';
        };
      }>;
    }
  ).createSpawn = async () => {
    createSpawnCalled = true;
    return {
      success: true,
      data: {
        agentRunId: 'run-1',
        rootNodeId: 'step-1',
        status: 'booting',
        wakeReason: 'manual',
      },
    };
  };

  const res = await service.spawn(
    'session-1',
    {
      type: 'opencode',
      role: 'builder',
      runtime: { kind: 'local_process', cwd },
      workingDirectory: cwd,
      triggerNodeId: 'step-1',
      wakeReason: 'manual',
      seedNodeIds: ['step-1'],
    },
    { allowLoopChildRun: true },
  );

  assert.equal(createSpawnCalled, true);
  assert.equal(res.success, true);
});

test('spawn still allows controller child runs inside loop components', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loop-child-'));
  let createSpawnCalled = false;
  const service = new AgentsService(
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: null,
          workspaceDirectoryName: null,
        }),
      },
    } as never,
    {
      loadSnapshot: async () => {
        throw new Error('snapshot should not be loaded for controller child runs');
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { ensureAdapterAvailable: (type: string) => Promise<void> }).ensureAdapterAvailable =
    async () => {};
  (
    service as unknown as {
      createSpawn: (
        session: unknown,
        body: Record<string, unknown>,
      ) => Promise<{
        success: true;
        data: {
          agentRunId: string;
          rootNodeId: string;
          status: 'booting';
          wakeReason: 'manual';
        };
      }>;
    }
  ).createSpawn = async () => {
    createSpawnCalled = true;
    return {
      success: true,
      data: {
        agentRunId: 'run-1',
        rootNodeId: 'step-1',
        status: 'booting',
        wakeReason: 'manual',
      },
    };
  };

  const res = await service.spawn('session-1', {
    type: 'opencode',
    role: 'builder',
    runtime: { kind: 'local_process', cwd },
    workingDirectory: cwd,
    triggerNodeId: 'step-1',
    wakeReason: 'manual',
    seedNodeIds: ['step-1'],
    parentExecutionId: 'exec-controller',
  });

  assert.equal(createSpawnCalled, true);
  assert.equal(res.success, true);
});

test('spawn resolves a loop child subgraph to its entry step before orchestration links', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loop-managed-'));
  t.after(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const harness = buildSpawnHarness({
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: { kind: 'input_parts', templateNodeId: 'input-1' },
          bodyNodeId: 'body-1',
        },
      }),
      node({
        id: 'body-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
          entryNodeId: 'step-dev',
        },
      }),
      node({
        id: 'step-dev',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
      }),
      node({
        id: 'flow-1',
        type: 'managed_flow',
        creator: { type: 'human', userId: 'u1' },
        content: {},
      }),
      node({
        id: 'step-review',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'loop-1',
        target: 'body-1',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'body-1',
        target: 'step-dev',
        relation: 'contains',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-3',
        source: 'flow-1',
        target: 'loop-1',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-4',
        source: 'flow-1',
        target: 'step-review',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  const res = await harness.service.spawn('session-1', {
    type: 'cursor_agent',
    role: 'builder',
    runtime: { kind: 'local_process', cwd },
    workingDirectory: cwd,
    triggerNodeId: 'body-1',
    wakeReason: 'manual',
    seedNodeIds: ['body-1'],
    parentExecutionId: 'exec-parent',
    newExecution: true,
  });

  assert.equal(res.success, true);
  assert.equal(harness.executions[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.runs[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.runs[0]?.rootNodeId, 'step-dev');
  assert.equal(harness.starts[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.starts[0]?.ownerNodeId, 'step-dev');
});

test('spawn resolves a managed_flow to its loop child step without canvas helper edges', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-managed-ref-'));
  t.after(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const harness = buildSpawnHarness({
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'input-1',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'slices',
          label: 'Slices',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      }),
      node({
        id: 'loop-1',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: { kind: 'input_parts', templateNodeId: 'input-1' },
          bodyNodeId: 'body-1',
        },
      }),
      node({
        id: 'body-1',
        type: 'sub_graph',
        creator: { type: 'human', userId: 'u1' },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
          entryNodeId: 'step-dev',
        },
      }),
      node({
        id: 'step-dev',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
      }),
      node({
        id: 'flow-1',
        type: 'managed_flow',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Main flow',
          syncMode: 'managed',
          entryPhaseId: 'dev',
          phases: [
            {
              id: 'dev',
              kind: 'loop_phase',
              nodeId: 'loop-1',
            },
          ],
        },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  const res = await harness.service.spawn('session-1', {
    type: 'cursor_agent',
    role: 'builder',
    runtime: { kind: 'local_process', cwd },
    workingDirectory: cwd,
    triggerNodeId: 'flow-1',
    wakeReason: 'manual',
    seedNodeIds: ['flow-1'],
    parentExecutionId: 'exec-parent',
    newExecution: true,
  });

  assert.equal(res.success, true);
  assert.equal(harness.executions[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.runs[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.starts[0]?.ownerNodeId, 'step-dev');
});

test('spawn resolves a runtime target to its output step before orchestration links', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-runtime-managed-'));
  t.after(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const harness = buildSpawnHarness({
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 0,
    nodes: [
      node({
        id: 'step-dev',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
      }),
      node({
        id: 'runtime-1',
        type: 'runtime_target',
        creator: { type: 'system', reason: 'runtime-target' },
        content: {
          targetNodeId: 'runtime-1',
          outputNodeId: 'step-dev',
          kind: 'web',
          launchMode: 'local_process',
          serviceName: 'web',
          cwd,
        },
      }),
      node({
        id: 'flow-1',
        type: 'managed_flow',
        creator: { type: 'human', userId: 'u1' },
        content: {},
      }),
      node({
        id: 'step-review',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'cursor_agent' },
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'step-dev',
        target: 'runtime-1',
        relation: 'produces',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-2',
        source: 'flow-1',
        target: 'runtime-1',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
      {
        id: 'edge-3',
        source: 'flow-1',
        target: 'step-review',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:00:00.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  const res = await harness.service.spawn('session-1', {
    type: 'cursor_agent',
    role: 'builder',
    runtime: { kind: 'local_process', cwd },
    workingDirectory: cwd,
    triggerNodeId: 'runtime-1',
    wakeReason: 'manual',
    seedNodeIds: ['runtime-1'],
    parentExecutionId: 'exec-parent',
    newExecution: true,
  });

  assert.equal(res.success, true);
  assert.equal(harness.executions[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.runs[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.runs[0]?.rootNodeId, 'step-dev');
  assert.equal(harness.starts[0]?.stepNodeId, 'step-dev');
  assert.equal(harness.starts[0]?.ownerNodeId, 'step-dev');
});
