import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOW_COPILOT_STOPPED,
  type AgentCatalog,
  type AgentType,
  type WorkflowCopilotExecution,
  type WorkflowCopilotExecutionResult,
  type WorkflowCopilotOp,
  type WorkflowCopilotTurn,
} from '@cepage/shared-core';
import {
  buildRepairFeedback,
  detectRuntimeIssues,
  detectTurnIssues,
  isRecoverableApplyError,
  isRecoverableByRepair,
  summarizeIssues,
  WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS,
  type RepairIssue,
} from '../workflow-copilot-repair.js';
import { WORKFLOW_COPILOT_PARSE_FAILED } from '../workflow-copilot-turn.js';
import type { RunTurnResult } from '../workflow-copilot.types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyTurn: WorkflowCopilotTurn = {
  analysis: '',
  reply: '',
  summary: [],
  warnings: [],
  ops: [],
  executions: [],
  attachmentGraph: { kind: 'none' },
};

function okRun(partial: Partial<WorkflowCopilotTurn> = {}): RunTurnResult {
  return {
    ok: true,
    rawOutput: '{}',
    turn: { ...emptyTurn, ...partial },
  };
}

function failRun(error: string): RunTurnResult {
  return { ok: false, rawOutput: '', error };
}

function buildCatalog(): AgentCatalog {
  return {
    providers: [
      {
        agentType: 'opencode',
        providerID: 'openai',
        label: 'OpenAI',
        availability: 'ready',
        models: [
          { providerID: 'openai', modelID: 'gpt-4o', label: 'GPT-4o', isDefault: true },
          { providerID: 'openai', modelID: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        ],
      },
      {
        agentType: 'opencode',
        providerID: 'anthropic',
        label: 'Anthropic',
        availability: 'ready',
        models: [
          { providerID: 'anthropic', modelID: 'claude-3-5-sonnet', label: 'Sonnet 3.5' },
        ],
      },
      // Provider that is declared but offline: must be ignored by the matcher
      // and by the suggestion ranking (no "unavailable" pairs should leak).
      {
        agentType: 'opencode',
        providerID: 'google',
        label: 'Google',
        availability: 'unavailable',
        unavailableReason: 'GOOGLE_DAEMON_OFFLINE',
        models: [
          { providerID: 'google', modelID: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
        ],
      },
      {
        agentType: 'cursor_agent',
        providerID: 'cursor',
        label: 'Cursor',
        availability: 'ready',
        models: [{ providerID: 'cursor', modelID: 'cursor-auto', label: 'Cursor Auto' }],
      },
    ],
    fetchedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  };
}

function addNodeOp(content: Record<string, unknown>, ref = 'n1'): WorkflowCopilotOp {
  return {
    kind: 'add_node',
    ref,
    type: 'note',
    position: { x: 0, y: 0 },
    content,
  } as unknown as WorkflowCopilotOp;
}

function patchNodeOp(content: Record<string, unknown>, nodeId = 'existing-1'): WorkflowCopilotOp {
  return {
    kind: 'patch_node',
    nodeId,
    patch: { content },
  } as unknown as WorkflowCopilotOp;
}

function workflowRunExec(params: {
  nodeRef?: string;
  nodeId?: string;
  type?: AgentType;
  providerID?: string;
  modelID?: string;
}): WorkflowCopilotExecution {
  const model =
    params.providerID && params.modelID
      ? { providerID: params.providerID, modelID: params.modelID }
      : undefined;
  return {
    kind: 'workflow_run',
    nodeRef: params.nodeRef,
    nodeId: params.nodeId,
    type: params.type,
    model,
  } as unknown as WorkflowCopilotExecution;
}

const threadAgentType: AgentType = 'opencode';

// ---------------------------------------------------------------------------
// WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS
// ---------------------------------------------------------------------------

test('WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS defaults to 2 when env var is unset', () => {
  // The module is loaded once per process; at load time the env var is unset
  // in the Node test harness so the default applies.
  assert.equal(WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS, 2);
});

// ---------------------------------------------------------------------------
// isRecoverableByRepair
// ---------------------------------------------------------------------------

test('isRecoverableByRepair marks infra-style issues as non-recoverable', () => {
  assert.equal(isRecoverableByRepair({ kind: 'runtime_fail', error: 'oom' }), false);
  assert.equal(isRecoverableByRepair({ kind: 'stopped', error: WORKFLOW_COPILOT_STOPPED }), false);
});

test('isRecoverableByRepair marks agent-authored issues as recoverable', () => {
  const recoverable: RepairIssue[] = [
    { kind: 'parse_fail', error: WORKFLOW_COPILOT_PARSE_FAILED },
    {
      kind: 'model_not_in_catalog',
      location: { kind: 'op', opIndex: 0, opKind: 'add_node', path: 'content.model' },
      agentType: 'opencode',
      providerID: 'openai',
      modelID: 'fake',
      suggestions: [],
    },
    { kind: 'agent_type_unrunnable', executionIndex: 0, type: 'ghost', runnable: ['opencode'] },
    { kind: 'apply_fail', message: 'EDGE_ENDPOINTS_MISSING' },
    {
      kind: 'execution_fail',
      executionIndex: 0,
      executionKind: 'workflow_run',
      error: 'boom',
    },
  ];
  for (const issue of recoverable) {
    assert.equal(isRecoverableByRepair(issue), true, `expected ${issue.kind} to be recoverable`);
  }
});

// ---------------------------------------------------------------------------
// detectTurnIssues — failed runs
// ---------------------------------------------------------------------------

test('detectTurnIssues maps WORKFLOW_COPILOT_PARSE_FAILED to a single parse_fail issue', () => {
  const issues = detectTurnIssues({
    run: failRun(WORKFLOW_COPILOT_PARSE_FAILED),
    catalog: null,
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, [{ kind: 'parse_fail', error: WORKFLOW_COPILOT_PARSE_FAILED }]);
});

test('detectTurnIssues maps WORKFLOW_COPILOT_STOPPED to a single stopped issue', () => {
  const issues = detectTurnIssues({
    run: failRun(WORKFLOW_COPILOT_STOPPED),
    catalog: null,
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, [{ kind: 'stopped', error: WORKFLOW_COPILOT_STOPPED }]);
});

test('detectTurnIssues maps other errors to runtime_fail (non-recoverable)', () => {
  const issues = detectTurnIssues({
    run: failRun('BOOM'),
    catalog: null,
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, [{ kind: 'runtime_fail', error: 'BOOM' }]);
});

// ---------------------------------------------------------------------------
// detectTurnIssues — model binding
// ---------------------------------------------------------------------------

test('detectTurnIssues without a catalog cannot certify bindings and returns []', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [
        addNodeOp({
          agentType: 'opencode',
          model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
        }),
      ],
    }),
    catalog: null,
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, []);
});

test('detectTurnIssues with empty provider list behaves like a missing catalog', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [
        addNodeOp({ model: { providerID: 'openai', modelID: 'ghost-1' } }),
      ],
    }),
    catalog: { providers: [], fetchedAt: new Date().toISOString() },
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, []);
});

