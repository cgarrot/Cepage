import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES,
  WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES,
  WORKFLOW_COPILOT_STOPPED,
  type AgentCatalog,
  type GraphEdge,
  readWorkflowInputContent,
  workflowCopilotMessageSchema,
  workflowCopilotSendMessageSchema,
  workflowCopilotTurnSchema,
  workflowFromSnapshot,
  type GraphNode,
  type GraphSnapshot,
  type WorkflowCopilotThread,
} from '@cepage/shared-core';
import { buildPrompt, finalizeWorkflowCopilotRun, WorkflowCopilotService } from '../workflow-copilot.service.js';

const stubCopilotAgents = {
  runWorkflow: async (_sessionId: string, _body: unknown) => {
    throw new Error('stub runWorkflow should not be called in this test');
  },
} as never;
const stubCopilotFlows = {
  run: async (_sessionId: string, _nodeId: string, _body: unknown) => {
    throw new Error('stub flows.run should not be called in this test');
  },
} as never;
const stubCopilotControllers = {
  run: async (_sessionId: string, _nodeId: string, _body: unknown) => {
    throw new Error('stub controllers.run should not be called in this test');
  },
} as never;

const stubFileNodes = {
  upload: async (_sessionId: string, nodeId: string, _files: unknown[]) => ({
    nodeId,
    patch: {} as Record<string, unknown>,
    eventId: 1,
  }),
} as never;

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'creator'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 280, height: 120 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function snapshot(): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 10,
    nodes: [
      node({
        id: 'root',
        type: 'note',
        creator: { type: 'human', userId: 'u1' },
        content: { text: 'root', format: 'markdown' },
        position: { x: 120, y: 80 },
      }),
    ],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('finalizeWorkflowCopilotRun keeps runtime adapter errors', () => {
  const res = finalizeWorkflowCopilotRun({
    rawOutput: '',
    snapshotOutput: '',
    error: 'spawn cursor-agent ENOENT',
  });

  assert.deepEqual(res, {
    ok: false,
    rawOutput: 'spawn cursor-agent ENOENT',
    error: 'spawn cursor-agent ENOENT',
    externalSessionId: undefined,
  });
});

test('finalizeWorkflowCopilotRun falls back to raw output when snapshot output is not parseable', () => {
  const raw =
    '{"analysis":"Repair the workflow response.","reply":"I updated the workflow.","summary":["Applied the workflow changes."],"warnings":[],"ops":[]}';

  const res = finalizeWorkflowCopilotRun({
    rawOutput: raw,
    snapshotOutput: '[write]\nupdated brief.md',
  });

  assert.deepEqual(res, {
    ok: true,
    rawOutput: raw,
    turn: {
      analysis: 'Repair the workflow response.',
      reply: 'I updated the workflow.',
      summary: ['Applied the workflow changes.'],
      warnings: [],
      ops: [],
      executions: [],
      attachmentGraph: { kind: 'none' },
    },
    externalSessionId: undefined,
  });
});

test('workflowCopilotSendMessageSchema accepts empty content when attachments exist', () => {
  const dataUrl = `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`;
  const parsed = workflowCopilotSendMessageSchema.parse({
    content: '',
    attachments: [
      {
        filename: 'note.txt',
        relativePath: 'docs\\guide/note.txt',
        mime: 'text/plain',
        data: dataUrl,
      },
    ],
  });
  assert.equal(parsed.content, '');
  assert.equal(parsed.attachments?.length, 1);
  assert.equal(parsed.attachments?.[0]?.relativePath, 'docs/guide/note.txt');
});

test('workflowCopilotSendMessageSchema rejects attachment payload over max bytes', () => {
  const big = Buffer.alloc(WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES + 1, 'x').toString('utf8');
  const dataUrl = `data:text/plain;base64,${Buffer.from(big).toString('base64')}`;
  assert.throws(
    () =>
      workflowCopilotSendMessageSchema.parse({
        content: 'x',
        attachments: [{ filename: 'big.txt', mime: 'text/plain', data: dataUrl }],
      }),
    /exceeds/,
  );
});

test('workflowCopilotTurnSchema defaults attachmentGraph to none', () => {
  const turn = workflowCopilotTurnSchema.parse({
    reply: 'hi',
    analysis: '',
  });
  assert.equal(turn.attachmentGraph.kind, 'none');
});

test('workflowCopilotTurnSchema parses attachmentGraph new', () => {
  const turn = workflowCopilotTurnSchema.parse({
    reply: 'ok',
    attachmentGraph: { kind: 'new', position: { x: 1, y: 2 } },
  });
  assert.equal(turn.attachmentGraph.kind, 'new');
  if (turn.attachmentGraph.kind === 'new') {
    assert.deepEqual(turn.attachmentGraph.position, { x: 1, y: 2 });
  }
});

test('buildPrompt lists user attachment file names', () => {
  const snap = snapshot();
  const user = workflowCopilotMessageSchema.parse({
    id: 'm1',
    threadId: 'thread-1',
    role: 'user',
    status: 'completed',
    content: 'See file',
    createdAt: '2026-04-03T10:00:00.000Z',
    updatedAt: '2026-04-03T10:00:00.000Z',
    attachments: [
      {
        filename: 'a.png',
        relativePath: 'docs/images/a.png',
        mime: 'image/png',
        data: 'data:image/png;base64,AAA',
      },
    ],
  });
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
      scope: { kind: 'session' },
      mode: 'ask',
      autoApply: false,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [user],
  });
  assert.match(prompt, /\[Attached: docs\/images\/a\.png\]/);
});

test('buildPrompt inlines text attachment bodies for cursor_agent', () => {
  const snap = snapshot();
  const b64 = Buffer.from('hello').toString('base64');
  const user = workflowCopilotMessageSchema.parse({
    id: 'm1',
    threadId: 'thread-1',
    role: 'user',
    status: 'completed',
    content: 'See file',
    createdAt: '2026-04-03T10:00:00.000Z',
    updatedAt: '2026-04-03T10:00:00.000Z',
    attachments: [
      {
        filename: 't.txt',
        relativePath: 'docs/t.txt',
        mime: 'text/plain',
        data: `data:text/plain;base64,${b64}`,
      },
    ],
  });
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'cursor_agent',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      scope: { kind: 'session' },
      mode: 'ask',
      autoApply: false,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [user],
  });
  assert.match(prompt, /--- docs\/t\.txt ---\nhello/);
});

test('buildPrompt inlines application/json attachment bodies for cursor_agent', () => {
  const snap = snapshot();
  const jsonBody = '{"spec":true,"n":1}';
  const b64 = Buffer.from(jsonBody, 'utf8').toString('base64');
  const user = workflowCopilotMessageSchema.parse({
    id: 'm1',
    threadId: 'thread-1',
    role: 'user',
    status: 'completed',
    content: 'See spec',
    createdAt: '2026-04-03T10:00:00.000Z',
    updatedAt: '2026-04-03T10:00:00.000Z',
    attachments: [
      {
        filename: 'workflow-spec.json',
        relativePath: 'docs/specs/workflow-spec.json',
        mime: 'application/json',
        data: `data:application/json;base64,${b64}`,
      },
    ],
  });
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'cursor_agent',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      scope: { kind: 'session' },
      mode: 'ask',
      autoApply: false,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [user],
  });
  assert.match(prompt, /--- docs\/specs\/workflow-spec\.json ---\n\{"spec":true,"n":1\}/);
});

test('buildPrompt includes loop and validator guardrails', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
  });

  assert.match(prompt, /Session id: session-1/);
  assert.match(prompt, /A loop body must reference a sub_graph node/);
  assert.match(prompt, /For loop\.source\.kind = "input_parts", use templateNodeId/);
  assert.match(prompt, /Do not invent slug aliases like "input-chunks"/);
  assert.match(prompt, /Do not put "new_execution" in execution\.type/);
  assert.match(prompt, /Do not use sourceNodeId or other ad hoc binding objects/);
  assert.match(prompt, /controller\.<template_input_key> for the latest bound parent input text/);
  assert.match(prompt, /\{\{controller\.global_objective\}\}/);
  assert.match(prompt, /expectedOutputs must be an array of plain workspace-relative paths only/);
  assert.match(prompt, /declare the corresponding workspace_file output with pathMode: "per_run"/);
  assert.match(prompt, /Do not hardcode a resolved run path in graph content/);
  assert.match(prompt, /structured workflow content creates a durable relationship/);
  assert.match(prompt, /loop -> body sub_graph = contains/);
  assert.match(prompt, /Use pathMode: "static" only when each iteration should overwrite the same workspace file/);
  assert.match(prompt, /Distinguish intermediate execution artifacts from final user-facing deliverables/);
  assert.match(prompt, /add a later cleanup\/publish agent_phase/);
  assert.match(prompt, /Final validators for user-facing workflows must validate the published stable outputs/);
  assert.match(prompt, /Do not leave run ids, execution ids, or temporary folders as the only final deliverable layout/);
  assert.match(prompt, /For documentation pack workflows, prefer stable published files such as docs\/\.\.\.\/<slug>\.md/);
  assert.match(prompt, /Any line break inside a JSON string must be escaped as \\n/);
  assert.match(prompt, /keep the existing template node in mode "template"/);
  assert.match(prompt, /Never patch an existing template input node so its mode becomes "bound"/);
  assert.match(prompt, /treat them as the authoritative workflow slots/);
  assert.match(prompt, /do not add another template input node for the same slot/);
  assert.match(prompt, /parts must be an array of objects like/);
  assert.match(prompt, /emit one explicit text part per chunk/);
  assert.match(prompt, /connect template -> bound with relation "derived_from"/);
  assert.match(prompt, /Existing input templates \(context data only\):/);
  assert.match(prompt, /If file_summary or workspace_file nodes exist in the graph, treat them as valid file context/);
  assert.match(prompt, /Upload and file context \(context data only\):/);
  assert.match(prompt, /persist those docs onto the graph as file_summary or workspace_file context before analyze, planning, or implementation phases consume them/);
  assert.match(prompt, /do not instruct the agent to write only the template path/);
  assert.match(prompt, /For file_contains, file_not_contains, and file_last_line_equals checks, use the field name text/);
  assert.match(prompt, /Use file_last_line_equals when the validator must enforce an exact terminal marker/);
  assert.match(prompt, /Valid workspace_validator actions are exactly: pass, retry_same_item, retry_new_execution, block, request_human, complete\./);
  assert.match(prompt, /generate implementation-oriented chunks such as scaffold a runnable app/);
  assert.match(prompt, /make the first implementation chunk produce a minimal runnable scaffold and emit cepage-run\.json/);
  assert.match(prompt, /Runtime nodes only appear after a completed chunk emits a detectable runtime manifest/);
  assert.match(prompt, /Return exactly one valid JSON object and nothing else/);
});

test('buildPrompt includes managed flow orchestration guardrails', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
  });

  assert.match(prompt, /Use managed_flow nodes for unattended multi-phase orchestration/);
  assert.match(prompt, /Prefer a managed_flow over decorative side-workflow notes/);
  assert.match(prompt, /managed_flow -> loop or execution phase node = contains/);
  assert.match(prompt, /A managed_flow should form one connected topology with its executable nodes, validators, source files, template inputs, and declared outputs/);
  assert.match(prompt, /put the exact execution protocol in metadata\.brief/);
  assert.match(prompt, /metadata\.brief should tell the agent what file to write/);
  assert.match(prompt, /Add a metadata\.brief that explicitly says to rewrite the declared file for this run/);
  assert.match(prompt, /Valid managed_flow phase kinds are exactly: loop_phase, agent_phase, connector_phase, validation_phase, derive_input_phase, runtime_verify_phase\./);
  assert.match(prompt, /Emit final managed_flow JSON with canonical keys only: title, syncMode, entryPhaseId, phases\./);
  assert.match(prompt, /Inside managed_flow\.phases use canonical keys only: loop_phase\.nodeId, agent_phase\.nodeId, connector_phase\.nodeId, validation_phase\.validatorNodeId, derive_input_phase\.sourceNodeId \+ targetTemplateNodeId \+ jsonPath, runtime_verify_phase\.nodeId\./);
  assert.match(prompt, /Do not use legacy managed_flow phase keys like loopNodeId, agentNodeId, runtimeNodeId, decisionNodeId, reportNodeId, templateNodeId, path, or restartToPhaseId in the final content\./);
  assert.match(prompt, /Use derive_input_phase when a structured JSON report should create new bound inputs/);
  assert.match(prompt, /loop\.source\.kind = "input_parts" only consumes bound input nodes/);
  assert.match(prompt, /If an earlier phase writes a JSON report or manifest that should drive a later loop\.source\.kind = "input_parts", insert a derive_input_phase between them/);
  assert.match(prompt, /Common generator pattern: agent_phase writes outputs\/modules-manifest\.json -> derive_input_phase/);
  assert.match(prompt, /audit -> derive work -> dev -> verify automation pattern/);
  assert.match(prompt, /If a loop produces per_run chunk outputs, follow the loop with a cleanup\/publish phase/);
  assert.match(prompt, /runtime_verify_phase expectedOutputs must point to stable workspace-relative published files/);
  assert.match(prompt, /phase\.expectedOutputs as files that must be regenerated fresh during that phase/);
  assert.match(prompt, /For runtime_verify_phase, expectedOutputs should usually list only the files rewritten by the verify phase itself/);
  assert.match(prompt, /validator\.evidenceFrom or validator\.checks, or on the earlier publish phase expectedOutputs/);
  assert.match(prompt, /When the user asks for a specific final directory or file set, add workspace_validator checks for those stable published paths/);
  assert.match(prompt, /In any final README, index, manifest, or handoff note, link to the published stable files first/);
  assert.match(prompt, /refresh the root cepage-run\.json to match the published tree before final verification/);
  assert.match(prompt, /prefer a visible loop body with builder, reviewer, integrator\/refine, and tester steps/);
  assert.match(prompt, /prefer a top-level object with explicit keys such as items or sloAndCriteria plus an optional summary field/);
  assert.match(prompt, /Use json_path_exists, json_path_nonempty, or json_path_array_nonempty when validating structured JSON under a nested key/);
  assert.match(prompt, /Use json_array_nonempty only when the entire JSON file itself must be a non-empty top-level array/);
  assert.match(prompt, /workflow_transfer_valid/);
  assert.match(prompt, /outputs\/workflow-transfer\.json/);
  assert.match(prompt, /directly importable cepage\.workflow v2 object with exact top-level keys kind, version, exportedAt, and graph/);
  assert.match(prompt, /graph\.nodes must use full GraphNode envelopes and graph\.edges must use full GraphEdge envelopes/);
  assert.match(prompt, /prefer assemble -> lint -> publish -> verify phases/);
  assert.match(prompt, /Example agent step with explicit execution brief/);
  assert.match(prompt, /managed_flow: \{ title, syncMode: "managed"\|"mirrored", entryPhaseId, phases:/);
  assert.match(prompt, /keep ops as \[\] and emit only executions/);
  assert.match(prompt, /patch the latest bound input node instead of adding another bound input/);
});

