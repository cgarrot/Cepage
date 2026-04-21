import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowCopilotTurn,
  WORKFLOW_COPILOT_PARSE_FAILED,
} from '../workflow-copilot-turn.js';

test('parseWorkflowCopilotTurn unwraps a stringified JSON object', () => {
  const raw = JSON.stringify({
    analysis: 'Understand the requested style shift.',
    message: 'I updated the workflow brief.',
    changes: 'Updated the design brief node.',
    operations: [],
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.analysis, 'Understand the requested style shift.');
  assert.equal(parsed.turn.reply, 'I updated the workflow brief.');
  assert.deepEqual(parsed.turn.summary, ['Updated the design brief node.']);
  assert.deepEqual(parsed.turn.ops, []);
});

test('parseWorkflowCopilotTurn ignores unrelated JSON and keeps the turn object', () => {
  const raw = [
    '[tool]',
    '{"file":"brief.md","status":"updated"}',
    '{"analysis":"Shift to a full Pixelmon look.","reply":"I rewrote the style brief.","summary":["Updated the visual direction."],"warnings":[],"ops":[]}',
  ].join('\n');

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.analysis, 'Shift to a full Pixelmon look.');
  assert.equal(parsed.turn.reply, 'I rewrote the style brief.');
  assert.deepEqual(parsed.turn.summary, ['Updated the visual direction.']);
});

test('parseWorkflowCopilotTurn normalizes nested add_node payloads', () => {
  const raw = JSON.stringify({
    analysis: 'Create a reusable research template.',
    message: 'I added the reusable research setup.',
    changes: 'Added the shared research input and link.',
    operations: [
      {
        kind: 'add_node',
        node: {
          ref: 'topic-input',
          type: 'input',
          position: { x: 360, y: 280 },
          content: {
            mode: 'template',
            key: 'web_research_topic',
            label: 'Sujet de recherche web',
            accepts: ['text'],
            multiple: false,
            required: true,
          },
        },
      },
      {
        kind: 'add_edge',
        source: 'root',
        target: 'topic-input',
        relation: 'references',
        direction: 'source_to_target',
      },
    ],
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.analysis, 'Create a reusable research template.');
  assert.equal(parsed.turn.reply, 'I added the reusable research setup.');
  assert.deepEqual(parsed.turn.summary, ['Added the shared research input and link.']);
  assert.deepEqual(parsed.turn.ops, [
    {
      kind: 'add_node',
      ref: 'topic-input',
      type: 'input',
      position: { x: 360, y: 280 },
      content: {
        mode: 'template',
        key: 'web_research_topic',
        label: 'Sujet de recherche web',
        accepts: ['text'],
        multiple: false,
        required: true,
      },
    },
    {
      kind: 'add_edge',
      source: 'root',
      target: 'topic-input',
      relation: 'references',
      direction: 'source_to_target',
    },
  ]);
});

test('parseWorkflowCopilotTurn keeps flat add_node ops intact', () => {
  const raw = JSON.stringify({
    analysis: 'Add a note beside the root node.',
    reply: 'I added the note and linked it.',
    summary: ['Added a note and connected it.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'draft-note',
        type: 'note',
        position: { x: 320, y: 160 },
        content: { text: 'Draft workflow note', format: 'markdown' },
      },
      {
        kind: 'add_edge',
        source: 'root',
        target: 'draft-note',
        relation: 'references',
        direction: 'source_to_target',
      },
    ],
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.turn.ops, [
    {
      kind: 'add_node',
      ref: 'draft-note',
      type: 'note',
      position: { x: 320, y: 160 },
      content: { text: 'Draft workflow note', format: 'markdown' },
    },
    {
      kind: 'add_edge',
      source: 'root',
      target: 'draft-note',
      relation: 'references',
      direction: 'source_to_target',
    },
  ]);
});

test('parseWorkflowCopilotTurn normalizes managed flow node aliases', () => {
  const raw = JSON.stringify({
    analysis: 'Wrap the existing workflow in a managed flow.',
    reply: 'I added the managed flow wrapper.',
    summary: ['Added a managed flow node.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'main-flow',
        type: 'managedFlow',
        position: { x: 520, y: 200 },
        content: {
          title: 'Main flow',
          phases: [
            {
              id: 'dev',
              kind: 'loop',
              loopNodeId: 'dev-loop',
            },
          ],
        },
      },
    ],
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.ops[0]?.kind, 'add_node');
  assert.deepEqual(parsed.turn.ops[0], {
    kind: 'add_node',
    ref: 'main-flow',
    type: 'managed_flow',
    position: { x: 520, y: 200 },
    content: {
      title: 'Main flow',
      phases: [
        {
          id: 'dev',
          kind: 'loop',
          loopNodeId: 'dev-loop',
        },
      ],
    },
  });
});

test('parseWorkflowCopilotTurn accepts loop controller node ops', () => {
  const raw = JSON.stringify({
    analysis: 'Add a loop controller around the reusable worker flow.',
    reply: 'I added the loop controller pattern.',
    summary: ['Added a loop controller and validator patch.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'loop-controller',
        type: 'loop',
        position: { x: 420, y: 220 },
        content: {
          mode: 'for_each',
          source: {
            kind: 'inline_list',
            items: ['chunk-1', 'chunk-2'],
          },
          bodyNodeId: 'worker-subgraph',
          validatorNodeId: 'worker-validator',
          advancePolicy: 'only_on_pass',
          sessionPolicy: {
            withinItem: 'reuse_execution',
            betweenItems: 'new_execution',
          },
          blockedPolicy: 'pause_controller',
        },
      },
      {
        kind: 'patch_node',
        nodeId: 'worker-validator',
        patch: {
          content: {
            mode: 'workspace_validator',
            requirements: ['A deliverable file must exist before advancing.'],
            checks: [{ kind: 'path_exists', path: 'deliverable.md' }],
            passAction: 'pass',
            failAction: 'retry_same_item',
            blockAction: 'block',
          },
        },
      },
    ],
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.ops.length, 2);
  assert.deepEqual(parsed.turn.ops[0], {
    kind: 'add_node',
    ref: 'loop-controller',
    type: 'loop',
    position: { x: 420, y: 220 },
    content: {
      mode: 'for_each',
      source: {
        kind: 'inline_list',
        items: ['chunk-1', 'chunk-2'],
      },
      bodyNodeId: 'worker-subgraph',
      validatorNodeId: 'worker-validator',
      advancePolicy: 'only_on_pass',
      sessionPolicy: {
        withinItem: 'reuse_execution',
        betweenItems: 'new_execution',
      },
      blockedPolicy: 'pause_controller',
    },
  });
});

test('parseWorkflowCopilotTurn repairs raw newlines inside JSON strings', () => {
  const raw = `{
    "analysis": "Fill the uploaded workflow inputs.",
    "reply": "I filled the workflow inputs.",
    "summary": ["Bound the uploaded workflow inputs."],
    "warnings": [],
    "ops": [
      {
        "kind": "patch_node",
        "nodeId": "input-1",
        "patch": {
          "content": {
            "mode": "bound",
            "templateNodeId": "template-1",
            "parts": ["Line one
Line two"],
            "summary": "Bound input content."
          }
        }
      }
    ]
  }`;

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.turn.ops, [
    {
      kind: 'patch_node',
      nodeId: 'input-1',
      patch: {
        content: {
          mode: 'bound',
          templateNodeId: 'template-1',
          parts: ['Line one\nLine two'],
          summary: 'Bound input content.',
        },
      },
    },
  ]);
});

