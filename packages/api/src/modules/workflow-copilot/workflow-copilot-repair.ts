import { BadRequestException } from '@nestjs/common';
import {
  WORKFLOW_COPILOT_STOPPED,
  type AgentCatalog,
  type AgentCatalogModel,
  type AgentType,
  type WorkflowCopilotExecution,
  type WorkflowCopilotExecutionResult,
  type WorkflowCopilotOp,
  type WorkflowCopilotTurn,
} from '@cepage/shared-core';
import { formatApplyError } from './workflow-copilot-runtime';
import { WORKFLOW_COPILOT_PARSE_FAILED } from './workflow-copilot-turn';
import type { RunTurnResult } from './workflow-copilot.types';

/**
 * How many automated repair attempts the send pipeline performs after the
 * initial agent turn. 2 reprises → up to 3 agent calls total. Override via
 * `WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS` env var (non-negative integer).
 */
export const WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS = readRepairBudget();

function readRepairBudget(): number {
  const raw = process.env.WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS?.trim();
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.floor(n);
}

/**
 * A single actionable issue surfaced by the repair detectors. The copilot
 * service turns these into a concise feedback message that becomes a
 * synthetic `user` turn prepended to the next agent call.
 */
export type RepairIssue =
  | {
      kind: 'parse_fail';
      /** Raw error string captured from `RunTurnResult.error`. */
      error: string;
    }
  | {
      kind: 'runtime_fail';
      /** Non-parse runtime error (e.g. adapter crash) — treated as infra, not retried. */
      error: string;
    }
  | {
      kind: 'stopped';
      /** User aborted the run mid-flight; the service already handles this via the abort controller. */
      error: string;
    }
  | {
      kind: 'model_not_in_catalog';
      /** Where the invalid model appeared (ops[i] or executions[i]). */
      location: RepairLocation;
      agentType: AgentType;
      providerID: string;
      modelID: string;
      /** At most 3 catalog pairs the LLM can copy verbatim. */
      suggestions: Array<{ providerID: string; modelID: string }>;
    }
  | {
      kind: 'agent_type_unrunnable';
      /** Execution index in `turn.executions`. */
      executionIndex: number;
      type: string;
      runnable: AgentType[];
    }
  | {
      kind: 'apply_fail';
      /** Already-formatted human-readable error string. */
      message: string;
    }
  | {
      kind: 'execution_fail';
      executionIndex: number;
      executionKind: 'workflow_run' | 'managed_flow_run' | 'controller_run';
      error: string;
    };

export type RepairLocation =
  | { kind: 'op'; opIndex: number; opKind: string; ref?: string; path: string }
  | { kind: 'execution'; executionIndex: number; executionKind: string; path: string };

/**
 * Issues that should stop the repair loop because the underlying failure is
 * not something the LLM can fix (network, abort, etc.).
 */
export function isRecoverableByRepair(issue: RepairIssue): boolean {
  if (issue.kind === 'runtime_fail') return false;
  if (issue.kind === 'stopped') return false;
  return true;
}

export interface DetectTurnIssuesInput {
  run: RunTurnResult;
  /** The daemon-merged catalog. `null` when the daemon is offline. */
  catalog: AgentCatalog | null;
  /** AgentTypes that have a live adapter in the catalog. */
  runnableTypes: Set<AgentType>;
  /** Thread-selected agentType used to resolve ambiguous op bindings. */
  threadAgentType: AgentType;
}

/**
 * Static inspection of the agent output **before** we attempt to apply it to
 * the graph. Catches:
 *   - parse failures (WORKFLOW_COPILOT_PARSE_FAILED)
 *   - non-retryable runtime failures (reported but not retried)
 *   - `model` objects that do not match any live catalog entry
 *   - `workflow_run.type` values that have no registered adapter
 */
export function detectTurnIssues(input: DetectTurnIssuesInput): RepairIssue[] {
  if (!input.run.ok) {
    if (input.run.error === WORKFLOW_COPILOT_STOPPED) {
      return [{ kind: 'stopped', error: input.run.error }];
    }
    if (input.run.error === WORKFLOW_COPILOT_PARSE_FAILED) {
      return [{ kind: 'parse_fail', error: input.run.error }];
    }
    return [{ kind: 'runtime_fail', error: input.run.error }];
  }
  const issues: RepairIssue[] = [];
  for (const issue of inspectTurnModels(input.run.turn, input.catalog, input.threadAgentType)) {
    issues.push(issue);
  }
  if (input.runnableTypes.size > 0) {
    for (const issue of inspectExecutionAgentTypes(input.run.turn.executions, input.runnableTypes)) {
      issues.push(issue);
    }
  }
  return issues;
}