test('buildPrompt renders the agent catalog and binding rules when a catalog is provided', () => {
  const snap = snapshot();
  const availableModels: AgentCatalog = {
    providers: [
      {
        agentType: 'opencode',
        providerID: 'opencode',
        label: 'OpenCode',
        availability: 'ready',
        models: [
          {
            providerID: 'minimax-coding-plan',
            modelID: 'MiniMax-M2.7-highspeed',
            label: 'minimax-coding-plan/MiniMax-M2.7-highspeed',
          },
          {
            providerID: 'kimi-for-coding-oauth',
            modelID: 'K2.6',
            label: 'kimi-for-coding-oauth/K2.6',
            isDefault: true,
          },
        ],
      },
      {
        agentType: 'cursor_agent',
        providerID: 'cursor_agent',
        label: 'Cursor Agent',
        availability: 'ready',
        models: [
          {
            providerID: 'openai',
            modelID: 'gpt-5.4',
            label: 'openai/gpt-5.4',
          },
        ],
      },
    ],
    fetchedAt: '2026-04-20T21:08:00.000Z',
  };
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'kimi-for-coding-oauth', modelID: 'K2.6' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
    availableModels,
  });

  assert.match(prompt, /Available agent providers\/models \(source of truth for model binding\):/);
  assert.match(prompt, /- agentType: opencode \(OpenCode\)/);
  assert.match(prompt, /- agentType: cursor_agent \(Cursor Agent\)/);
  assert.match(
    prompt,
    /providerID="minimax-coding-plan" modelID="MiniMax-M2\.7-highspeed"/,
  );
  assert.match(prompt, /providerID="kimi-for-coding-oauth" modelID="K2\.6" \*default/);
  assert.match(prompt, /providerID="openai" modelID="gpt-5\.4"/);
  assert.match(
    prompt,
    /BOTH model\.providerID AND model\.modelID MUST match exactly one pair listed in "Available agent providers\/models"/,
  );
  assert.match(prompt, /model\.providerID is NEVER an agentType token\./);
  assert.match(prompt, /"opencode"/);
  assert.match(prompt, /"cursor_agent"/);
  assert.match(
    prompt,
    /those are agentType values, not provider identifiers\. Pick a concrete provider id from the catalog/,
  );
  assert.match(prompt, /utilise opencode minimax 2\.7 high speed/);
  assert.match(prompt, /OMIT model from the node content \(so the thread default applies\)/);
});

test('buildPrompt warns when the agent catalog is unavailable', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'kimi-for-coding-oauth', modelID: 'K2.6' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
    availableModels: null,
  });

  assert.match(prompt, /Available agent providers\/models \(source of truth for model binding\):/);
  assert.match(
    prompt,
    /Agent catalog is unavailable \(daemon offline or no provider registered\)\./,
  );
  assert.match(
    prompt,
    /Keep the thread-selected provider\/model and do NOT invent new model\.providerID or model\.modelID values in this turn\./,
  );
  assert.match(
    prompt,
    /If the catalog section says the agent catalog is unavailable, never emit a new model object/,
  );
});

test('buildPrompt ask mode forces read-only answers', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
      scope: { kind: 'session' },
      mode: 'ask',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
  });

  assert.match(prompt, /Mode: ask/);
  assert.match(prompt, /Always return ops as \[\] and executions as \[\]\./);
  assert.match(prompt, /answer questions about the current workflow without changing the graph/i);
  assert.match(prompt, /ask mode does not modify the workflow/i);
  assert.match(prompt, /"ops": \[\]/);
  assert.match(prompt, /"executions": \[\]/);
});

test('buildPrompt includes concierge routing context', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Concierge',
      agentType: 'opencode',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      metadata: {
        role: 'concierge',
        presentation: 'simple',
        toolset: 'concierge',
        clarificationStatus: 'ready',
        clarificationCount: 0,
        skill: {
          id: 'app-builder-clean-return',
          title: 'App Builder With Clean Return',
        },
      },
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
    toolset: 'concierge',
    recall: [
      {
        kind: 'activity',
        title: 'Activity · agent',
        summary: 'Previous run produced a publishable app scaffold.',
        timestamp: '2026-04-07T10:01:00.000Z',
      },
    ],
    selectedSkill: {
      id: 'app-builder-clean-return',
      version: '1.0.0',
      kind: 'workflow_template',
      title: 'App Builder With Clean Return',
      summary: 'Build a runnable app.',
      tags: ['app'],
      routing: { keywords: ['app'], intents: ['app_builder'] },
      capabilities: [],
      requiredInputs: [],
      producedOutputs: [],
      recommendedFollowups: [],
      compositionHints: [],
      simpleExamples: [],
      defaultModules: [],
    },
    availableSkills: [],
  });

  assert.match(prompt, /Simple Chat concierge/i);
  assert.match(prompt, /Kernel toolset: concierge/);
  assert.match(prompt, /Durable recall for this turn/);
  assert.match(prompt, /Selected workflow skill/);
  assert.match(prompt, /Clarification state: ready/);
  assert.match(prompt, /Clarification progress: 0\/3/);
  assert.match(prompt, /App Builder With Clean Return/);
});

test('buildPrompt escalates the final concierge clarification turn', () => {
  const snap = snapshot();
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Concierge',
      agentType: 'opencode',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      metadata: {
        role: 'concierge',
        presentation: 'simple',
        toolset: 'concierge',
        clarificationStatus: 'needs_input',
        clarificationCount: 2,
      },
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
    toolset: 'concierge',
    availableSkills: [],
  });

  assert.match(prompt, /Clarification state: needs_input/);
  assert.match(prompt, /Clarification progress: 2\/3/);
  assert.match(prompt, /final clarification turn/i);
});

test('buildPrompt documents autoRun YOLO vs OFF execution policy', () => {
  const snap = snapshot();
  const base = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar' as const,
    ownerNodeId: undefined,
    title: 'Workflow copilot',
    agentType: 'opencode' as const,
    model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
    scope: { kind: 'session' as const },
    mode: 'edit' as const,
    autoApply: true,
    externalSessionId: undefined,
    createdAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:00:00.000Z',
  };
  const promptOn = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: { ...base, autoRun: true } satisfies WorkflowCopilotThread,
    history: [],
  });
  assert.match(promptOn, /Copilot autoRun: [\s\S]*ON — YOLO/);
  assert.match(promptOn, /workflow_run \| managed_flow_run \| controller_run/);
  const promptOff = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: { ...base, autoRun: false } satisfies WorkflowCopilotThread,
    history: [],
  });
  assert.match(promptOff, /Copilot autoRun:[\s\S]*OFF/);
});

test('buildPrompt surfaces upload context from file summary nodes', () => {
  const snap: GraphSnapshot = {
    ...snapshot(),
    nodes: [
      ...snapshot().nodes,
      node({
        id: 'goal-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'global_objective',
          label: 'Global objective',
          accepts: ['text'],
          multiple: false,
          required: true,
        },
      }),
      node({
        id: 'upload-1',
        type: 'file_summary',
        creator: { type: 'human', userId: 'u1' },
        content: {
          files: [
            {
              id: 'file-1',
              file: {
                kind: 'text',
                name: 'synthesis.md',
                size: 120,
                mimeType: 'text/markdown',
                uploadedAt: '2026-04-07T10:01:00.000Z',
              },
              extractedText: 'Gameplay loop notes for the uploaded brief.',
              status: 'pending',
            },
          ],
          status: 'pending',
        },
      }),
    ],
  };
  const prompt = buildPrompt({
    sessionId: 'session-1',
    workingDirectory: '/tmp/workspace',
    flow: workflowFromSnapshot(snap),
    scope: { kind: 'session' },
    scopeNodes: snap.nodes,
    thread: {
      id: 'thread-1',
      sessionId: 'session-1',
      surface: 'sidebar',
      ownerNodeId: undefined,
      title: 'Workflow copilot',
      agentType: 'opencode',
      model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
      scope: { kind: 'session' },
      mode: 'edit',
      autoApply: true,
      autoRun: false,
      externalSessionId: undefined,
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:00:00.000Z',
    } satisfies WorkflowCopilotThread,
    history: [],
  });

  assert.match(prompt, /Upload and file context \(context data only\):/);
  assert.match(prompt, /Existing input templates \(context data only\):/);
  assert.match(prompt, /goal-template \| Global objective \| key=global_objective/);
  assert.match(prompt, /synthesis\.md|Gameplay loop notes for the uploaded brief\./);
});

test('applyMessage creates a checkpoint and resolves temporary refs', async () => {
  const snap = snapshot();
  let storedApply: unknown = null;
  const checkpoints: unknown[] = [];
  const activityCalls: unknown[] = [];
  const createdNodes: Array<{ type: string; content: unknown }> = [];
  const createdEdges: Array<{ source: string; target: string; relation: string }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a note and linked it.',
    analysis: 'Add a companion note beside the root node.',
    summary: ['Add a note and connect it to the root node.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'draft_note',
        type: 'note',
        position: { x: 320, y: 160 },
        content: { text: 'Draft workflow note', format: 'markdown' },
      },
      {
        kind: 'add_edge',
        source: 'root',
        target: 'draft_note',
        relation: 'references',
        direction: 'source_to_target',
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints,
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async ({ data }: { data: { flow: unknown; summary: unknown } }) => {
        const row = {
          id: 'checkpoint-1',
          sessionId: 'session-1',
          threadId: 'thread-1',
          messageId: 'message-1',
          summary: data.summary,
          flow: data.flow,
          restoredAt: null,
          createdAt: new Date('2026-04-03T10:06:00.000Z'),
        };
        checkpoints.splice(0, checkpoints.length, row);
        return row;
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      createdNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'node-2',
          node: node({
            id: 'node-2',
            type: 'note',
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: { x: 320, y: 160 },
          }),
        },
      };
    },
    addEdge: async (
      _sessionId: string,
      input: { source: string; target: string; relation: string },
    ) => {
      createdEdges.push(input);
      return {
        eventId: 12,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:12.000Z',
        payload: {
          type: 'edge_added' as const,
          edgeId: 'edge-1',
          edge: {
            id: 'edge-1',
            source: input.source,
            target: input.target,
            relation: input.relation,
            direction: 'source_to_target' as const,
            strength: 1,
            createdAt: '2026-04-03T10:06:12.000Z',
            creator: { type: 'human', userId: 'u1' } as const,
            metadata: {},
          },
        },
      };
    },
    restoreWorkflow: async () => ({
      eventId: 13,
      counts: { nodes: snap.nodes.length, edges: snap.edges.length, branches: snap.branches.length },
    }),
  };

  const activity = {
    log: async (entry: unknown) => {
      activityCalls.push(entry);
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    activity as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  const res = await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes.length, 1);
  assert.equal(createdEdges.length, 1);
  assert.equal(createdEdges[0]?.source, 'root');
  assert.equal(createdEdges[0]?.target, 'node-2');
  assert.equal(createdEdges[0]?.relation, 'references');
  assert.deepEqual(
    ((checkpoints[0] as { flow: { graph?: unknown } }).flow.graph),
    workflowFromSnapshot(snap).graph,
  );
  assert.equal(res.message.apply?.checkpointId, 'checkpoint-1');
  assert.deepEqual(res.message.apply?.createdNodeIds, ['node-2']);
  assert.deepEqual(res.message.apply?.createdEdgeIds, ['edge-1']);
  assert.equal((activityCalls[0] as { summaryKey?: string }).summaryKey, 'activity.workflow_copilot_applied');
});

