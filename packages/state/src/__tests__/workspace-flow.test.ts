import assert from 'node:assert/strict';
import test from 'node:test';
import type { Edge } from '@xyflow/react';
import type { GraphNode } from '@cepage/shared-core';
import { createInputStartStateCache } from '../input-start-cache.js';
import { toFlowNode } from '../workspace-flow.js';
import { evaluateInputTemplateStartState, readInputTemplateStartState } from '../workflow-input-start.js';

function makeNode(
  type: GraphNode['type'],
  metadata: Record<string, unknown> = {},
  content?: GraphNode['content'],
): GraphNode {
  return {
    id: `${type}-1`,
    type,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    content:
      content ??
      (type === 'agent_output'
        ? { output: '# Preview ready' }
        : type === 'agent_spawn'
          ? { agentType: 'opencode', config: { workingDirectory: '/tmp/demo', contextNodeIds: ['a', 'b'] } }
          : { text: 'hello' }),
    creator: { type: 'human', userId: 'user-1' },
    position: { x: 120, y: 240 },
    dimensions: { width: 280, height: 120 },
    metadata,
    status: 'active',
    branches: [],
  };
}

test('toFlowNode maps agent output nodes to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('agent_output', {
      artifacts: {
        runId: 'run-1',
        outputNodeId: 'agent_output-1',
        cwd: '/tmp/demo',
        generatedAt: '2026-04-03T00:01:00.000Z',
        counts: { added: 1, modified: 2, deleted: 0, total: 3 },
        files: [{ path: 'index.html', kind: 'added' }],
        preview: { status: 'available', strategy: 'static' },
      },
    }),
  );

  assert.equal(flow.type, 'agentOutput');
  assert.equal(flow.data.artifacts?.counts.total, 3);
});

test('toFlowNode keeps spawn nodes on the editable renderer', () => {
  const flow = toFlowNode(makeNode('agent_spawn'));
  assert.equal(flow.type, 'editableText');
  assert.match(flow.data.text, /cwd: \/tmp\/demo/);
});

test('toFlowNode maps runtime targets to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('runtime_target', {
      runtimeTarget: {
        targetNodeId: 'runtime-target-1',
        sourceRunId: 'run-1',
        outputNodeId: 'agent_output-1',
        kind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/demo/apps/web',
        command: 'pnpm',
        args: ['run', 'dev'],
        ports: [{ name: 'http', port: 0, protocol: 'http' }],
        preview: { mode: 'server', port: 0 },
        autoRun: true,
        source: 'file',
      },
    }),
  );

  assert.equal(flow.type, 'runtimeTarget');
  assert.equal(flow.data.runtimeTarget?.serviceName, 'web');
});

test('toFlowNode maps runtime runs to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('runtime_run', {
      runtimeRun: {
        runNodeId: 'runtime-run-1',
        targetNodeId: 'runtime-target-1',
        sourceRunId: 'run-1',
        targetKind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/demo/apps/web',
        command: 'pnpm',
        args: ['run', 'dev'],
        ports: [{ name: 'http', port: 43121, protocol: 'http' }],
        status: 'running',
        preview: { status: 'running', strategy: 'script', port: 43121, url: 'http://127.0.0.1:43121' },
      },
    }),
  );

  assert.equal(flow.type, 'runtimeRun');
  assert.equal(flow.data.runtimeRun?.status, 'running');
});

test('toFlowNode maps workflow copilot nodes to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('workflow_copilot', {}, {
      title: 'Build onboarding flow',
      text: 'Generate the graph for a new onboarding path.',
      autoApply: true,
      autoRun: false,
    }),
  );

  assert.equal(flow.type, 'workflowCopilot');
  assert.match(flow.data.text, /Build onboarding flow/);
});

test('toFlowNode maps input nodes to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text', 'file'],
      multiple: false,
      required: true,
      instructions: 'Describe the task and attach the spec.',
    }),
  );

  assert.equal(flow.type, 'inputNode');
  assert.equal(flow.data.workflowInput?.mode, 'template');
  assert.match(flow.data.text, /Brief/);
});

test('toFlowNode maps workspace file nodes to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('workspace_file', {}, {
      title: 'Research sources',
      relativePath: 'sources.md',
      role: 'output',
      origin: 'agent_output',
      kind: 'text',
      transferMode: 'reference',
      summary: 'Annotated source list.',
      status: 'available',
    }),
  );

  assert.equal(flow.type, 'workspaceFile');
  assert.equal(flow.data.workflowArtifact?.relativePath, 'sources.md');
  assert.match(flow.data.text, /sources\.md/);
});