export interface DetectRuntimeIssuesInput {
  /** Raised inside `applyMessage` (rolled back). */
  applyError?: unknown;
  /** Populated when `autoRun` drained `runCopilotExecutions` results. */
  executionResults?: readonly WorkflowCopilotExecutionResult[];
  /** Original copilot-emitted executions, for diagnostic context. */
  executions?: readonly WorkflowCopilotExecution[];
}

/**
 * Post-apply / post-run checks. Only examines signals produced **after** the
 * graph has been mutated (then rolled back on failure).
 */
export function detectRuntimeIssues(input: DetectRuntimeIssuesInput): RepairIssue[] {
  const issues: RepairIssue[] = [];
  if (input.applyError !== undefined) {
    issues.push({
      kind: 'apply_fail',
      message: formatApplyError(input.applyError),
    });
  }
  if (input.executionResults) {
    input.executionResults.forEach((result, index) => {
      if (result.ok) return;
      issues.push({
        kind: 'execution_fail',
        executionIndex: index,
        executionKind: result.kind,
        error: result.error ?? 'WORKFLOW_COPILOT_EXECUTION_FAILED',
      });
    });
  }
  return issues;
}

export interface BuildRepairFeedbackInput {
  issues: readonly RepairIssue[];
  /** Remaining attempts after this turn. Used to hint the LLM to try hard. */
  attemptsLeft: number;
}

/**
 * Assemble the synthetic `user` feedback turn that is prepended to the next
 * run's history. Produces no I/O and is safe to call from unit tests.
 */
export function buildRepairFeedback(input: BuildRepairFeedbackInput): string {
  const lines: string[] = [];
  lines.push('Your previous reply had the following issues. Emit ONE corrected JSON turn that fixes');
  lines.push('them while keeping the rest of the work unchanged. Do NOT apologise in the reply —');
  lines.push('just re-emit the corrected object. This is your LAST repair attempt if the counter says 0.');
  lines.push('');
  lines.push(`Remaining automated repair attempts after this one: ${Math.max(0, input.attemptsLeft)}.`);
  lines.push('');
  input.issues.forEach((issue, index) => {
    lines.push(`${index + 1}. ${formatIssue(issue)}`);
  });
  return lines.join('\n');
}

/**
 * Single-line summary of all issues, used to decorate the final assistant
 * message `warnings` after a successful repair.
 */
export function summarizeIssues(issues: readonly RepairIssue[]): string {
  if (issues.length === 0) return '';
  const unique = new Set<string>();
  for (const issue of issues) {
    unique.add(formatIssueShort(issue));
  }
  return [...unique].join('; ');
}

function formatIssueShort(issue: RepairIssue): string {
  switch (issue.kind) {
    case 'parse_fail':
      return 'JSON parse failed';
    case 'runtime_fail':
      return `runtime error: ${issue.error}`;
    case 'stopped':
      return 'run stopped';
    case 'model_not_in_catalog':
      return `model ${issue.providerID}/${issue.modelID} not in catalog`;
    case 'agent_type_unrunnable':
      return `agentType "${issue.type}" has no adapter`;
    case 'apply_fail':
      return `apply error: ${issue.message}`;
    case 'execution_fail':
      return `${issue.executionKind} #${issue.executionIndex + 1} failed`;
  }
}