test('applyMessage strips copilotEmbeddedFiles and uploads bytes for new file_summary', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ type: string; content: unknown }> = [];
  const uploadCalls: Array<{
    sessionId: string;
    nodeId: string;
    files: Array<{ buffer: Buffer; originalname: string }>;
  }> = [];
  const snap = snapshot();
  const checkpoints: unknown[] = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const dataUrl = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'Attached files to workflow.',
    analysis: 'Add file_summary with uploads.',
    summary: ['Add context files.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'ctx',
        type: 'file_summary',
        position: { x: 200, y: 120 },
        content: {
          copilotEmbeddedFiles: [{ filename: 'a.txt', mime: 'text/plain', data: dataUrl }],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints,
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async ({ data }: { data: { flow: unknown; summary: unknown } }) => {
        const row = {
          id: 'checkpoint-1',
          sessionId: 'session-1',
          threadId: 'thread-1',
          messageId: 'message-1',
          summary: data.summary,
          flow: data.flow,
          restoredAt: null,
          createdAt: new Date('2026-04-03T10:06:00.000Z'),
        };
        checkpoints.splice(0, checkpoints.length, row);
        return row;
      },
    },
  };

  let loadSnaps = 0;
  const graph = {
    loadSnapshot: async () => {
      loadSnaps += 1;
      if (loadSnaps === 1) return snap;
      return {
        ...snap,
        lastEventId: 12,
        nodes: [
          ...snap.nodes,
          node({
            id: 'fs-1',
            type: 'file_summary',
            creator: { type: 'human', userId: 'u1' },
            content: { files: [], status: 'empty' },
            position: { x: 200, y: 120 },
          }),
        ],
      };
    },
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      createdNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'fs-1',
          node: node({
            id: 'fs-1',
            type: 'file_summary',
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: { x: 200, y: 120 },
          }),
        },
      };
    },
    addEdge: async (_sessionId: string, input: { source: string; target: string; relation: string }) => ({
      eventId: 12,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:20.000Z',
      payload: {
        type: 'edge_added' as const,
        edgeId: `edge-${input.source}-${input.target}-${input.relation}`,
        edge: {
          id: `edge-${input.source}-${input.target}-${input.relation}`,
          source: input.source,
          target: input.target,
          relation: input.relation as GraphEdge['relation'],
          direction: 'source_to_target' as const,
          strength: 0.5,
          createdAt: '2026-04-03T10:06:20.000Z',
          creator: { type: 'human', userId: 'u1' } as const,
          metadata: {},
        },
      },
    }),
    restoreWorkflow: async () => ({
      eventId: 13,
      counts: { nodes: snap.nodes.length, edges: snap.edges.length, branches: snap.branches.length },
    }),
  };

  const fileNodes = {
    upload: async (sessionId: string, nodeId: string, files: Array<{ buffer: Buffer; originalname: string }>) => {
      uploadCalls.push({ sessionId, nodeId, files });
      return { nodeId, patch: {}, eventId: 12 };
    },
  } as never;

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    fileNodes,
  );

  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes.length, 1);
  assert.equal(createdNodes[0]?.type, 'file_summary');
  assert.deepEqual(createdNodes[0]?.content, { files: [], status: 'empty' });
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0]?.sessionId, 'session-1');
  assert.equal(uploadCalls[0]?.nodeId, 'fs-1');
  assert.equal(uploadCalls[0]?.files[0]?.originalname, 'a.txt');
  assert.equal(uploadCalls[0]?.files[0]?.buffer.toString(), 'hello');
});

test('applyMessage normalizes invalid step nodes from copilot output', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ type: string; content: unknown }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a reusable step.',
    analysis: 'Create a reusable step node.',
    summary: ['Add a reusable step node.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'step',
        type: 'agent_spawn',
        position: { x: 320, y: 160 },
        content: {
          agentType: 'research',
          model: { providerID: 'openai', modelID: '' },
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot(),
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      createdNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'node-2',
          node: node({
            id: 'node-2',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: { x: 320, y: 160 },
          }),
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes[0]?.type, 'agent_step');
  assert.deepEqual(createdNodes[0]?.content, {
    agentType: 'opencode',
    agentSelection: {
      mode: 'locked',
      selection: {
        type: 'opencode',
      },
    },
  });
});

test('applyMessage rolls back partial graph changes when an edge endpoint is missing', async () => {
  let storedApply: unknown = null;
  let deletedCheckpointId: string | null = null;
  let restoreReason: string | null = null;
  let restoredFlow: ReturnType<typeof workflowFromSnapshot> | null = null;
  const snap = snapshot();
  const expectedFlow = workflowFromSnapshot(snap);

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a brief note.',
    analysis: 'Add a note and connect it to the graph.',
    summary: ['Add a brief note.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'brief-note',
        type: 'note',
        position: { x: 320, y: 160 },
        content: { text: 'Workflow brief', format: 'markdown' },
      },
      {
        kind: 'add_edge',
        source: 'missing-source',
        target: 'brief-note',
        relation: 'references',
        direction: 'source_to_target',
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async ({ where }: { where: { id: string } }) => {
        deletedCheckpointId = where.id;
        return { id: where.id };
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { content: unknown }) => ({
      eventId: 11,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:10.000Z',
      payload: {
        type: 'node_added' as const,
        nodeId: 'node-2',
        node: node({
          id: 'node-2',
          type: 'note',
          creator: { type: 'human', userId: 'u1' },
          content: input.content as GraphNode['content'],
          position: { x: 320, y: 160 },
        }),
      },
    }),
    addEdge: async () => {
      throw new Error('EDGE_ENDPOINTS_MISSING');
    },
    restoreWorkflow: async (
      _sessionId: string,
      flow: ReturnType<typeof workflowFromSnapshot>,
      _actor: unknown,
      reason?: string,
    ) => {
      restoredFlow = flow;
      restoreReason = reason ?? null;
      return {
        eventId: 12,
        counts: {
          nodes: flow.graph.nodes.length,
          edges: flow.graph.edges.length,
          branches: flow.graph.branches.length,
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => { throw new Error('activity.log should not be called'); } } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );

  await assert.rejects(
    () => service.applyMessage('session-1', 'thread-1', 'message-1'),
    /Workflow changes could not be applied because a proposed edge references a missing source or target node/,
  );

  assert.equal(deletedCheckpointId, 'checkpoint-1');
  assert.equal(restoreReason, 'workflow_copilot_apply_rollback');
  assert.ok(restoredFlow);
  const restored = restoredFlow as ReturnType<typeof workflowFromSnapshot>;
  assert.equal(restored.kind, expectedFlow.kind);
  assert.equal(restored.version, expectedFlow.version);
  assert.deepEqual(restored.graph, expectedFlow.graph);
  assert.equal(storedApply, null);
});

test('applyMessage is idempotent when add_edge targets an already-existing edge', async () => {
  // Regression: LLM sometimes re-emits an add_edge op for an edge that was
  // already materialized in a previous turn. Before the fix, graph-core
  // raised EDGE_DUPLICATE, the whole turn rolled back and the executions
  // array (including workflow_run) was dropped, leaving the user with an
  // "error" assistant message and no agent run. See session
  // ae67afbf-e057-4d7e-a2fc-1208d33dca0c for the production repro.
  let storedApply: unknown = null;
  let restoreCalled = false;
  let checkpointDeleted = false;
  let addEdgeCalls = 0;

  const snap: GraphSnapshot = {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 42,
    nodes: [
      node({
        id: 'template-node',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
      }),
      node({
        id: 'bound-node',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
      }),
    ],
    edges: [
      {
        id: 'edge-existing',
        source: 'template-node',
        target: 'bound-node',
        relation: 'derived_from',
        direction: 'source_to_target',
        strength: 0.5,
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
        createdAt: '2026-04-03T10:00:00.000Z',
      } satisfies GraphEdge,
    ],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'Reconnecting bound input to template.',
    analysis: 'Re-add the derived_from edge.',
    summary: ['Reconnect bound input to template.'],
    warnings: [],
    ops: [
      {
        kind: 'add_edge',
        source: 'template-node',
        target: 'bound-node',
        relation: 'derived_from',
        direction: 'source_to_target',
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async () => {
        checkpointDeleted = true;
        return { id: 'checkpoint-1' };
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snap,
    addEdge: async () => {
      addEdgeCalls += 1;
      throw new Error('graph.addEdge must not be called for duplicate add_edge op');
    },
    restoreWorkflow: async () => {
      restoreCalled = true;
      return { eventId: 99, counts: { nodes: 0, edges: 0, branches: 0 } };
    },
  };

  const activityEntries: Array<{ summary: string; summaryKey?: string }> = [];
  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    {
      log: async (entry: { summary: string; summaryKey?: string }) => {
        activityEntries.push({ summary: entry.summary, summaryKey: entry.summaryKey });
      },
    } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );

  const result = await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(addEdgeCalls, 0, 'duplicate add_edge should short-circuit before graph.addEdge');
  assert.equal(restoreCalled, false, 'no rollback should happen when the op is a no-op duplicate');
  assert.equal(checkpointDeleted, false, 'checkpoint should survive a successful apply');
  assert.ok(storedApply, 'apply summary should be persisted when the op list is a no-op');
  const applied = storedApply as {
    summary: string[];
    createdEdgeIds: string[];
    refMap?: Record<string, string>;
  };
  assert.ok(
    applied.summary.some((line) =>
      /already exists; skipped\.?/i.test(line),
    ),
    `summary should record the skipped duplicate edge, got: ${applied.summary.join(' | ')}`,
  );
  assert.deepEqual(applied.createdEdgeIds, [], 'no new edges should be created');
  assert.equal(result.thread.id, 'thread-1');
});

test('applyMessage normalizes managed flow nodes from copilot output', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ type: string; content: unknown }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added the managed orchestration flow.',
    analysis: 'Wrap the loop, audit, derive, and verify stages in one managed flow.',
    summary: ['Add a managed flow node.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'main-flow',
        type: 'managed_flow',
        position: { x: 520, y: 220 },
        content: {
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
              newExecution: true,
            },
            {
              id: 'derive',
              kind: 'derive',
              reportNodeId: 'gap-file',
              templateNodeId: 'chunks-template',
              path: 'missing',
              restartToPhaseId: 'dev',
            },
            {
              id: 'verify',
              kind: 'verify',
              runtimeNodeId: 'verify-step',
              outputs: ['outputs/verify.txt'],
            },
          ],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
    },
  };

  const snap: GraphSnapshot = {
    ...snapshot(),
    nodes: [
      ...snapshot().nodes,
      node({
        id: 'dev-loop',
        type: 'loop',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'for_each',
          source: { kind: 'inline_list', items: ['chunk-1'] },
          bodyNodeId: 'root',
          advancePolicy: 'only_on_pass',
          sessionPolicy: { withinItem: 'reuse_execution', betweenItems: 'new_execution' },
          blockedPolicy: 'pause_controller',
        },
      }),
      node({
        id: 'audit-step',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
      node({
        id: 'gap-file',
        type: 'workspace_file',
        creator: { type: 'human', userId: 'u1' },
        content: {
          title: 'Gap report',
          relativePath: 'outputs/gap-report.json',
          pathMode: 'static',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      }),
      node({
        id: 'chunks-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'work_chunks',
          label: 'Work chunks',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      }),
      node({
        id: 'verify-step',
        type: 'agent_step',
        creator: { type: 'human', userId: 'u1' },
        content: { agentType: 'opencode' },
      }),
    ],
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      createdNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'node-2',
          node: node({
            id: 'node-2',
            type: input.type as GraphNode['type'],
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: { x: 520, y: 220 },
          }),
        },
      };
    },
    addEdge: async (_sessionId: string, input: { source: string; target: string; relation: string }) => ({
      eventId: 12,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:20.000Z',
      payload: {
        type: 'edge_added' as const,
        edgeId: `edge-${input.source}-${input.target}-${input.relation}`,
        edge: {
          id: `edge-${input.source}-${input.target}-${input.relation}`,
          source: input.source,
          target: input.target,
          relation: input.relation as GraphEdge['relation'],
          direction: 'source_to_target' as const,
          strength: 0.5,
          createdAt: '2026-04-03T10:06:20.000Z',
          creator: { type: 'human', userId: 'u1' } as const,
          metadata: {},
        },
      },
    }),
    restoreWorkflow: async () => ({
      eventId: 13,
      counts: { nodes: snap.nodes.length, edges: snap.edges.length, branches: snap.branches.length },
    }),
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes[0]?.type, 'managed_flow');
  assert.deepEqual(createdNodes[0]?.content, {
    title: 'Main flow',
    syncMode: 'managed',
    entryPhaseId: 'dev',
    phases: [
      {
        id: 'dev',
        kind: 'loop_phase',
        nodeId: 'dev-loop',
      },
      {
        id: 'audit',
        kind: 'agent_phase',
        nodeId: 'audit-step',
        expectedOutputs: ['outputs/gap-report.json'],
        newExecution: true,
      },
      {
        id: 'derive',
        kind: 'derive_input_phase',
        sourceNodeId: 'gap-file',
        targetTemplateNodeId: 'chunks-template',
        jsonPath: 'missing',
        restartPhaseId: 'dev',
      },
      {
        id: 'verify',
        kind: 'runtime_verify_phase',
        nodeId: 'verify-step',
        expectedOutputs: ['outputs/verify.txt'],
      },
    ],
  });
});