test('toFlowNode summarizes loop controllers with runtime progress', () => {
  const flow = toFlowNode(
    makeNode(
      'loop',
      {
        controller: {
          id: 'ctl-1',
          status: 'running',
          currentIndex: 1,
          totalItems: 3,
          currentItemLabel: 'Chunk 2',
          resolvedBoundNodeId: 'bound-2',
          sourcePartCount: 3,
          materializedItemCount: 3,
          lastDecisionDetail: 'waiting for validator',
          counts: {
            running: 1,
            pending: 2,
          },
        },
      },
      {
        mode: 'for_each',
        source: {
          kind: 'inline_list',
          items: ['chunk-1', 'chunk-2', 'chunk-3'],
        },
        bodyNodeId: 'step-1',
        validatorNodeId: 'validator-1',
        advancePolicy: 'only_on_pass',
        sessionPolicy: {
          withinItem: 'reuse_execution',
          betweenItems: 'new_execution',
        },
        blockedPolicy: 'pause_controller',
      },
    ),
  );

  assert.equal(flow.type, 'editableText');
  assert.match(flow.data.text, /loop · for_each/);
  assert.match(flow.data.text, /status: running/);
  assert.match(flow.data.text, /current: Chunk 2/);
  assert.match(flow.data.text, /progress: 2\/3/);
  assert.match(flow.data.text, /bound input: bound-2/);
  assert.match(flow.data.text, /materialized: 3 item\(s\) from 3 part\(s\)/);
  assert.match(flow.data.text, /detail: waiting for validator/);
});

test('toFlowNode summarizes managed flows created from legacy copilot aliases', () => {
  const flow = toFlowNode(
    makeNode(
      'managed_flow',
      {
        flow: {
          id: 'flow-1',
          status: 'running',
          revision: 2,
          currentPhaseId: 'derive',
          currentPhaseKind: 'derive_input_phase',
          completedPhaseCount: 1,
          phaseCount: 4,
          lastDetail: 'waiting on gap report',
          cancelRequested: false,
        },
      },
      {
        label: 'Main flow',
        entry: 'dev',
        steps: [
          {
            id: 'dev',
            kind: 'loop',
            loopNodeId: 'dev-loop',
          },
          {
            id: 'audit',
            kind: 'audit',
            agentNodeId: 'audit-step',
            outputs: ['outputs/gap-report.json'],
          },
          {
            id: 'derive',
            kind: 'derive',
            reportNodeId: 'gap-file',
            templateNodeId: 'chunks-template',
            path: 'items',
          },
          {
            id: 'verify',
            kind: 'verify',
            runtimeNodeId: 'verify-step',
          },
        ],
      },
    ),
  );

  assert.equal(flow.type, 'editableText');
  assert.match(flow.data.text, /managed flow · managed/);
  assert.match(flow.data.text, /entry: dev/);
  assert.match(flow.data.text, /derive_input_phase: chunks-template/);
  assert.match(flow.data.text, /status: running/);
  assert.match(flow.data.text, /phase: derive_input_phase/);
  assert.match(flow.data.text, /progress: 1\/4/);
  assert.match(flow.data.text, /detail: waiting on gap report/);
});

test('toFlowNode includes the resolved path for per-run workspace files', () => {
  const flow = toFlowNode(
    makeNode('workspace_file', {}, {
      title: 'Research synthesis',
      relativePath: 'research/synthesis.md',
      resolvedRelativePath: 'research/run-550e8400/synthesis.md',
      pathMode: 'per_run',
      role: 'output',
      origin: 'agent_output',
      kind: 'text',
      transferMode: 'reference',
      status: 'available',
    }),
  );

  assert.equal(flow.data.workflowArtifact?.pathMode, 'per_run');
  assert.match(flow.data.text, /resolved: research\/run-550e8400\/synthesis\.md/);
});

test('readInputTemplateStartState reports ready when latest sibling bounds exist', () => {
  const nodes = [
    makeNode('note'),
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: true,
    }),
    {
      ...makeNode('input', {}, {
        mode: 'template',
        key: 'screenshots',
        label: 'Screenshots',
        accepts: ['image'],
        multiple: true,
        required: true,
      }),
      id: 'input-2',
    },
    {
      ...makeNode('input', {}, {
        mode: 'bound',
        key: 'brief',
        label: 'Brief',
        templateNodeId: 'input-1',
        runId: 'run-1',
        parts: [{ id: 'part-1', type: 'text', text: 'Ship the flow.' }],
        summary: 'Ship the flow.',
      }),
      id: 'bound-1',
      updatedAt: '2026-04-03T01:00:00.000Z',
    },
    {
      ...makeNode('input', {}, {
        mode: 'bound',
        key: 'screenshots',
        label: 'Screenshots',
        templateNodeId: 'input-2',
        runId: 'run-1',
        parts: [
          {
            id: 'part-2',
            type: 'image',
            file: {
              name: 'screen.png',
              mimeType: 'image/png',
              size: 24,
              kind: 'image',
              uploadedAt: '2026-04-03T01:00:00.000Z',
            },
          },
        ],
        summary: 'screen.png',
      }),
      id: 'bound-2',
      updatedAt: '2026-04-03T01:01:00.000Z',
    },
  ];

  const start = readInputTemplateStartState('input-1', nodes, [
    { source: 'note-1', target: 'input-1' },
    { source: 'note-1', target: 'input-2' },
  ]);

  assert.equal(start?.ready, true);
  assert.equal(start?.bound.length, 2);
  assert.equal(start?.bound[0]?.isTarget, true);
  assert.equal(start?.bound[1]?.boundNodeId, 'bound-2');
});