test('detectTurnIssues flags add_node model not in catalog with op location', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [
        addNodeOp(
          {
            agentType: 'opencode',
            model: { providerID: 'google', modelID: 'gemini-1.5-flash' },
          },
          'agent-node',
        ),
      ],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode']),
    threadAgentType,
  });
  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.kind, 'model_not_in_catalog');
  if (issue.kind !== 'model_not_in_catalog') return;
  assert.equal(issue.providerID, 'google');
  assert.equal(issue.modelID, 'gemini-1.5-flash');
  assert.equal(issue.agentType, 'opencode');
  assert.deepEqual(issue.location, {
    kind: 'op',
    opIndex: 0,
    opKind: 'add_node',
    ref: 'agent-node',
    path: 'content.model',
  });
  // Suggestions must only contain live, matching-agentType pairs
  assert.ok(issue.suggestions.length > 0);
  assert.ok(issue.suggestions.length <= 3);
  for (const suggestion of issue.suggestions) {
    assert.notEqual(
      suggestion.providerID,
      'google',
      'unavailable google provider must not surface as a suggestion',
    );
  }
});

test('detectTurnIssues accepts a model that IS in the live catalog', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [
        addNodeOp({
          agentType: 'opencode',
          model: { providerID: 'openai', modelID: 'gpt-4o' },
        }),
      ],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode']),
    threadAgentType,
  });
  assert.deepEqual(issues, []);
});

test('detectTurnIssues flags patch_node execution.model with the execution agent type', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [
        patchNodeOp(
          {
            agentType: 'opencode',
            execution: {
              type: 'cursor_agent',
              model: { providerID: 'cursor', modelID: 'ghost' },
            },
          },
          'existing-node',
        ),
      ],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode', 'cursor_agent']),
    threadAgentType,
  });
  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.kind, 'model_not_in_catalog');
  if (issue.kind !== 'model_not_in_catalog') return;
  assert.equal(issue.agentType, 'cursor_agent');
  assert.deepEqual(issue.location, {
    kind: 'op',
    opIndex: 0,
    opKind: 'patch_node',
    ref: 'existing-node',
    path: 'patch.content.execution.model',
  });
});