test('applyMessage resolves forward refs inside managed_flow content after later nodes are added', async () => {
  let storedApply: unknown = null;
  let nextId = 1;
  const createdNodes: Array<{ id: string; type: string; content: unknown }> = [];
  const patchedNodes: Array<{ nodeId: string; patch: unknown }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a workflow generator.',
    analysis: 'Create the managed flow first, then the referenced nodes.',
    summary: ['Add a managed flow with forward refs.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'main-flow',
        type: 'managed_flow',
        position: { x: 520, y: 220 },
        content: {
          title: 'Main flow',
          entryPhaseId: 'spec',
          phases: [
            {
              id: 'spec',
              kind: 'agent_phase',
              nodeId: 'spec-step',
              expectedOutputs: ['outputs/workflow-spec.json'],
            },
            {
              id: 'derive',
              kind: 'derive_input_phase',
              sourceNodeId: 'spec-file',
              targetTemplateNodeId: 'chunks-template',
              jsonPath: 'modules',
            },
            {
              id: 'verify',
              kind: 'runtime_verify_phase',
              nodeId: 'verify-step',
              expectedOutputs: ['outputs/verify.txt'],
            },
          ],
          syncMode: 'managed',
        },
      },
      {
        kind: 'add_node',
        ref: 'spec-step',
        type: 'agent_step',
        position: { x: 100, y: 100 },
        content: { agentType: 'opencode' },
      },
      {
        kind: 'add_node',
        ref: 'spec-file',
        type: 'workspace_file',
        position: { x: 200, y: 100 },
        content: {
          title: 'Workflow spec',
          relativePath: 'outputs/workflow-spec.json',
          pathMode: 'static',
          role: 'output',
          origin: 'agent_output',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'chunks-template',
        type: 'input',
        position: { x: 300, y: 100 },
        content: {
          mode: 'template',
          key: 'work_chunks',
          label: 'Work chunks',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      },
      {
        kind: 'add_node',
        ref: 'verify-step',
        type: 'agent_step',
        position: { x: 400, y: 100 },
        content: { agentType: 'opencode' },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async () => undefined,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot(),
    addNode: async (_sessionId: string, input: { type: string; content: unknown; position: { x: number; y: number } }) => {
      const id = `node-${nextId++}`;
      createdNodes.push({ id, type: input.type, content: input.content });
      return {
        eventId: 10 + nextId,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: node({
            id,
            type: input.type as GraphNode['type'],
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: input.position,
          }),
        },
      };
    },
    addEdge: async (_sessionId: string, input: { source: string; target: string; relation: string }) => ({
      eventId: 200,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:30.000Z',
      payload: {
        type: 'edge_added' as const,
        edgeId: `edge-${input.source}-${input.target}-${input.relation}`,
        edge: {
          id: `edge-${input.source}-${input.target}-${input.relation}`,
          source: input.source,
          target: input.target,
          relation: input.relation as GraphEdge['relation'],
          direction: 'source_to_target' as const,
          strength: 0.5,
          createdAt: '2026-04-03T10:06:30.000Z',
          creator: { type: 'human', userId: 'u1' } as const,
          metadata: {},
        },
      },
    }),
    patchNode: async (_sessionId: string, nodeId: string, patch: unknown) => {
      patchedNodes.push({ nodeId, patch });
      return {
        eventId: 100 + patchedNodes.length,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:20.000Z',
        payload: {
          type: 'node_updated' as const,
          nodeId,
          patch,
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes[0]?.type, 'managed_flow');
  assert.equal(createdNodes[0]?.id, 'node-1');
  assert.equal(patchedNodes.length > 0, true);
  assert.deepEqual(patchedNodes[0], {
    nodeId: 'node-1',
    patch: {
      content: {
        title: 'Main flow',
        syncMode: 'managed',
        entryPhaseId: 'spec',
        phases: [
          {
            id: 'spec',
            kind: 'agent_phase',
            nodeId: 'node-2',
            expectedOutputs: ['outputs/workflow-spec.json'],
          },
          {
            id: 'derive',
            kind: 'derive_input_phase',
            sourceNodeId: 'node-3',
            targetTemplateNodeId: 'node-4',
            jsonPath: 'modules',
          },
          {
            id: 'verify',
            kind: 'runtime_verify_phase',
            nodeId: 'node-5',
            expectedOutputs: ['outputs/verify.txt'],
          },
        ],
      },
    },
  });
});

test('applyMessage materializes managed_flow structural edges for a game-dev flow', async () => {
  let storedApply: unknown = null;
  let nextId = 1;
  const createdEdges: Array<{ source: string; target: string; relation: string }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added the game-dev workflow.',
    analysis: 'Create one connected managed flow with visible review and stable outputs.',
    summary: ['Added a connected game-dev managed flow.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'chunks-template',
        type: 'input',
        position: { x: 80, y: 80 },
        content: {
          mode: 'template',
          key: 'slices',
          label: 'Slices',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      },
      {
        kind: 'add_node',
        ref: 'loop-validator',
        type: 'decision',
        position: { x: 80, y: 220 },
        content: {
          mode: 'workspace_validator',
          requirements: ['Slice result must exist.'],
          evidenceFrom: [],
          checks: [{ kind: 'path_exists', path: 'outputs/chunk.md' }],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      {
        kind: 'add_node',
        ref: 'chunk-step',
        type: 'agent_step',
        position: { x: 280, y: 80 },
        content: { agentType: 'opencode' },
      },
      {
        kind: 'add_node',
        ref: 'chunk-subgraph',
        type: 'sub_graph',
        position: { x: 280, y: 220 },
        content: {
          workflowRef: { kind: 'session', sessionId: 'session-1' },
          inputMap: {},
          execution: {},
          entryNodeId: 'chunk-step',
          expectedOutputs: ['outputs/chunk.md'],
        },
      },
      {
        kind: 'add_node',
        ref: 'chunk-file',
        type: 'workspace_file',
        position: { x: 280, y: 360 },
        content: {
          title: 'Chunk output',
          relativePath: 'outputs/chunk.md',
          pathMode: 'static',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'dev-loop',
        type: 'loop',
        position: { x: 480, y: 220 },
        content: {
          mode: 'for_each',
          source: { kind: 'input_parts', templateNodeId: 'chunks-template' },
          bodyNodeId: 'chunk-subgraph',
          validatorNodeId: 'loop-validator',
          advancePolicy: 'only_on_pass',
          sessionPolicy: { withinItem: 'reuse_execution', betweenItems: 'new_execution' },
          blockedPolicy: 'request_human',
        },
      },
      {
        kind: 'add_node',
        ref: 'audit-validator',
        type: 'decision',
        position: { x: 680, y: 80 },
        content: {
          mode: 'workspace_validator',
          requirements: ['Gap report must exist.'],
          evidenceFrom: [],
          checks: [{ kind: 'path_exists', path: 'outputs/gap-report.json' }],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      {
        kind: 'add_node',
        ref: 'audit-step',
        type: 'agent_step',
        position: { x: 680, y: 220 },
        content: { agentType: 'opencode' },
      },
      {
        kind: 'add_node',
        ref: 'gap-file',
        type: 'workspace_file',
        position: { x: 680, y: 360 },
        content: {
          title: 'Gap report',
          relativePath: 'outputs/gap-report.json',
          pathMode: 'static',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'verify-validator',
        type: 'decision',
        position: { x: 880, y: 80 },
        content: {
          mode: 'workspace_validator',
          requirements: ['Verify marker must exist.'],
          evidenceFrom: [],
          checks: [{ kind: 'file_last_line_equals', path: 'outputs/verify.txt', text: 'VERIFY_OK' }],
          passAction: 'pass',
          failAction: 'retry_same_item',
          blockAction: 'block',
        },
      },
      {
        kind: 'add_node',
        ref: 'verify-step',
        type: 'agent_step',
        position: { x: 880, y: 220 },
        content: { agentType: 'opencode' },
      },
      {
        kind: 'add_node',
        ref: 'verify-file',
        type: 'workspace_file',
        position: { x: 880, y: 360 },
        content: {
          title: 'Verify marker',
          relativePath: 'outputs/verify.txt',
          pathMode: 'static',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'runtime-manifest',
        type: 'workspace_file',
        position: { x: 1080, y: 220 },
        content: {
          title: 'Runtime manifest',
          relativePath: 'cepage-run.json',
          pathMode: 'static',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'main-flow',
        type: 'managed_flow',
        position: { x: 1240, y: 220 },
        content: {
          title: 'Express Route Chaos flow',
          entryPhaseId: 'dev',
          syncMode: 'managed',
          phases: [
            { id: 'dev', kind: 'loop_phase', nodeId: 'dev-loop' },
            {
              id: 'audit',
              kind: 'agent_phase',
              nodeId: 'audit-step',
              validatorNodeId: 'audit-validator',
              expectedOutputs: ['outputs/gap-report.json'],
            },
            {
              id: 'derive',
              kind: 'derive_input_phase',
              sourceNodeId: 'gap-file',
              targetTemplateNodeId: 'chunks-template',
              jsonPath: 'items',
            },
            {
              id: 'verify',
              kind: 'runtime_verify_phase',
              nodeId: 'verify-step',
              validatorNodeId: 'verify-validator',
              expectedOutputs: ['outputs/verify.txt'],
            },
          ],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async () => undefined,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot(),
    addNode: async (_sessionId: string, input: { type: string; content: unknown; position: { x: number; y: number } }) => {
      const id = `node-${nextId++}`;
      return {
        eventId: 10 + nextId,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: node({
            id,
            type: input.type as GraphNode['type'],
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: input.position,
          }),
        },
      };
    },
    addEdge: async (_sessionId: string, input: { source: string; target: string; relation: string }) => {
      createdEdges.push({
        source: input.source,
        target: input.target,
        relation: input.relation,
      });
      return {
        eventId: 200 + createdEdges.length,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:30.000Z',
        payload: {
          type: 'edge_added' as const,
          edgeId: `edge-${createdEdges.length}`,
          edge: {
            id: `edge-${createdEdges.length}`,
            source: input.source,
            target: input.target,
            relation: input.relation as GraphEdge['relation'],
            direction: 'source_to_target' as const,
            strength: 0.5,
            createdAt: '2026-04-03T10:06:30.000Z',
            creator: { type: 'human', userId: 'u1' } as const,
            metadata: {},
          },
        },
      };
    },
    patchNode: async () => {
      throw new Error('patchNode should not be called');
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );

  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.ok(createdEdges.some((edge) => edge.source === 'node-14' && edge.target === 'node-6' && edge.relation === 'contains'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-14' && edge.target === 'node-8' && edge.relation === 'contains'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-7' && edge.target === 'node-8' && edge.relation === 'validates'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-8' && edge.target === 'node-9' && edge.relation === 'produces'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-9' && edge.target === 'node-1' && edge.relation === 'feeds_into'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-10' && edge.target === 'node-11' && edge.relation === 'validates'));
  assert.ok(createdEdges.some((edge) => edge.source === 'node-11' && edge.target === 'node-12' && edge.relation === 'produces'));
});

test('applyMessage rejects managed_flow nodes with missing structured refs', async () => {
  let storedApply: unknown = null;
  let deletedCheckpointId: string | null = null;
  let restoreReason: string | null = null;

  const snap = snapshot();

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a broken managed flow.',
    analysis: 'This flow references a missing node.',
    summary: ['Add a broken managed flow.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'broken-flow',
        type: 'managed_flow',
        position: { x: 320, y: 160 },
        content: {
          title: 'Broken flow',
          entryPhaseId: 'verify',
          phases: [
            {
              id: 'verify',
              kind: 'runtime_verify_phase',
              nodeId: 'missing-verify-step',
              expectedOutputs: ['outputs/verify.txt'],
            },
          ],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async ({ where }: { where: { id: string } }) => {
        deletedCheckpointId = where.id;
        return { id: where.id };
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { content: unknown }) => ({
      eventId: 11,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:10.000Z',
      payload: {
        type: 'node_added' as const,
        nodeId: 'node-2',
        node: node({
          id: 'node-2',
          type: 'managed_flow',
          creator: { type: 'human', userId: 'u1' },
          content: input.content as GraphNode['content'],
          position: { x: 320, y: 160 },
        }),
      },
    }),
    restoreWorkflow: async (
      _sessionId: string,
      _flow: ReturnType<typeof workflowFromSnapshot>,
      _actor: unknown,
      reason?: string,
    ) => {
      restoreReason = reason ?? null;
      return {
        eventId: 12,
        counts: { nodes: snap.nodes.length, edges: snap.edges.length, branches: snap.branches.length },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => { throw new Error('activity.log should not be called'); } } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );

  await assert.rejects(
    () => service.applyMessage('session-1', 'thread-1', 'message-1'),
    /WORKFLOW_COPILOT_STRUCTURED_REF_MISSING/,
  );

  assert.equal(deletedCheckpointId, 'checkpoint-1');
  assert.equal(restoreReason, 'workflow_copilot_apply_rollback');
  assert.equal(storedApply, null);
});

test('applyMessage rejects final outputs that point to temporary paths', async () => {
  let storedApply: unknown = null;

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added a verify phase.',
    analysis: 'This flow incorrectly writes final output under /tmp.',
    summary: ['Add verify flow.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'verify-step',
        type: 'agent_step',
        position: { x: 120, y: 120 },
        content: { agentType: 'opencode' },
      },
      {
        kind: 'add_node',
        ref: 'verify-flow',
        type: 'managed_flow',
        position: { x: 320, y: 120 },
        content: {
          title: 'Bad verify flow',
          entryPhaseId: 'verify',
          syncMode: 'managed',
          phases: [
            {
              id: 'verify',
              kind: 'runtime_verify_phase',
              nodeId: 'verify-step',
              expectedOutputs: ['/tmp/verify.txt'],
            },
          ],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
      delete: async () => undefined,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot(),
    addNode: async (_sessionId: string, input: { type: string; content: unknown; position: { x: number; y: number } }) => ({
      eventId: 11,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:10.000Z',
      payload: {
        type: 'node_added' as const,
        nodeId: input.type === 'agent_step' ? 'node-2' : 'node-3',
        node: node({
          id: input.type === 'agent_step' ? 'node-2' : 'node-3',
          type: input.type as GraphNode['type'],
          creator: { type: 'human', userId: 'u1' },
          content: input.content as GraphNode['content'],
          position: input.position,
        }),
      },
    }),
    restoreWorkflow: async () => ({
      eventId: 12,
      counts: { nodes: 1, edges: 0, branches: 0 },
    }),
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => { throw new Error('activity.log should not be called'); } } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );

  await assert.rejects(
    () => service.applyMessage('session-1', 'thread-1', 'message-1'),
    /WORKFLOW_COPILOT_TEMP_OUTPUT_PATH/,
  );
});

test('applyMessage repairs template input patches into sibling bound inputs', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ type: string; content: unknown; position: { x: number; y: number } }> = [];
  const createdEdges: Array<{ source: string; target: string; relation: string }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I filled the existing input.',
    analysis: 'Repair the template patch into a proper bound input node.',
    summary: ['Filled the existing input.'],
    warnings: [],
    ops: [
      {
        kind: 'patch_node',
        nodeId: 'input-template',
        patch: {
          content: {
            mode: 'bound',
            parts: ['Build the survivors-like prototype', { text: 'Document the MVP systems' }],
            summary: 'Filled from uploaded docs.',
          },
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
    },
  };

  const snap: GraphSnapshot = {
    ...snapshot(),
    nodes: [
      ...snapshot().nodes,
      node({
        id: 'input-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        position: { x: 400, y: 500 },
        content: {
          mode: 'template',
          key: 'global_objective',
          label: 'Global objective',
          accepts: ['text'],
          multiple: false,
          required: true,
          instructions: 'Describe the target outcome.',
        },
      }),
    ],
  };

  const graph = {
    loadSnapshot: async () => snap,
    patchNode: async () => {
      throw new Error('patchNode should not be called for template-to-bound repairs');
    },
    addNode: async (
      _sessionId: string,
      input: { type: string; content: unknown; position: { x: number; y: number } },
    ) => {
      createdNodes.push({ type: input.type, content: input.content, position: input.position });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'bound-1',
          node: node({
            id: 'bound-1',
            type: 'input',
            creator: { type: 'human', userId: 'u1' },
            position: input.position,
            content: input.content as GraphNode['content'],
          }),
        },
      };
    },
    addEdge: async (
      _sessionId: string,
      input: { source: string; target: string; relation: string },
    ) => {
      createdEdges.push(input);
      return {
        eventId: 12,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:12.000Z',
        payload: {
          type: 'edge_added' as const,
          edgeId: 'edge-1',
          edge: {
            id: 'edge-1',
            source: input.source,
            target: input.target,
            relation: input.relation,
            direction: 'source_to_target' as const,
            strength: 1,
            createdAt: '2026-04-03T10:06:12.000Z',
            creator: { type: 'human', userId: 'u1' } as const,
            metadata: {},
          },
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.equal(createdNodes.length, 1);
  assert.deepEqual(createdNodes[0]?.position, { x: 440, y: 660 });
  const bound = readWorkflowInputContent(createdNodes[0]?.content);
  assert.equal(bound?.mode, 'bound');
  assert.equal(bound?.templateNodeId, 'input-template');
  assert.equal(bound?.label, 'Global objective');
  assert.deepEqual(bound?.parts, [
    { id: 'part-1', type: 'text', text: 'Build the survivors-like prototype' },
    { id: 'part-2', type: 'text', text: 'Document the MVP systems' },
  ]);
  assert.equal(createdEdges.length, 1);
  assert.equal(createdEdges[0]?.source, 'input-template');
  assert.equal(createdEdges[0]?.target, 'bound-1');
  assert.equal(createdEdges[0]?.relation, 'derived_from');
});

test('applyMessage expands chunk-like bound inputs into multiple real parts', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ type: string; content: unknown }> = [];

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I filled the chunk list.',
    analysis: 'Create a bound input with explicit implementation chunks.',
    summary: ['Filled the chunk list.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        type: 'input',
        position: { x: 320, y: 320 },
        content: {
          mode: 'bound',
          templateNodeId: 'chunks-template',
          summary: '4 implementation chunks for the app build.',
          parts: [
            {
              id: 'part-1',
              type: 'text',
              text: '1. Bootstrap a runnable scaffold\n2. Build the first playable loop\n3. Add progression and enemy systems\n4. Run runtime smoke and polish',
            },
          ],
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
    },
  };

  const snap: GraphSnapshot = {
    ...snapshot(),
    nodes: [
      ...snapshot().nodes,
      node({
        id: 'chunks-template',
        type: 'input',
        creator: { type: 'human', userId: 'u1' },
        content: {
          mode: 'template',
          key: 'chunks',
          label: 'Implementation chunks',
          accepts: ['text'],
          multiple: true,
          required: true,
          instructions: 'Create one chunk per gameplay milestone.',
        },
      }),
    ],
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      createdNodes.push({ type: input.type, content: input.content });
      return {
        eventId: 11,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: 'bound-1',
          node: node({
            id: 'bound-1',
            type: 'input',
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
          }),
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  const bound = readWorkflowInputContent(createdNodes[0]?.content);
  assert.equal(bound?.mode, 'bound');
  assert.equal(bound?.templateNodeId, 'chunks-template');
  assert.equal(bound?.parts.length, 4);
  assert.deepEqual(bound?.parts.map((part) => (part.type === 'text' ? part.text : '')), [
    'Bootstrap a runnable scaffold',
    'Build the first playable loop',
    'Add progression and enemy systems',
    'Run runtime smoke and polish',
  ]);
});

test('applyMessage normalizes structured workflow node content and nested refs', async () => {
  let storedApply: unknown = null;
  const createdNodes: Array<{ id: string; type: string; content: unknown }> = [];
  const createdEdges: Array<{ source: string; target: string; relation: string }> = [];
  let nextId = 1;

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    content: 'I added the chunk workflow controller.',
    analysis: 'Create normalized loop, sub-graph, and validator nodes.',
    summary: ['Added normalized structured workflow nodes.'],
    warnings: [],
    ops: [
      {
        kind: 'add_node',
        ref: 'input-morceaux',
        type: 'input',
        position: { x: 120, y: 120 },
        content: {
          mode: 'template',
          key: 'morceaux',
          label: 'Morceaux',
          accepts: ['text'],
          multiple: true,
          required: true,
        },
      },
      {
        kind: 'add_node',
        ref: 'step-traiter-morceau',
        type: 'agent_step',
        position: { x: 320, y: 120 },
        content: {
          agentType: 'cursor_agent',
        },
      },
      {
        kind: 'add_node',
        ref: 'dec-valider-morceau',
        type: 'decision',
        position: { x: 520, y: 120 },
        content: {
          mode: 'workspace_validator',
          requirements: 'Le livrable doit exister.',
          checks: [
            {
              kind: 'file_contains',
              path: 'artifacts/chunk-result.md',
              substring: 'CHUNK_TERMINE',
            },
            {
              kind: 'json_path_array_nonempty',
              path: 'outputs/gap-report.json',
              jsonPath: 'items',
            },
            {
              kind: 'workflow_transfer_valid',
              path: 'outputs/workflow-transfer.json',
            },
          ],
          passAction: 'advance',
          failAction: 'retry_body',
          blockAction: 'pause',
        },
      },
      {
        kind: 'add_node',
        ref: 'subgraph-morceau',
        type: 'sub_graph',
        position: { x: 720, y: 120 },
        content: {
          inputMap: {
            morceau_courant: {
              template: '{{loop.item_text}}',
              format: 'text',
            },
          },
          execution: {
            type: 'new_execution',
            model: {
              providerID: 'cursor',
              modelID: 'composer-2-fast',
            },
          },
          entryNodeId: 'step-traiter-morceau',
          workflowRef: {
            kind: 'session',
            sessionId: 'session-1',
          },
          expectedOutputs: ['artifacts/chunk-result.md'],
        },
      },
      {
        kind: 'add_node',
        ref: 'file-morceau',
        type: 'workspace_file',
        position: { x: 840, y: 240 },
        content: {
          title: 'Livrable morceau',
          relativePath: 'artifacts/chunk-result.md',
          pathMode: 'per_run',
          resolvedRelativePath: 'artifacts/run-deadbeef/chunk-result.md',
          role: 'output',
          origin: 'derived',
          kind: 'text',
          transferMode: 'reference',
          summary: 'Livrable du morceau courant.',
          status: 'declared',
        },
      },
      {
        kind: 'add_node',
        ref: 'loop-morceau',
        type: 'loop',
        position: { x: 920, y: 120 },
        content: {
          mode: 'for_each',
          source: {
            kind: 'input_parts',
            inputNodeId: 'input-morceaux',
          },
          itemLabel: 'morceau',
          bodyNodeId: 'subgraph-morceau',
          advancePolicy: 'only_on_pass',
          blockedPolicy: 'request_human',
          sessionPolicy: {
            withinItem: 'reuse_execution',
            betweenItems: 'new_execution',
          },
          validatorNodeId: 'dec-valider-morceau',
          maxAttemptsPerItem: 8,
        },
      },
    ],
    apply: storedApply,
    error: null,
    scope: { kind: 'session' },
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    rawOutput: '{"analysis":"..."}',
    createdAt: new Date('2026-04-03T10:05:00.000Z'),
    updatedAt: new Date('2026-04-03T10:05:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages: [{ ...message, apply: storedApply }],
              checkpoints: [],
            }
          : thread,
    },
    workflowCopilotMessage: {
      findUnique: async () => ({ ...message, apply: storedApply }),
      update: async ({ data }: { data: { apply?: unknown } }) => {
        storedApply = data.apply ?? null;
        return { ...message, apply: storedApply };
      },
    },
    workflowCopilotCheckpoint: {
      create: async () => ({
        id: 'checkpoint-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        summary: [],
        flow: {},
        restoredAt: null,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
      }),
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot(),
    addNode: async (_sessionId: string, input: { type: string; content: unknown }) => {
      const id = `node-${nextId++}`;
      createdNodes.push({ id, type: input.type, content: input.content });
      return {
        eventId: 10 + nextId,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:10.000Z',
        payload: {
          type: 'node_added' as const,
          nodeId: id,
          node: node({
            id,
            type: input.type as GraphNode['type'],
            creator: { type: 'human', userId: 'u1' },
            content: input.content as GraphNode['content'],
            position: { x: 320, y: 160 },
          }),
        },
      };
    },
    addEdge: async (
      _sessionId: string,
      input: { source: string; target: string; relation: string },
    ) => {
      createdEdges.push({
        source: input.source,
        target: input.target,
        relation: input.relation,
      });
      return {
        eventId: 100 + createdEdges.length,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: '2026-04-03T10:06:20.000Z',
        payload: {
          type: 'edge_added' as const,
          edgeId: `edge-${createdEdges.length}`,
          edge: {
            id: `edge-${createdEdges.length}`,
            source: input.source,
            target: input.target,
            relation: input.relation as never,
            direction: 'source_to_target' as const,
            strength: 0.5,
            createdAt: '2026-04-03T10:06:20.000Z',
            creator: { type: 'human', userId: 'u1' } as const,
            metadata: {},
          },
        },
      };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await service.applyMessage('session-1', 'thread-1', 'message-1');

  assert.deepEqual(createdNodes.find((entry) => entry.type === 'decision')?.content, {
    mode: 'workspace_validator',
    requirements: ['Le livrable doit exister.'],
    evidenceFrom: [],
    checks: [
      {
        kind: 'file_contains',
        path: 'artifacts/chunk-result.md',
        text: 'CHUNK_TERMINE',
      },
      {
        kind: 'json_path_array_nonempty',
        path: 'outputs/gap-report.json',
        jsonPath: 'items',
      },
      {
        kind: 'workflow_transfer_valid',
        path: 'outputs/workflow-transfer.json',
      },
    ],
    passAction: 'pass',
    failAction: 'retry_same_item',
    blockAction: 'block',
  });

  assert.deepEqual(createdNodes.find((entry) => entry.type === 'sub_graph')?.content, {
    workflowRef: {
      kind: 'session',
      sessionId: 'session-1',
    },
    inputMap: {
      morceau_courant: {
        template: '{{loop.item_text}}',
      },
    },
    execution: {
      newExecution: true,
      model: {
        providerID: 'cursor',
        modelID: 'composer-2-fast',
      },
    },
    expectedOutputs: ['artifacts/chunk-result.md'],
    entryNodeId: 'node-2',
  });

  assert.deepEqual(createdNodes.find((entry) => entry.type === 'workspace_file')?.content, {
    title: 'Livrable morceau',
    relativePath: 'artifacts/chunk-result.md',
    pathMode: 'per_run',
    role: 'output',
    origin: 'derived',
    kind: 'text',
    transferMode: 'reference',
    summary: 'Livrable du morceau courant.',
    status: 'declared',
  });

  assert.deepEqual(createdNodes.find((entry) => entry.type === 'loop')?.content, {
    mode: 'for_each',
    source: {
      kind: 'input_parts',
      templateNodeId: 'node-1',
    },
    bodyNodeId: 'node-4',
    validatorNodeId: 'node-3',
    advancePolicy: 'only_on_pass',
    sessionPolicy: {
      withinItem: 'reuse_execution',
      betweenItems: 'new_execution',
    },
    maxAttemptsPerItem: 8,
    blockedPolicy: 'request_human',
    itemLabel: 'morceau',
  });
  assert.deepEqual(createdEdges, [
    {
      source: 'node-1',
      target: 'node-6',
      relation: 'feeds_into',
    },
    {
      source: 'node-2',
      target: 'node-5',
      relation: 'produces',
    },
    {
      source: 'node-3',
      target: 'node-6',
      relation: 'validates',
    },
    {
      source: 'node-4',
      target: 'node-2',
      relation: 'contains',
    },
    {
      source: 'node-6',
      target: 'node-4',
      relation: 'contains',
    },
  ]);
});

test('restoreCheckpoint accepts v2 control-flow checkpoints', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
  };

  const checkpoint = {
    id: 'checkpoint-1',
    sessionId: 'session-1',
    threadId: 'thread-1',
    messageId: 'message-1',
    summary: ['Restore loop controller'],
    flow: {
      kind: 'cepage.workflow',
      version: 2,
      exportedAt: '2026-04-07T10:00:00.000Z',
      graph: {
        nodes: [
          node({
            id: 'loop-1',
            type: 'loop',
            creator: { type: 'human', userId: 'u1' },
            content: {
              mode: 'for_each',
              source: {
                kind: 'inline_list',
                items: ['chunk-1', 'chunk-2'],
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
          }),
          node({
            id: 'step-1',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: { agentType: 'opencode' },
          }),
          node({
            id: 'validator-1',
            type: 'decision',
            creator: { type: 'human', userId: 'u1' },
            content: {
              mode: 'workspace_validator',
              requirements: ['The item must produce a deliverable.'],
              checks: [{ kind: 'path_exists', path: 'deliverable.md' }],
              passAction: 'pass',
              failAction: 'retry_same_item',
              blockAction: 'block',
            },
          }),
        ],
        edges: [],
        branches: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
    restoredAt: null as Date | null,
    createdAt: new Date('2026-04-07T10:01:00.000Z'),
  };
  let restoredFlow: unknown = null;
  const checkpoints = [checkpoint];
  const messages = [
    {
      id: 'message-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      content: 'Restore loop controller',
      analysis: null,
      summary: [],
      warnings: [],
      ops: [],
      apply: { checkpointId: 'checkpoint-1' },
      error: null,
      scope: { kind: 'session' },
      agentType: 'opencode',
      modelProviderId: 'anthropic',
      modelId: 'claude-4.5-sonnet',
      rawOutput: null,
      createdAt: new Date('2026-04-07T10:00:30.000Z'),
      updatedAt: new Date('2026-04-07T10:00:30.000Z'),
    },
  ];

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints,
            }
          : thread,
    },
    workflowCopilotMessage: {
      findMany: async () => messages,
    },
    workflowCopilotCheckpoint: {
      findUnique: async () => checkpoint,
      update: async ({ data }: { data: { restoredAt?: Date } }) => {
        checkpoint.restoredAt = data.restoredAt ?? null;
        return checkpoint;
      },
    },
  };

  const graph = {
    restoreWorkflow: async (_sessionId: string, flow: unknown) => {
      restoredFlow = flow;
      return { eventId: 11 };
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  const res = await service.restoreCheckpoint('session-1', 'thread-1', 'checkpoint-1');

  assert.equal((restoredFlow as { version?: unknown }).version, 2);
  assert.equal(
    (restoredFlow as { graph?: { nodes?: Array<{ type?: unknown }> } }).graph?.nodes?.[0]?.type,
    'loop',
  );
  assert.equal(res.checkpoint.id, 'checkpoint-1');
  assert.deepEqual(res.messages.map((entry) => entry.id), ['message-1']);
});

test('restoreCheckpoint discards later copilot messages from the active thread', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-08T10:00:00.000Z'),
    updatedAt: new Date('2026-04-08T10:00:00.000Z'),
  };
  const messages = [
    {
      id: 'message-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'completed',
      content: 'Try option A.',
      analysis: null,
      summary: [],
      warnings: [],
      ops: [],
      apply: null,
      error: null,
      scope: { kind: 'session' },
      agentType: 'opencode',
      modelProviderId: 'anthropic',
      modelId: 'claude-4.5-sonnet',
      rawOutput: null,
      createdAt: new Date('2026-04-08T10:01:00.000Z'),
      updatedAt: new Date('2026-04-08T10:01:00.000Z'),
    },
    {
      id: 'message-2',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      content: 'Applied option A.',
      analysis: null,
      summary: ['Applied option A.'],
      warnings: [],
      ops: [],
      apply: { checkpointId: 'checkpoint-1', summary: [], createdNodeIds: [], updatedNodeIds: [], removedNodeIds: [], createdEdgeIds: [], removedEdgeIds: [], createdBranchIds: [], mergedBranchIds: [], abandonedBranchIds: [], viewportUpdated: false, appliedAt: '2026-04-08T10:02:00.000Z' },
      error: null,
      scope: { kind: 'session' },
      agentType: 'opencode',
      modelProviderId: 'anthropic',
      modelId: 'claude-4.5-sonnet',
      rawOutput: null,
      createdAt: new Date('2026-04-08T10:02:00.000Z'),
      updatedAt: new Date('2026-04-08T10:02:00.000Z'),
    },
    {
      id: 'message-3',
      threadId: 'thread-1',
      role: 'user',
      status: 'completed',
      content: 'Now try option B.',
      analysis: null,
      summary: [],
      warnings: [],
      ops: [],
      apply: null,
      error: null,
      scope: { kind: 'session' },
      agentType: 'opencode',
      modelProviderId: 'anthropic',
      modelId: 'claude-4.5-sonnet',
      rawOutput: null,
      createdAt: new Date('2026-04-08T10:03:00.000Z'),
      updatedAt: new Date('2026-04-08T10:03:00.000Z'),
    },
    {
      id: 'message-4',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      content: 'Applied option B.',
      analysis: null,
      summary: ['Applied option B.'],
      warnings: [],
      ops: [],
      apply: { checkpointId: 'checkpoint-2', summary: [], createdNodeIds: [], updatedNodeIds: [], removedNodeIds: [], createdEdgeIds: [], removedEdgeIds: [], createdBranchIds: [], mergedBranchIds: [], abandonedBranchIds: [], viewportUpdated: false, appliedAt: '2026-04-08T10:04:00.000Z' },
      error: null,
      scope: { kind: 'session' },
      agentType: 'opencode',
      modelProviderId: 'anthropic',
      modelId: 'claude-4.5-sonnet',
      rawOutput: null,
      createdAt: new Date('2026-04-08T10:04:00.000Z'),
      updatedAt: new Date('2026-04-08T10:04:00.000Z'),
    },
  ];
  const checkpoints = [
    {
      id: 'checkpoint-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      messageId: 'message-2',
      summary: ['Restore option A'],
      flow: {
        kind: 'cepage.workflow',
        version: 2,
        exportedAt: '2026-04-08T10:02:00.000Z',
        graph: {
          nodes: [node({ id: 'note-1', type: 'note', creator: { type: 'human', userId: 'u1' } })],
          edges: [],
          branches: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      restoredAt: null as Date | null,
      createdAt: new Date('2026-04-08T10:02:00.000Z'),
    },
    {
      id: 'checkpoint-2',
      sessionId: 'session-1',
      threadId: 'thread-1',
      messageId: 'message-4',
      summary: ['Restore option B'],
      flow: {
        kind: 'cepage.workflow',
        version: 2,
        exportedAt: '2026-04-08T10:04:00.000Z',
        graph: {
          nodes: [node({ id: 'note-2', type: 'note', creator: { type: 'human', userId: 'u1' } })],
          edges: [],
          branches: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      restoredAt: null as Date | null,
      createdAt: new Date('2026-04-08T10:04:00.000Z'),
    },
  ];

  const prisma = {
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints,
            }
          : thread,
    },
    workflowCopilotMessage: {
      findMany: async () => messages,
      deleteMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
        const ids = new Set(where.id?.in ?? []);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (ids.has(messages[index]?.id ?? '')) {
            messages.splice(index, 1);
          }
        }
        return { count: ids.size };
      },
    },
    workflowCopilotCheckpoint: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        checkpoints.find((entry) => entry.id === where.id) ?? null,
      deleteMany: async ({ where }: { where: { messageId?: { in?: string[] } } }) => {
        const ids = new Set(where.messageId?.in ?? []);
        for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
          if (ids.has(checkpoints[index]?.messageId ?? '')) {
            checkpoints.splice(index, 1);
          }
        }
        return { count: ids.size };
      },
      update: async ({ where, data }: { where: { id: string }; data: { restoredAt?: Date } }) => {
        const row = checkpoints.find((entry) => entry.id === where.id);
        if (!row) throw new Error('checkpoint not found');
        row.restoredAt = data.restoredAt ?? null;
        return row;
      },
    },
  };
  const graph = {
    restoreWorkflow: async () => ({ eventId: 21 }),
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  const res = await service.restoreCheckpoint('session-1', 'thread-1', 'checkpoint-1');

  assert.deepEqual(messages.map((entry) => entry.id), ['message-1', 'message-2']);
  assert.deepEqual(checkpoints.map((entry) => entry.id), ['checkpoint-1']);
  assert.deepEqual(res.messages.map((entry) => entry.id), ['message-1', 'message-2']);
  assert.deepEqual(res.checkpoints.map((entry) => entry.id), ['checkpoint-1']);
});

test('getThread repairs a parse-failed assistant message from raw output', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const raw = JSON.stringify({
    analysis: 'L’utilisateur veut une direction Pixelmon.',
    message: 'J’ai mis à jour le brief.',
    changes: 'Style brief refreshed.',
    operations: [
      {
        kind: 'add_node',
        node: {
          ref: 'style-brief',
          type: 'note',
          position: { x: 320, y: 160 },
          content: { text: 'Pixelmon style brief', format: 'markdown' },
        },
      },
      {
        kind: 'add_edge',
        source: 'root',
        target: 'style-brief',
        relation: 'references',
        direction: 'source_to_target',
      },
    ],
  });

  const prisma = {
    workflowCopilotThread: {
      findUnique: async () => ({
        ...thread,
        messages: [
          {
            id: 'message-1',
            threadId: 'thread-1',
            role: 'assistant',
            status: 'error',
            content: raw,
            analysis: null,
            summary: [],
            warnings: [],
            ops: [],
            apply: null,
            error: 'WORKFLOW_COPILOT_PARSE_FAILED',
            scope: { kind: 'session' },
            agentType: 'opencode',
            modelProviderId: 'anthropic',
            modelId: 'claude-4.5-sonnet',
            rawOutput: raw,
            createdAt: new Date('2026-04-03T10:05:00.000Z'),
            updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          },
        ],
        checkpoints: [],
      }),
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  const bundle = await service.getThread('session-1', 'thread-1');

  assert.equal(bundle.messages.length, 1);
  assert.equal(bundle.messages[0]?.status, 'completed');
  assert.equal(bundle.messages[0]?.analysis, 'L’utilisateur veut une direction Pixelmon.');
  assert.equal(bundle.messages[0]?.content, 'J’ai mis à jour le brief.');
  assert.deepEqual(bundle.messages[0]?.summary, ['Style brief refreshed.']);
  assert.deepEqual(bundle.messages[0]?.ops, [
    {
      kind: 'add_node',
      ref: 'style-brief',
      type: 'note',
      position: { x: 320, y: 160 },
      content: { text: 'Pixelmon style brief', format: 'markdown' },
    },
    {
      kind: 'add_edge',
      source: 'root',
      target: 'style-brief',
      relation: 'references',
      direction: 'source_to_target',
    },
  ]);
  assert.equal(bundle.messages[0]?.error, undefined);
});

test('sendMessage emits live copilot updates and preserves streamed output', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        thread.agentType = (data.agentType as string | undefined) ?? thread.agentType;
        thread.modelProviderId = (data.modelProviderId as string | null | undefined) ?? thread.modelProviderId;
        thread.modelId = (data.modelId as string | null | undefined) ?? thread.modelId;
        thread.mode = (data.mode as string | undefined) ?? thread.mode;
        thread.externalSessionId =
          (data.externalSessionId as string | null | undefined) ?? thread.externalSessionId;
        thread.updatedAt = new Date('2026-04-03T10:06:00.000Z');
        return thread;
      },
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
    {
      emitSession: (_sessionId: string, event: Record<string, unknown>) => {
        events.push(event);
      },
    } as never,
  );
  (
    service as unknown as {
      runThread: (
        session: unknown,
        thread: unknown,
        history: unknown,
        signal: AbortSignal,
        onProgress?: (progress: {
          rawOutput: string;
          snapshotOutput: string;
          externalSessionId?: string;
        }) => Promise<void>,
      ) => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
        };
        externalSessionId: string;
      }>;
    }
  ).runThread = async (_session, _thread, _history, _signal, onProgress) => {
    await onProgress?.({
      rawOutput: 'step 1',
      snapshotOutput: '',
      externalSessionId: undefined,
    });
    await onProgress?.({
      rawOutput: 'step 1\nstep 2',
      snapshotOutput: '',
      externalSessionId: 'ext-1',
    });
    return {
      ok: true,
      rawOutput:
        '{"analysis":"Tracked the live run.","reply":"Done.","summary":["Stream finished."],"warnings":[],"ops":[],"executions":[]}',
      turn: {
        analysis: 'Tracked the live run.',
        reply: 'Done.',
        summary: ['Stream finished.'],
        warnings: [],
        ops: [],
        executions: [],
      },
      externalSessionId: 'ext-1',
    };
  };

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'Track the live run.',
    mode: 'ask',
  });

  assert.equal(res.thread.externalSessionId, 'ext-1');
  assert.equal(res.assistantMessage.content, 'Done.');
  assert.equal((messages[1] as { status?: unknown } | undefined)?.status, 'completed');
  assert.equal((messages[1] as { rawOutput?: unknown } | undefined)?.rawOutput, 'step 1\nstep 2');

  const live = events.find((event) => {
    if (event.type !== 'workflow.copilot_message_updated') return false;
    const payload = event.payload as {
      message?: { status?: unknown; rawOutput?: unknown };
    };
    return payload.message?.status === 'pending' && payload.message?.rawOutput === 'step 1';
  });
  assert.ok(live);

  const final = events.find((event) => {
    if (event.type !== 'workflow.copilot_message_updated') return false;
    const payload = event.payload as {
      message?: { status?: unknown; rawOutput?: unknown };
    };
    return payload.message?.status === 'completed' && payload.message?.rawOutput === 'step 1\nstep 2';
  });
  assert.ok(final);

  const synced = events.find((event) => {
    if (event.type !== 'workflow.copilot_thread_updated') return false;
    const payload = event.payload as { externalSessionId?: unknown };
    return payload.externalSessionId === 'ext-1';
  });
  assert.ok(synced);
});

test('sendMessage increments concierge clarification count when routing is unresolved', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Concierge',
    agentType: 'opencode',
    modelProviderId: 'openai',
    modelId: 'gpt-5.4',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    metadata: {
      role: 'concierge',
      presentation: 'simple',
      clarificationStatus: 'needs_input',
      clarificationCount: 1,
    },
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        thread.agentType = (data.agentType as string | undefined) ?? thread.agentType;
        thread.modelProviderId = (data.modelProviderId as string | null | undefined) ?? thread.modelProviderId;
        thread.modelId = (data.modelId as string | null | undefined) ?? thread.modelId;
        thread.mode = (data.mode as string | undefined) ?? thread.mode;
        thread.metadata = (data.metadata as typeof thread.metadata | undefined) ?? thread.metadata;
        thread.updatedAt = new Date('2026-04-03T10:06:00.000Z');
        return thread;
      },
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
    { emitSession: () => {} } as never,
    { forWorkflowCopilot: async () => [] } as never,
    {
      routeSkill: async () => null,
      listSkills: async () => [],
      getSkill: async () => {
        throw new Error('not used');
      },
      getSkillPrompt: async () => null,
    } as never,
  );
  (
    service as unknown as {
      runThread: (
        session: unknown,
        thread: unknown,
        history: unknown,
        signal: AbortSignal,
      ) => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"Need one more detail.","reply":"What should I optimize first?","summary":[],"warnings":[],"ops":[],"executions":[]}',
    turn: {
      analysis: 'Need one more detail.',
      reply: 'What should I optimize first?',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'Help me with this app workflow.',
    mode: 'ask',
  });

  assert.equal(res.thread.metadata?.clarificationStatus, 'needs_input');
  assert.equal(res.thread.metadata?.clarificationCount, 2);
});

test('sendMessage keeps pinned concierge skill when lockSkill is enabled', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Concierge',
    agentType: 'opencode',
    modelProviderId: 'openai',
    modelId: 'gpt-5.4',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    metadata: {
      role: 'concierge',
      presentation: 'simple',
      lockSkill: true,
      clarificationStatus: 'ready',
      clarificationCount: 0,
      skill: {
        id: 'documentation-pack-clean-return',
        title: 'Documentation Pack With Clean Return',
        version: '1.0.0',
      },
    },
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];
  let candidatesCalls = 0;
  let routeCalls = 0;

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        thread.metadata = (data.metadata as typeof thread.metadata | undefined) ?? thread.metadata;
        return thread;
      },
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
    workflowCopilotCheckpoint: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: `checkpoint-${messages.length}`,
        createdAt: new Date('2026-04-03T10:06:00.000Z'),
        ...data,
      }),
    },
  };

  const skills = {
    listSkills: async () => [],
    getSkill: async () => ({
      id: 'documentation-pack-clean-return',
      version: '1.0.0',
      kind: 'workflow_template',
      title: 'Documentation Pack With Clean Return',
      summary: 'Build docs.',
      promptFile: 'documentation-pack-clean-return.md',
      tags: [],
      routing: { keywords: [], intents: [] },
      capabilities: [],
      requiredInputs: [],
      producedOutputs: ['docs/index.md'],
      compositionHints: [],
      simpleExamples: [],
      defaultModules: [],
      expectedWorkflow: undefined,
    }),
    getSkillPrompt: async () => null,
    routeSkill: async () => {
      routeCalls += 1;
      return {
        id: 'game-dev-managed-flow-clean-return',
        version: '1.0.0',
        kind: 'workflow_template',
        title: 'Game Dev Managed Flow With Clean Return',
        summary: 'Build a game workflow.',
        promptFile: 'game-dev-managed-flow-clean-return.md',
        tags: [],
        routing: { keywords: [], intents: [] },
        capabilities: [],
        requiredInputs: [],
        producedOutputs: ['outputs/final-review.md'],
        compositionHints: [],
        simpleExamples: [],
        defaultModules: [],
        expectedWorkflow: undefined,
      };
    },
    routeSkillCandidates: async () => {
      candidatesCalls += 1;
      return [
        {
          id: 'game-dev-managed-flow-clean-return',
          title: 'Game Dev Managed Flow With Clean Return',
          version: '1.0.0',
        },
      ];
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    { loadSnapshot: async () => snapshot() } as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
    { emitSession: () => {} } as never,
    undefined,
    skills as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput: '{"analysis":"Pinned.","reply":"Done.","summary":[],"warnings":[],"ops":[],"executions":[]}',
    turn: {
      analysis: 'Pinned.',
      reply: 'Done.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'Use the pinned workflow and the existing workspace files.',
    mode: 'ask',
  });

  assert.equal(routeCalls, 0);
  assert.equal(candidatesCalls, 0);
  assert.equal(res.thread.metadata?.skill?.id, 'documentation-pack-clean-return');
  assert.equal(res.thread.metadata?.lockSkill, true);
});

test('sendMessage accepts application/json attachments for cursor_agent', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'cursor_agent',
    modelProviderId: 'openai',
    modelId: 'gpt-5.4',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];
  const rawJson = '{"a":1}';
  const dataUrl = `data:application/json;base64,${Buffer.from(rawJson, 'utf8').toString('base64')}`;

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    { loadSnapshot: async () => snapshot() } as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions?: Array<unknown>;
        };
        externalSessionId?: string;
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"ok","reply":"Read JSON.","summary":[],"warnings":[],"ops":[],"executions":[]}',
    turn: {
      analysis: 'ok',
      reply: 'Read JSON.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
    },
  });

  await service.sendMessage('session-1', 'thread-1', {
    content: 'Use the spec',
    mode: 'ask',
    attachments: [
      {
        filename: 'spec.json',
        relativePath: 'docs/spec.json',
        mime: 'application/json',
        data: dataUrl,
      },
    ],
  });

  const userRow = messages.find((m) => m.role === 'user');
  assert.ok(userRow);
  assert.deepEqual(userRow.attachments, [
    {
      filename: 'spec.json',
      relativePath: 'docs/spec.json',
      mime: 'application/json',
      data: dataUrl,
    },
  ]);
});