function formatIssue(issue: RepairIssue): string {
  switch (issue.kind) {
    case 'parse_fail':
      return [
        'Your last reply was not parseable as the JSON envelope.',
        'Re-emit ONE single JSON object that matches the response schema.',
        'Common causes: markdown fences, trailing prose, unterminated strings, multiple objects.',
      ].join(' ');
    case 'runtime_fail':
      return `Runtime error prevented parsing the reply: ${issue.error}. This is infrastructure, not your fault — keep the same answer shape and try again.`;
    case 'stopped':
      return 'The previous run was stopped by the user. Do nothing.';
    case 'model_not_in_catalog': {
      const suggestLines =
        issue.suggestions.length === 0
          ? '(no suitable alternatives in the live catalog — omit the model object to use the thread default)'
          : issue.suggestions
              .map((s) => `     - providerID=${JSON.stringify(s.providerID)}, modelID=${JSON.stringify(s.modelID)}`)
              .join('\n');
      return [
        `At ${formatLocation(issue.location)}, the emitted model `,
        `{ providerID: ${JSON.stringify(issue.providerID)}, modelID: ${JSON.stringify(issue.modelID)} } `,
        `is NOT in the live catalog for agentType "${issue.agentType}".`,
        '\n   Pick ONE of these exact catalog pairs, or omit the `model` field entirely to use the thread default:\n',
        suggestLines,
      ].join('');
    }
    case 'agent_type_unrunnable': {
      const list = issue.runnable.map((t) => `"${t}"`).join(', ') || '(none)';
      return `Execution #${issue.executionIndex + 1} has type "${issue.type}" which has no registered agent adapter. Use one of: ${list}.`;
    }
    case 'apply_fail':
      return `Graph apply was rolled back: ${issue.message}. Re-emit ops that resolve the issue (use existing node ids or fresh refs, keep edges between real endpoints).`;
    case 'execution_fail':
      return `Execution #${issue.executionIndex + 1} (${issue.executionKind}) failed at runtime with: ${issue.error}. Adjust the binding (e.g. correct model, correct agentType) and re-emit.`;
  }
}

function formatLocation(location: RepairLocation): string {
  if (location.kind === 'op') {
    const ref = location.ref ? ` "${location.ref}"` : '';
    return `op #${location.opIndex + 1} (${location.opKind}${ref}, ${location.path})`;
  }
  return `execution #${location.executionIndex + 1} (${location.executionKind}, ${location.path})`;
}

function inspectTurnModels(
  turn: WorkflowCopilotTurn,
  catalog: AgentCatalog | null,
  threadAgentType: AgentType,
): RepairIssue[] {
  if (!catalog || catalog.providers.length === 0) {
    // Without a catalog we cannot certify a binding; the prompt already tells
    // the LLM to keep the thread default in that case.
    return [];
  }
  const pairs = collectCatalogPairs(catalog);
  const issues: RepairIssue[] = [];
  const ops = Array.isArray(turn.ops) ? turn.ops : [];
  const executions = Array.isArray(turn.executions) ? turn.executions : [];
  ops.forEach((op, index) => {
    for (const ref of collectOpModelRefs(op, index)) {
      const agentType = ref.agentType ?? threadAgentType;
      if (isPairInCatalog(pairs, agentType, ref.providerID, ref.modelID)) continue;
      issues.push({
        kind: 'model_not_in_catalog',
        location: ref.location,
        agentType,
        providerID: ref.providerID,
        modelID: ref.modelID,
        suggestions: suggestCatalogPairs(catalog, agentType, ref.providerID, ref.modelID),
      });
    }
  });
  executions.forEach((ex, index) => {
    const ref = readExecutionModel(ex, index);
    if (!ref) return;
    const agentType = ref.agentType ?? threadAgentType;
    if (isPairInCatalog(pairs, agentType, ref.providerID, ref.modelID)) return;
    issues.push({
      kind: 'model_not_in_catalog',
      location: ref.location,
      agentType,
      providerID: ref.providerID,
      modelID: ref.modelID,
      suggestions: suggestCatalogPairs(catalog, agentType, ref.providerID, ref.modelID),
    });
  });
  return issues;
}

function inspectExecutionAgentTypes(
  executions: readonly WorkflowCopilotExecution[] | undefined,
  runnableTypes: Set<AgentType>,
): RepairIssue[] {
  if (!Array.isArray(executions)) return [];
  const issues: RepairIssue[] = [];
  executions.forEach((ex, index) => {
    if (ex.kind !== 'workflow_run') return;
    if (!ex.type) return;
    if (runnableTypes.has(ex.type)) return;
    issues.push({
      kind: 'agent_type_unrunnable',
      executionIndex: index,
      type: ex.type,
      runnable: [...runnableTypes].sort(),
    });
  });
  return issues;
}

interface OpModelRef {
  providerID: string;
  modelID: string;
  agentType?: AgentType;
  location: RepairLocation;
}

function collectOpModelRefs(op: WorkflowCopilotOp, index: number): OpModelRef[] {
  if (op.kind === 'add_node') {
    return readNodeContentModelRefs(op.content, index, op.kind, op.ref, 'content');
  }
  if (op.kind === 'patch_node') {
    return readNodeContentModelRefs(op.patch.content, index, op.kind, op.nodeId, 'patch.content');
  }
  return [];
}

