import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreateNodeContent, getDefaultCreatePosition } from '../workspace-node-create.js';

test('buildCreateNodeContent creates markdown content for human nodes', () => {
  assert.deepEqual(buildCreateNodeContent('human_message', 'Hello'), {
    text: 'Hello',
    format: 'markdown',
  });
});

test('buildCreateNodeContent defaults note nodes to editable markdown', () => {
  assert.deepEqual(buildCreateNodeContent('note'), {
    text: '',
    format: 'markdown',
  });
});

test('buildCreateNodeContent seeds input nodes with template defaults', () => {
  assert.deepEqual(buildCreateNodeContent('input', 'Describe the expected payload'), {
    mode: 'template',
    label: 'Input',
    accepts: ['text', 'image', 'file'],
    multiple: true,
    required: false,
    instructions: 'Describe the expected payload',
  });
});

test('buildCreateNodeContent seeds workspace file nodes with artifact defaults', () => {
  assert.deepEqual(buildCreateNodeContent('workspace_file'), {
    title: 'Workspace file',
    relativePath: 'notes.md',
    pathMode: 'static',
    role: 'output',
    origin: 'derived',
    kind: 'text',
    transferMode: 'reference',
    status: 'declared',
  });
});

test('buildCreateNodeContent seeds workflow copilot nodes with copilot defaults', () => {
  assert.deepEqual(buildCreateNodeContent('workflow_copilot', 'Plan the onboarding flow'), {
    title: 'Workflow copilot',
    text: 'Plan the onboarding flow',
    scope: { kind: 'node' },
    autoApply: true,
    autoRun: true,
  });
});

test('buildCreateNodeContent seeds managed flow nodes with canonical flow defaults', () => {
  assert.deepEqual(buildCreateNodeContent('managed_flow'), {
    title: 'Managed flow',
    syncMode: 'managed',
    entryPhaseId: 'phase-1',
    phases: [
      {
        id: 'phase-1',
        kind: 'loop_phase',
        nodeId: 'replace-loop-node-id',
        title: 'Dev loop',
      },
    ],
  });
});

test('buildCreateNodeContent seeds file summary nodes with an empty status', () => {
  assert.deepEqual(buildCreateNodeContent('file_summary'), {
    files: [],
    status: 'empty',
  });
});

test('getDefaultCreatePosition returns the empty-canvas origin', () => {
  assert.deepEqual(getDefaultCreatePosition([]), {
    x: 120,
    y: 120,
  });
});

test('getDefaultCreatePosition stacks from the lowest node', () => {
  assert.deepEqual(
    getDefaultCreatePosition([
      { position: { x: 80, y: 160 } },
      { position: { x: 260, y: 420 } },
      { position: { x: 140, y: 300 } },
    ]),
    {
      x: 300,
      y: 560,
    },
  );
});