test('readInputTemplateStartState reports blocked when a required sibling bound is missing', () => {
  const nodes = [
    makeNode('note'),
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: false,
    }),
    {
      ...makeNode('input', {}, {
        mode: 'template',
        key: 'screenshots',
        label: 'Screenshots',
        accepts: ['image'],
        multiple: true,
        required: true,
      }),
      id: 'input-2',
    },
  ];

  const start = readInputTemplateStartState('input-1', nodes, [
    { source: 'note-1', target: 'input-1' },
    { source: 'note-1', target: 'input-2' },
  ]);

  assert.equal(start?.ready, false);
  assert.deepEqual(start?.missing.map((item) => item.label), ['Screenshots']);
});

test('readInputTemplateStartState auto-satisfies a required text input from one linked source', () => {
  const nodes = [
    makeNode('note', {}, { text: 'Use the linked research brief.', format: 'markdown' }),
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: true,
    }),
  ];

  const start = readInputTemplateStartState('input-1', nodes, [{ source: 'note-1', target: 'input-1' }]);

  assert.equal(start?.ready, true);
  assert.deepEqual(start?.target?.candidates.map((item) => item.sourceNodeId), ['note-1']);
  assert.deepEqual(start?.missing, []);
});

test('evaluateInputTemplateStartState lets inline text satisfy a blocked text-only target', () => {
  const nodes = [
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: true,
    }),
  ];

  const start = readInputTemplateStartState('input-1', nodes, []);
  assert.equal(start?.ready, false);
  assert.equal(
    start ? evaluateInputTemplateStartState(start, { inlineText: 'Ship the onboarding flow.' }).ready : false,
    true,
  );
});

test('evaluateInputTemplateStartState requires an explicit source choice when several parents fit', () => {
  const nodes = [
    makeNode('note', {}, { text: 'First brief', format: 'markdown' }),
    { ...makeNode('agent_output', {}, { output: 'Second brief' }), id: 'agent_output-1' },
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: true,
    }),
  ];

  const start = readInputTemplateStartState('input-1', nodes, [
    { source: 'note-1', target: 'input-1' },
    { source: 'agent_output-1', target: 'input-1' },
  ]);

  assert.equal(start?.ready, false);
  assert.equal(
    start ? evaluateInputTemplateStartState(start, { sourceNodeIds: ['agent_output-1'] }).ready : false,
    true,
  );
});

test('createInputStartStateCache reuses the same result while graph refs stay stable', () => {
  const nodes = [
    makeNode('note'),
    makeNode('input', {}, {
      mode: 'template',
      key: 'brief',
      label: 'Brief',
      accepts: ['text'],
      multiple: false,
      required: true,
    }),
    {
      ...makeNode('input', {}, {
        mode: 'bound',
        key: 'brief',
        label: 'Brief',
        templateNodeId: 'input-1',
        runId: 'run-1',
        parts: [{ id: 'part-1', type: 'text', text: 'Ship the flow.' }],
        summary: 'Ship the flow.',
      }),
      id: 'bound-1',
      updatedAt: '2026-04-03T01:00:00.000Z',
    },
  ];
  const flowNodes = nodes.map((node) => toFlowNode(node));
  const flowEdges: Edge[] = [
    {
      id: 'edge-1',
      source: 'note-1',
      target: 'input-1',
      label: 'references',
    },
  ];
  const read = createInputStartStateCache();

  const first = read('input-1', flowNodes, flowEdges);
  const second = read('input-1', flowNodes, flowEdges);
  const third = read('input-1', flowNodes, [...flowEdges]);

  assert.equal(first?.ready, true);
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test('toFlowNode maps file summary nodes to the dedicated renderer', () => {
  const flow = toFlowNode(
    makeNode('file_summary', {}, {
      status: 'done',
      summary: '# Combined\n- A short markdown brief.',
      generatedSummary: '# Combined\n- A short markdown brief.',
      files: [
        {
          id: 'notes-file',
          file: {
            name: 'notes.md',
            mimeType: 'text/markdown',
            size: 128,
            kind: 'text',
            uploadedAt: '2026-04-06T10:00:00.000Z',
            extension: '.md',
          },
          summary: 'A short markdown brief.',
          extractedText: '# Notes',
          extractedTextChars: 7,
          extractedTextTruncated: false,
          status: 'done',
        },
      ],
    }),
  );

  assert.equal(flow.type, 'fileSummary');
  assert.equal(flow.data.fileSummary?.files?.[0]?.file.name, 'notes.md');
  assert.equal(flow.data.text, '# Combined\n- A short markdown brief.');
});