test('detectTurnIssues falls back to the thread agentType when op does not declare one', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [addNodeOp({ model: { providerID: 'openai', modelID: 'ghost' } })],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode']),
    threadAgentType: 'opencode',
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'model_not_in_catalog');
  if (issues[0].kind !== 'model_not_in_catalog') return;
  assert.equal(issues[0].agentType, 'opencode');
});

test('detectTurnIssues inspects execution.model from workflow_run', () => {
  const issues = detectTurnIssues({
    run: okRun({
      ops: [],
      executions: [
        workflowRunExec({
          nodeId: 'n1',
          type: 'opencode',
          providerID: 'openai',
          modelID: 'ghost-7',
        }),
      ],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode']),
    threadAgentType,
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'model_not_in_catalog');
  if (issues[0].kind !== 'model_not_in_catalog') return;
  assert.deepEqual(issues[0].location, {
    kind: 'execution',
    executionIndex: 0,
    executionKind: 'workflow_run',
    path: 'model',
  });
});

// ---------------------------------------------------------------------------
// detectTurnIssues — agent_type_unrunnable
// ---------------------------------------------------------------------------

test('detectTurnIssues flags workflow_run types not in the runnable set', () => {
  const issues = detectTurnIssues({
    run: okRun({
      executions: [workflowRunExec({ nodeId: 'n1', type: 'ghost' as AgentType })],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode', 'cursor_agent']),
    threadAgentType,
  });
  const unrunnable = issues.filter((i) => i.kind === 'agent_type_unrunnable');
  assert.equal(unrunnable.length, 1);
  const [issue] = unrunnable;
  if (issue.kind !== 'agent_type_unrunnable') return;
  assert.equal(issue.type, 'ghost');
  assert.equal(issue.executionIndex, 0);
  assert.deepEqual(issue.runnable, ['cursor_agent', 'opencode']);
});

test('detectTurnIssues skips the agent-type check when no runnable set is known', () => {
  const issues = detectTurnIssues({
    run: okRun({
      executions: [workflowRunExec({ nodeId: 'n1', type: 'ghost' as AgentType })],
    }),
    catalog: buildCatalog(),
    runnableTypes: new Set(),
    threadAgentType,
  });
  assert.deepEqual(issues, []);
});

test('detectTurnIssues tolerates a turn with undefined ops and executions', () => {
  const turn = { ...emptyTurn, ops: undefined, executions: undefined } as unknown as WorkflowCopilotTurn;
  const issues = detectTurnIssues({
    run: { ok: true, rawOutput: '{}', turn },
    catalog: buildCatalog(),
    runnableTypes: new Set(['opencode']),
    threadAgentType,
  });
  assert.deepEqual(issues, []);
});

// ---------------------------------------------------------------------------
// detectRuntimeIssues
// ---------------------------------------------------------------------------

test('detectRuntimeIssues returns [] when nothing failed', () => {
  assert.deepEqual(detectRuntimeIssues({}), []);
  assert.deepEqual(
    detectRuntimeIssues({
      executionResults: [
        { ok: true, kind: 'workflow_run', output: '' } as WorkflowCopilotExecutionResult,
      ],
    }),
    [],
  );
});

test('detectRuntimeIssues emits apply_fail with a formatted message', () => {
  const applyError = new BadRequestException('EDGE_ENDPOINTS_MISSING');
  const issues = detectRuntimeIssues({ applyError });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'apply_fail');
  if (issues[0].kind !== 'apply_fail') return;
  assert.match(issues[0].message, /EDGE_ENDPOINTS_MISSING/);
});

test('detectRuntimeIssues emits execution_fail for every failed execution result', () => {
  const issues = detectRuntimeIssues({
    executionResults: [
      { ok: true, kind: 'workflow_run', output: '' } as WorkflowCopilotExecutionResult,
      {
        ok: false,
        kind: 'workflow_run',
        error: 'TIMEOUT',
      } as WorkflowCopilotExecutionResult,
      {
        ok: false,
        kind: 'managed_flow_run',
      } as WorkflowCopilotExecutionResult,
    ],
  });
  assert.equal(issues.length, 2);
  const [first, second] = issues;
  assert.equal(first.kind, 'execution_fail');
  if (first.kind !== 'execution_fail') return;
  assert.equal(first.executionIndex, 1);
  assert.equal(first.executionKind, 'workflow_run');
  assert.equal(first.error, 'TIMEOUT');
  assert.equal(second.kind, 'execution_fail');
  if (second.kind !== 'execution_fail') return;
  assert.equal(second.executionIndex, 2);
  assert.equal(second.executionKind, 'managed_flow_run');
  // Default fallback error when the daemon omitted one
  assert.equal(second.error, 'WORKFLOW_COPILOT_EXECUTION_FAILED');
});

// ---------------------------------------------------------------------------
// buildRepairFeedback
// ---------------------------------------------------------------------------

test('buildRepairFeedback produces a numbered, attempts-aware, LLM-friendly prompt', () => {
  const feedback = buildRepairFeedback({
    issues: [
      { kind: 'parse_fail', error: WORKFLOW_COPILOT_PARSE_FAILED },
      {
        kind: 'model_not_in_catalog',
        location: { kind: 'op', opIndex: 0, opKind: 'add_node', ref: 'n1', path: 'content.model' },
        agentType: 'opencode',
        providerID: 'google',
        modelID: 'gemini-1.5-flash',
        suggestions: [{ providerID: 'openai', modelID: 'gpt-4o' }],
      },
    ],
    attemptsLeft: 1,
  });
  assert.match(feedback, /Your previous reply had the following issues/);
  assert.match(feedback, /Remaining automated repair attempts after this one: 1\./);
  assert.match(feedback, /1\. /);
  assert.match(feedback, /2\. /);
  assert.match(feedback, /not parseable/i);
  assert.match(feedback, /google/);
  assert.match(feedback, /gemini-1\.5-flash/);
  assert.match(feedback, /gpt-4o/);
});

test('buildRepairFeedback clamps negative attemptsLeft to 0', () => {
  const feedback = buildRepairFeedback({
    issues: [{ kind: 'apply_fail', message: 'EDGE_ENDPOINTS_MISSING' }],
    attemptsLeft: -5,
  });
  assert.match(feedback, /Remaining automated repair attempts after this one: 0\./);
});

test('buildRepairFeedback includes a hint when no catalog suggestions are available', () => {
  const feedback = buildRepairFeedback({
    issues: [
      {
        kind: 'model_not_in_catalog',
        location: { kind: 'op', opIndex: 0, opKind: 'add_node', path: 'content.model' },
        agentType: 'opencode',
        providerID: 'ghost',
        modelID: 'ghost-1',
        suggestions: [],
      },
    ],
    attemptsLeft: 2,
  });
  assert.match(feedback, /no suitable alternatives in the live catalog/);
});

test('buildRepairFeedback describes execution_fail with index and kind', () => {
  const feedback = buildRepairFeedback({
    issues: [
      {
        kind: 'execution_fail',
        executionIndex: 2,
        executionKind: 'controller_run',
        error: 'runtime_adapter_unavailable',
      },
    ],
    attemptsLeft: 0,
  });
  assert.match(feedback, /Execution #3 \(controller_run\)/);
  assert.match(feedback, /runtime_adapter_unavailable/);
});

// ---------------------------------------------------------------------------
// summarizeIssues
// ---------------------------------------------------------------------------

test('summarizeIssues returns an empty string for no issues', () => {
  assert.equal(summarizeIssues([]), '');
});

test('summarizeIssues dedupes by short label', () => {
  const issues: RepairIssue[] = [
    { kind: 'parse_fail', error: WORKFLOW_COPILOT_PARSE_FAILED },
    { kind: 'parse_fail', error: WORKFLOW_COPILOT_PARSE_FAILED },
    {
      kind: 'model_not_in_catalog',
      location: { kind: 'op', opIndex: 0, opKind: 'add_node', path: 'content.model' },
      agentType: 'opencode',
      providerID: 'google',
      modelID: 'gemini-1.5-flash',
      suggestions: [],
    },
  ];
  const summary = summarizeIssues(issues);
  const parts = summary.split('; ');
  assert.equal(parts.length, 2, `expected 2 deduped parts, got: ${summary}`);
  assert.ok(parts.includes('JSON parse failed'));
  assert.ok(parts.includes('model google/gemini-1.5-flash not in catalog'));
});

// ---------------------------------------------------------------------------
// isRecoverableApplyError
// ---------------------------------------------------------------------------

test('isRecoverableApplyError recognises BadRequestException and nothing else', () => {
  assert.equal(isRecoverableApplyError(new BadRequestException('boom')), true);
  assert.equal(isRecoverableApplyError(new Error('boom')), false);
  assert.equal(isRecoverableApplyError('boom'), false);
  assert.equal(isRecoverableApplyError(undefined), false);
  assert.equal(isRecoverableApplyError(null), false);
});