test('sendMessage rejects non-text attachments for cursor_agent', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'cursor_agent',
    modelProviderId: 'openai',
    modelId: 'gpt-5.4',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async () => thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        ...thread,
        ...data,
      }),
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await assert.rejects(
    () =>
      service.sendMessage('session-1', 'thread-1', {
        content: 'Describe',
        mode: 'ask',
        attachments: [
          {
            filename: 'a.png',
            mime: 'image/png',
            data: 'data:image/png;base64,AAAA',
          },
        ],
      }),
    /WORKFLOW_COPILOT_ATTACHMENTS_UNSUPPORTED/,
  );
});

test('sendMessage rejects oversized text attachment context for cursor_agent', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'cursor_agent',
    modelProviderId: 'openai',
    modelId: 'gpt-5.4',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null as string | null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async () => thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        ...thread,
        ...data,
      }),
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  const big = 'x'.repeat(WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES + 1);
  const dataUrl = `data:text/plain;base64,${Buffer.from(big, 'utf8').toString('base64')}`;
  await assert.rejects(
    () =>
      service.sendMessage('session-1', 'thread-1', {
        content: 'Describe',
        mode: 'ask',
        attachments: [
          {
            filename: 'docs.txt',
            relativePath: 'docs/docs.txt',
            mime: 'text/plain',
            data: dataUrl,
          },
        ],
      }),
    /Cursor Agent attachment context is too large/,
  );
});