test('parseWorkflowCopilotTurn repairs extra closing braces in ops payloads', () => {
  const raw =
    '{"analysis":"Create the chunk workflow.","reply":"I added the loop workflow.","summary":["Added the chunk loop."],"warnings":["The last line must be `CHUNK_DONE`."],"ops":[{"kind":"add_node","ref":"loop-chunks","type":"loop","position":{"x":320,"y":360},"content":{"mode":"for_each","source":{"kind":"input_parts","templateNodeId":"tmpl-chunks"},"bodyNodeId":"sub-chunk-flow","validatorNodeId":"val-chunk-done","advancePolicy":"only_on_pass","sessionPolicy":{"withinItem":"reuse_execution","betweenItems":"new_execution"},"maxAttemptsPerItem":12,"blockedPolicy":"request_human","itemLabel":"morceau"}},{"kind":"add_edge","source":"loop-chunks","target":"val-chunk-done","relation":"monitors","direction":"source_to_target"}}]}';

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.reply, 'I added the loop workflow.');
  assert.deepEqual(parsed.turn.summary, ['Added the chunk loop.']);
  assert.deepEqual(parsed.turn.ops, [
    {
      kind: 'add_node',
      ref: 'loop-chunks',
      type: 'loop',
      position: { x: 320, y: 360 },
      content: {
        mode: 'for_each',
        source: {
          kind: 'input_parts',
          templateNodeId: 'tmpl-chunks',
        },
        bodyNodeId: 'sub-chunk-flow',
        validatorNodeId: 'val-chunk-done',
        advancePolicy: 'only_on_pass',
        sessionPolicy: {
          withinItem: 'reuse_execution',
          betweenItems: 'new_execution',
        },
        maxAttemptsPerItem: 12,
        blockedPolicy: 'request_human',
        itemLabel: 'morceau',
      },
    },
    {
      kind: 'add_edge',
      source: 'loop-chunks',
      target: 'val-chunk-done',
      relation: 'monitors',
      direction: 'source_to_target',
    },
  ]);
});