function readNodeContentModelRefs(
  content: Record<string, unknown> | undefined,
  opIndex: number,
  opKind: string,
  ref: string | undefined,
  basePath: string,
): OpModelRef[] {
  if (!content) return [];
  const refs: OpModelRef[] = [];
  const agentTypeRaw = typeof content.agentType === 'string' ? (content.agentType as AgentType) : undefined;
  const rootModel = readModelRecord(content.model);
  if (rootModel) {
    refs.push({
      providerID: rootModel.providerID,
      modelID: rootModel.modelID,
      agentType: agentTypeRaw,
      location: { kind: 'op', opIndex, opKind, ref, path: `${basePath}.model` },
    });
  }
  const execution = readRecord(content.execution);
  if (execution) {
    const execModel = readModelRecord(execution.model);
    const execType =
      typeof execution.type === 'string' ? (execution.type as AgentType) : agentTypeRaw;
    if (execModel) {
      refs.push({
        providerID: execModel.providerID,
        modelID: execModel.modelID,
        agentType: execType,
        location: {
          kind: 'op',
          opIndex,
          opKind,
          ref,
          path: `${basePath}.execution.model`,
        },
      });
    }
  }
  return refs;
}

function readExecutionModel(
  ex: WorkflowCopilotExecution,
  index: number,
): OpModelRef | null {
  if (ex.kind !== 'workflow_run') return null;
  if (!ex.model) return null;
  return {
    providerID: ex.model.providerID,
    modelID: ex.model.modelID,
    agentType: ex.type,
    location: {
      kind: 'execution',
      executionIndex: index,
      executionKind: ex.kind,
      path: 'model',
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readModelRecord(value: unknown): { providerID: string; modelID: string } | null {
  const rec = readRecord(value);
  if (!rec) return null;
  const providerID = typeof rec.providerID === 'string' ? rec.providerID.trim() : '';
  const modelID = typeof rec.modelID === 'string' ? rec.modelID.trim() : '';
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

type CatalogPairIndex = Map<string, Set<string>>;

function pairKey(agentType: AgentType, providerID: string): string {
  return `${agentType}::${providerID}`;
}

function collectCatalogPairs(catalog: AgentCatalog): CatalogPairIndex {
  const index: CatalogPairIndex = new Map();
  for (const provider of catalog.providers) {
    if (provider.availability === 'unavailable') continue;
    for (const model of provider.models) {
      const key = pairKey(provider.agentType, model.providerID);
      const set = index.get(key) ?? new Set<string>();
      set.add(model.modelID);
      index.set(key, set);
    }
  }
  return index;
}

function isPairInCatalog(
  pairs: CatalogPairIndex,
  agentType: AgentType,
  providerID: string,
  modelID: string,
): boolean {
  const set = pairs.get(pairKey(agentType, providerID));
  if (!set) return false;
  return set.has(modelID);
}

function suggestCatalogPairs(
  catalog: AgentCatalog,
  agentType: AgentType,
  providerID: string,
  modelID: string,
): Array<{ providerID: string; modelID: string }> {
  const candidates: Array<{ providerID: string; modelID: string; score: number }> = [];
  const wantedProvider = providerID.toLowerCase();
  const wantedModel = modelID.toLowerCase();
  for (const provider of catalog.providers) {
    if (provider.availability === 'unavailable') continue;
    if (provider.agentType !== agentType) continue;
    for (const model of provider.models) {
      const score = scoreModelMatch(
        wantedProvider,
        wantedModel,
        model.providerID.toLowerCase(),
        model.modelID.toLowerCase(),
        model,
      );
      candidates.push({
        providerID: model.providerID,
        modelID: model.modelID,
        score,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3).map(({ providerID: p, modelID: m }) => ({ providerID: p, modelID: m }));
}

function scoreModelMatch(
  wantedProvider: string,
  wantedModel: string,
  havePider: string,
  haveModel: string,
  catalogModel: AgentCatalogModel,
): number {
  let score = 0;
  if (havePider === wantedProvider) score += 6;
  else if (havePider.includes(wantedProvider) || wantedProvider.includes(havePider)) score += 2;
  if (haveModel === wantedModel) score += 4;
  else if (haveModel.includes(wantedModel) || wantedModel.includes(haveModel)) score += 2;
  if (catalogModel.isDefault) score += 1;
  return score;
}

/**
 * Helper re-exported for the send pipeline: recognise the same
 * `BadRequestException` surface that `applyWorkflowCopilotMessage` raises so
 * we can decide whether to feed it back to the LLM or bubble up unchanged.
 */
export function isRecoverableApplyError(value: unknown): value is BadRequestException {
  return value instanceof BadRequestException;
}