test('sendMessage ask mode strips ops and skips apply', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput: '{"analysis":"Explain the workflow state.","reply":"The workflow starts from the root note.","summary":["Explained the current workflow."],"warnings":[],"ops":[{"kind":"add_node","type":"note","position":{"x":320,"y":180},"content":{"text":"Should not be applied","format":"markdown"}}]}',
    turn: {
      analysis: 'Explain the workflow state.',
      reply: 'The workflow starts from the root note.',
      summary: ['Explained the current workflow.'],
      warnings: [],
      ops: [
        {
          kind: 'add_node',
          type: 'note',
          position: { x: 320, y: 180 },
          content: { text: 'Should not be applied', format: 'markdown' },
        },
      ],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'How does this workflow work?',
    mode: 'ask',
  });

  assert.equal(res.thread.mode, 'ask');
  assert.equal(res.assistantMessage.content, 'The workflow starts from the root note.');
  assert.deepEqual(res.assistantMessage.ops, []);
  assert.deepEqual(res.assistantMessage.executions, []);
  assert.deepEqual((messages[1] as { ops?: unknown[] } | undefined)?.ops, []);
  assert.equal(res.checkpoints.length, 0);
});

test('sendMessage materializes attachments into a new file_summary when requested', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];
  const uploads: Array<{ sessionId: string; nodeId: string; n: number; names: string[] }> = [];
  let addNodeCalls = 0;

  const graphStub = {
    loadSnapshot: async () => snapshot(),
    addNode: async (
      _sessionId: string,
      input: { position: { x: number; y: number }; type?: string },
    ) => {
      addNodeCalls += 1;
      assert.equal(input.position.x, 42);
      assert.equal(input.position.y, 99);
      return {
        eventId: 11,
        payload: {
          type: 'node_added',
          node: node({
            id: 'file-node-new',
            type: 'file_summary',
            creator: { type: 'human', userId: 'local-user' },
            content: { files: [], status: 'empty' },
            position: input.position,
          }),
        },
      };
    },
  };

  const fileNodesStub = {
    upload: async (sessionId: string, nodeId: string, files: unknown[]) => {
      uploads.push({
        sessionId,
        nodeId,
        n: files.length,
        names: (files as Array<{ originalname?: string }>).map((file) => file.originalname ?? ''),
      });
      return { nodeId, patch: {}, eventId: 12 };
    },
  };

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graphStub as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    fileNodesStub as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: unknown[];
          executions: unknown[];
        };
        externalSessionId?: string;
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"","reply":"ok","summary":[],"warnings":[],"ops":[],"executions":[],"attachmentGraph":{"kind":"new","position":{"x":42,"y":99}}}',
    turn: {
      analysis: '',
      reply: 'ok',
      summary: [],
      warnings: [],
      ops: [],
      executions: [],
      attachmentGraph: { kind: 'new', position: { x: 42, y: 99 } },
    },
    externalSessionId: undefined,
  });

  const dataUrl = `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`;
  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'See file',
    mode: 'ask',
    attachments: [
      {
        filename: 'n.txt',
        relativePath: 'docs/n.txt',
        mime: 'text/plain',
        data: dataUrl,
      },
    ],
  });

  assert.equal(addNodeCalls, 1);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.nodeId, 'file-node-new');
  assert.equal(uploads[0]?.n, 1);
  assert.deepEqual(uploads[0]?.names, ['docs/n.txt']);
  assert.equal(res.fileSummaryNodeId, 'file-node-new');
});