test('parseWorkflowCopilotTurn repairs a missing closing quote before an object boundary', () => {
  const raw =
    '{"analysis":"Create the managed autonomy demo.","reply":"I added the demo workflow.","summary":["Added the managed autonomy demo."],"warnings":[],"ops":[{"kind":"add_edge","source":"val-audit","target":"wf-gap-report","relation":"references","direction":"source_to_target},{"kind":"add_edge","source":"val-runtime","target":"wf-verify","relation":"references","direction":"source_to_target"}]}';

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.reply, 'I added the demo workflow.');
  assert.deepEqual(parsed.turn.summary, ['Added the managed autonomy demo.']);
  assert.deepEqual(parsed.turn.ops, [
    {
      kind: 'add_edge',
      source: 'val-audit',
      target: 'wf-gap-report',
      relation: 'references',
      direction: 'source_to_target',
    },
    {
      kind: 'add_edge',
      source: 'val-runtime',
      target: 'wf-verify',
      relation: 'references',
      direction: 'source_to_target',
    },
  ]);
});

test('parseWorkflowCopilotTurn fails when no recognizable turn exists', () => {
  const parsed = parseWorkflowCopilotTurn('{"file":"brief.md","status":"updated"}');

  assert.deepEqual(parsed, {
    success: false,
    error: WORKFLOW_COPILOT_PARSE_FAILED,
  });
});

test('parseWorkflowCopilotTurn drops an empty architecture object instead of failing', () => {
  // Models often emit `architecture: {}` when no architecture spec is needed.
  // The architecture schema requires goal + at least one module, so a strict
  // parse would reject the whole envelope. We expect the parser to drop the
  // invalid architecture payload and still surface analysis/reply/summary/ops.
  const raw = JSON.stringify({
    analysis: 'Plan the multi-agent research workflow.',
    reply: "J'ai créé votre workflow multi-agent.",
    summary: ['Added 4 agent steps'],
    warnings: ['Verify the model id'],
    ops: [
      {
        kind: 'add_node',
        ref: 'topic-input',
        type: 'input',
        position: { x: 360, y: 280 },
        content: { mode: 'template', key: 'topic', label: 'Topic', accepts: ['text'] },
      },
    ],
    executions: [],
    attachmentGraph: { kind: 'none' },
    architecture: {},
  });

  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.reply, "J'ai créé votre workflow multi-agent.");
  assert.deepEqual(parsed.turn.summary, ['Added 4 agent steps']);
  assert.equal(parsed.turn.ops.length, 1);
  assert.equal(parsed.turn.architecture, undefined);
});

test('parseWorkflowCopilotTurn keeps a valid architecture spec', () => {
  const raw = JSON.stringify({
    analysis: 'Architect the research pipeline.',
    reply: 'Architecture ready for review.',
    summary: [],
    warnings: [],
    ops: [],
    architecture: {
      goal: 'Run a daily web research digest',
      modules: [
        {
          id: 'researcher',
          title: 'Web researcher',
          summary: 'Collect raw web sources for the topic',
          role: 'research',
        },
      ],
    },
  });

  const parsed = parseWorkflowCopilotTurn(raw);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.architecture?.goal, 'Run a daily web research digest');
  assert.equal(parsed.turn.architecture?.modules.length, 1);
});

test('parseWorkflowCopilotTurn parses executions array', () => {
  const raw = JSON.stringify({
    analysis: 'Run',
    reply: 'Ok.',
    summary: [],
    warnings: [],
    ops: [],
    executions: [{ kind: 'workflow_run', type: 'opencode', triggerNodeId: 'node-a' }],
  });
  const parsed = parseWorkflowCopilotTurn(raw);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.turn.executions.length, 1);
  assert.equal(parsed.turn.executions[0]?.kind, 'workflow_run');
  assert.equal((parsed.turn.executions[0] as { triggerNodeId?: string }).triggerNodeId, 'node-a');
});