test('sendMessage runs copilot executions when autoRun is ON', async () => {
  let runCalls = 0;
  const agents = {
    runWorkflow: async (sessionId: string, body: unknown) => {
      runCalls += 1;
      assert.equal(sessionId, 'session-1');
      assert.equal((body as { triggerNodeId?: string }).triggerNodeId, 'root');
      assert.equal((body as { type?: string }).type, 'opencode');
      return {
        executionId: 'exec-1',
        agentRunId: 'run-1',
        rootNodeId: 'root',
        status: 'running',
        wakeReason: 'external_event',
        boundNodeIds: [],
      };
    },
  } as never;

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: false,
    autoRun: true,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      findUnique: async ({ where }: { where: { id: string } }) =>
        (messages.find((entry) => entry.id === where.id) as Record<string, unknown> | undefined) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    agents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"Run requested.","reply":"Starting run.","summary":[],"warnings":[],"ops":[],"executions":[{"kind":"workflow_run","type":"opencode","triggerNodeId":"root"}]}',
    turn: {
      analysis: 'Run requested.',
      reply: 'Starting run.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [{ kind: 'workflow_run', type: 'opencode', triggerNodeId: 'root' }],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', { content: 'Run the workflow step on root.' });

  assert.equal(runCalls, 1);
  assert.equal(res.assistantMessage.executions.length, 1);
  assert.equal(res.assistantMessage.executionResults.length, 1);
  assert.equal(res.assistantMessage.executionResults[0]?.ok, true);
  assert.equal(res.assistantMessage.executionResults[0]?.kind, 'workflow_run');
});

test('sendMessage coerces bogus workflow_run.type to the trigger node agentType', async () => {
  const capturedTypes: string[] = [];
  const agents = {
    runWorkflow: async (_sessionId: string, body: unknown) => {
      capturedTypes.push((body as { type?: string }).type ?? '');
      return {
        executionId: 'exec-1',
        agentRunId: 'run-1',
        rootNodeId: 'agent-step-root',
        status: 'running',
        wakeReason: 'external_event',
        boundNodeIds: [],
      };
    },
  } as never;

  const graph = {
    loadSnapshot: async () => {
      const base = snapshot();
      return {
        ...base,
        nodes: [
          node({
            id: 'agent-step-root',
            type: 'agent_step',
            creator: { type: 'human', userId: 'u1' },
            content: {
              agentType: 'opencode',
              agentSelection: {
                mode: 'locked',
                selection: {
                  type: 'opencode',
                  model: { providerID: 'anthropic', modelID: 'claude-4.5-sonnet' },
                },
              },
            },
            position: { x: 0, y: 0 },
          }),
        ],
      };
    },
  } as never;

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: false,
    autoRun: true,
    externalSessionId: null,
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-21T10:05:00.000Z'),
          updatedAt: new Date('2026-04-21T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      findUnique: async ({ where }: { where: { id: string } }) =>
        (messages.find((entry) => entry.id === where.id) as Record<string, unknown> | undefined) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-21T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph,
    {} as never,
    agents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"Run requested.","reply":"Starting run.","summary":[],"warnings":[],"ops":[],"executions":[{"kind":"workflow_run","type":"orchestrator","triggerNodeId":"agent-step-root"}]}',
    turn: {
      analysis: 'Run requested.',
      reply: 'Starting run.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [
        { kind: 'workflow_run', type: 'orchestrator', triggerNodeId: 'agent-step-root' },
      ],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', { content: 'Execute the workflow.' });

  assert.deepEqual(capturedTypes, ['opencode']);
  assert.equal(res.assistantMessage.executionResults[0]?.ok, true);
  assert.equal(res.assistantMessage.executionResults[0]?.kind, 'workflow_run');
});

test('sendMessage skips executions when autoRun is OFF', async () => {
  let runCalls = 0;
  const agents = {
    runWorkflow: async () => {
      runCalls += 1;
      return {
        executionId: 'exec-1',
        agentRunId: 'run-1',
        rootNodeId: 'root',
        status: 'running',
        wakeReason: 'external_event',
        boundNodeIds: [],
      };
    },
  } as never;

  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: false,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      findUnique: async ({ where }: { where: { id: string } }) =>
        (messages.find((entry) => entry.id === where.id) as Record<string, unknown> | undefined) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    agents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
          executions: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"Run requested.","reply":"Recorded.","summary":[],"warnings":[],"ops":[],"executions":[{"kind":"workflow_run","type":"opencode","triggerNodeId":"root"}]}',
    turn: {
      analysis: 'Run requested.',
      reply: 'Recorded.',
      summary: [],
      warnings: [],
      ops: [],
      executions: [{ kind: 'workflow_run', type: 'opencode', triggerNodeId: 'root' }],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', { content: 'Queue a run.' });

  assert.equal(runCalls, 0);
  assert.equal(res.assistantMessage.executions.length, 1);
  assert.deepEqual(res.assistantMessage.executionResults, []);
});

test('sendMessage returns the assistant reply when auto-apply fails on invalid edge refs', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  const messages: Array<Record<string, unknown>> = [];
  const checkpoints: Array<Record<string, unknown>> = [];
  const snap = snapshot();

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints,
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...thread, ...data }),
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      findUnique: async ({ where }: { where: { id: string } }) =>
        (messages.find((entry) => entry.id === where.id) as Record<string, unknown> | undefined) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
    workflowCopilotCheckpoint: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `checkpoint-${checkpoints.length + 1}`,
          restoredAt: null,
          createdAt: new Date('2026-04-03T10:06:00.000Z'),
          ...data,
        };
        checkpoints.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = checkpoints.findIndex((entry) => entry.id === where.id);
        if (index >= 0) checkpoints.splice(index, 1);
        return { id: where.id };
      },
    },
  };

  const graph = {
    loadSnapshot: async () => snap,
    addNode: async (_sessionId: string, input: { content: unknown }) => ({
      eventId: 11,
      sessionId: 'session-1',
      actor: { type: 'human', userId: 'u1' } as const,
      timestamp: '2026-04-03T10:06:10.000Z',
      payload: {
        type: 'node_added' as const,
        nodeId: 'node-2',
        node: node({
          id: 'node-2',
          type: 'note',
          creator: { type: 'human', userId: 'u1' },
          content: input.content as GraphNode['content'],
          position: { x: 320, y: 160 },
        }),
      },
    }),
    addEdge: async () => {
      throw new Error('EDGE_ENDPOINTS_MISSING');
    },
    restoreWorkflow: async (sessionId: string, flow: ReturnType<typeof workflowFromSnapshot>) => ({
      eventId: 12,
      counts: {
        nodes: flow.graph.nodes.length,
        edges: flow.graph.edges.length,
        branches: flow.graph.branches.length,
      },
      sessionId,
    }),
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => { throw new Error('activity.log should not be called'); } } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: () => Promise<{
        ok: true;
        rawOutput: string;
        turn: {
          analysis: string;
          reply: string;
          summary: string[];
          warnings: string[];
          ops: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).runThread = async () => ({
    ok: true,
    rawOutput:
      '{"analysis":"Add a brief note.","reply":"I added a brief note.","summary":["Added a brief note."],"warnings":[],"ops":[{"kind":"add_node","ref":"brief-note","type":"note","position":{"x":320,"y":160},"content":{"text":"Workflow brief","format":"markdown"}},{"kind":"add_edge","source":"missing-source","target":"brief-note","relation":"references","direction":"source_to_target"}]}',
    turn: {
      analysis: 'Add a brief note.',
      reply: 'I added a brief note.',
      summary: ['Added a brief note.'],
      warnings: [],
      ops: [
        {
          kind: 'add_node',
          ref: 'brief-note',
          type: 'note',
          position: { x: 320, y: 160 },
          content: { text: 'Workflow brief', format: 'markdown' },
        },
        {
          kind: 'add_edge',
          source: 'missing-source',
          target: 'brief-note',
          relation: 'references',
          direction: 'source_to_target',
        },
      ],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'Add a brief note',
  });

  assert.equal(res.userMessage.content, 'Add a brief note');
  assert.equal(res.assistantMessage.status, 'error');
  assert.equal(res.assistantMessage.content, 'I added a brief note.');
  assert.equal(res.assistantMessage.apply, undefined);
  assert.deepEqual(res.assistantMessage.ops, [
    {
      kind: 'add_node',
      ref: 'brief-note',
      type: 'note',
      position: { x: 320, y: 160 },
      content: { text: 'Workflow brief', format: 'markdown' },
    },
    {
      kind: 'add_edge',
      source: 'missing-source',
      target: 'brief-note',
      relation: 'references',
      direction: 'source_to_target',
    },
  ]);
  assert.match(
    res.assistantMessage.error ?? '',
    /Workflow changes could not be applied because a proposed edge references a missing source or target node/,
  );
  assert.equal(res.checkpoints.length, 0);
});

test('applyMessage rejects ask mode threads', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'ask',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const prisma = {
    workflowCopilotThread: {
      findUnique: async () => thread,
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  await assert.rejects(
    () => service.applyMessage('session-1', 'thread-1', 'message-1'),
    /WORKFLOW_COPILOT_APPLY_DISABLED_IN_ASK_MODE/,
  );
});

test('sendMessage keeps node-owned threads on the locked node selection', async () => {
  const messages: Array<Record<string, unknown>> = [];
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'node',
    ownerKey: 'node:copilot-1',
    ownerNodeId: 'copilot-1',
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'node', nodeId: 'copilot-1' },
    mode: 'ask',
    autoApply: false,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };
  let updatedThread: {
    agentType?: unknown;
    modelProviderId?: unknown;
    modelId?: unknown;
  } | null = null;

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updatedThread = data;
        thread.agentType = (data.agentType as string | undefined) ?? thread.agentType;
        thread.modelProviderId = (data.modelProviderId as string | null | undefined) ?? thread.modelProviderId;
        thread.modelId = (data.modelId as string | null | undefined) ?? thread.modelId;
        thread.mode = (data.mode as string | undefined) ?? thread.mode;
        return thread;
      },
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };
  const graph = {
    loadSnapshot: async () => ({
      ...snapshot(),
      nodes: [
        node({
          id: 'copilot-1',
          type: 'workflow_copilot',
          creator: { type: 'human', userId: 'u1' },
          content: {
            title: 'Copilot',
            agentSelection: {
              mode: 'locked',
              selection: {
                type: 'cursor_agent',
                model: {
                  providerID: 'openai',
                  modelID: 'gpt-5.4',
                },
              },
            },
          },
        }),
      ],
    }),
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    graph as never,
    { log: async () => {} } as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (service as unknown as { runThread: (...args: unknown[]) => Promise<unknown> }).runThread = async () => ({
    ok: true,
    rawOutput: '{"reply":"Locked response","summary":[],"warnings":[],"ops":[]}',
    turn: {
      reply: 'Locked response',
      summary: [],
      warnings: [],
      ops: [],
    },
  });

  const res = await service.sendMessage('session-1', 'thread-1', {
    content: 'Explain the node',
    mode: 'ask',
    agentType: 'opencode',
    model: {
      providerID: 'anthropic',
      modelID: 'claude-4.5-sonnet',
    },
  });

  const updated = (updatedThread ?? {}) as {
    agentType?: unknown;
    modelProviderId?: unknown;
    modelId?: unknown;
  };
  assert.equal(updated.agentType, 'cursor_agent');
  assert.equal(updated.modelProviderId, 'openai');
  assert.equal(updated.modelId, 'gpt-5.4');
  assert.equal((messages[0] as { agentType?: unknown }).agentType, 'cursor_agent');
  assert.equal((messages[0] as { modelProviderId?: unknown }).modelProviderId, 'openai');
  assert.deepEqual(res.thread.model, {
    providerID: 'openai',
    modelID: 'gpt-5.4',
  });
});

test('stopThread aborts an in-flight copilot turn', async () => {
  const thread = {
    id: 'thread-1',
    sessionId: 'session-1',
    surface: 'sidebar',
    ownerKey: 'sidebar',
    ownerNodeId: null,
    title: 'Workflow copilot',
    agentType: 'opencode',
    modelProviderId: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    scope: { kind: 'session' },
    mode: 'edit',
    autoApply: true,
    autoRun: false,
    externalSessionId: null,
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  };

  const messages: Array<Record<string, unknown>> = [];
  let started: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let stopped = false;

  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    workflowCopilotThread: {
      findUnique: async ({ include }: { include?: unknown }) =>
        include
          ? {
              ...thread,
              messages,
              checkpoints: [],
            }
          : thread,
      update: async () => thread,
    },
    workflowCopilotMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date('2026-04-03T10:05:00.000Z'),
          updatedAt: new Date('2026-04-03T10:05:00.000Z'),
          ...data,
        };
        messages.push(row);
        return row;
      },
      findMany: async () => messages,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id);
        if (!row) throw new Error('message not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-04-03T10:06:00.000Z'),
        });
        return row;
      },
    },
  };

  const service = new WorkflowCopilotService(
    prisma as never,
    {} as never,
    {} as never,
    stubCopilotAgents,
    stubCopilotFlows,
    stubCopilotControllers,
    stubFileNodes as never,
  );
  (
    service as unknown as {
      runThread: (
        session: unknown,
        thread: unknown,
        history: unknown,
        signal: AbortSignal,
      ) => Promise<{
        ok: false;
        rawOutput: string;
        error: string;
      }>;
    }
  ).runThread = async (_session, _thread, _history, signal) => {
    started?.();
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          stopped = true;
          resolve();
        },
        { once: true },
      );
    });
    return {
      ok: false,
      rawOutput: '',
      error: WORKFLOW_COPILOT_STOPPED,
    };
  };

  const pending = service.sendMessage('session-1', 'thread-1', {
    content: 'Stop after this starts.',
  });
  await ready;

  const res = await service.stopThread('session-1', 'thread-1');
  const send = await pending;

  assert.equal(res.stopped, true);
  assert.equal(stopped, true);
  assert.equal(send.assistantMessage.error, WORKFLOW_COPILOT_STOPPED);
});
