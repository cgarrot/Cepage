import { BadRequestException } from '@nestjs/common';
import { WORKFLOW_COPILOT_STOPPED } from '@cepage/shared-core';
import { parseWorkflowCopilotTurn, WORKFLOW_COPILOT_PARSE_FAILED } from './workflow-copilot-turn';
import type { RunThreadProgress, RunTurnResult } from './workflow-copilot.types';

/**
 * `@cepage/agent-core` is ESM-only. `tsc` with `module: commonjs` rewrites
 * `import('@cepage/agent-core')` to `require()`, which fails at runtime.
 * Use a runtime import that is not statically rewritten.
 */
export async function importAgentCore(): Promise<typeof import('@cepage/agent-core')> {
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof import('@cepage/agent-core')>;
  return runtimeImport('@cepage/agent-core');
}

export function finalizeWorkflowCopilotRun(input: {
  rawOutput: string;
  snapshotOutput: string;
  error?: string;
  stopped?: boolean;
  externalSessionId?: string;
}): RunTurnResult {
  const snapshotOutput = input.snapshotOutput.trim();
  const rawOutput = input.rawOutput.trim();
  const output = snapshotOutput || rawOutput;
  if (input.stopped) {
    return {
      ok: false,
      rawOutput: output,
      error: WORKFLOW_COPILOT_STOPPED,
      externalSessionId: input.externalSessionId,
    };
  }
  if (input.error) {
    return {
      ok: false,
      rawOutput: buildRuntimeErrorOutput(input.rawOutput, input.error),
      error: input.error,
      externalSessionId: input.externalSessionId,
    };
  }
  for (const candidate of new Set([snapshotOutput, rawOutput].filter(Boolean))) {
    const parsed = parseWorkflowCopilotTurn(candidate);
    if (!parsed.success) continue;
    return {
      ok: true,
      rawOutput: candidate,
      turn: parsed.turn,
      externalSessionId: input.externalSessionId,
    };
  }
  return {
    ok: false,
    rawOutput: output,
    error: WORKFLOW_COPILOT_PARSE_FAILED,
    externalSessionId: input.externalSessionId,
  };
}

export function readLiveOutput(progress: RunThreadProgress): string {
  const rawOutput = progress.rawOutput.trim();
  if (rawOutput) {
    return rawOutput;
  }
  return progress.snapshotOutput.trim();
}

export function canRecoverApplyError(value: unknown): boolean {
  const message = readThrownMessage(value);
  if (!message) return false;
  return (
    message === 'EDGE_ENDPOINTS_MISSING'
    || message === 'EDGE_DUPLICATE'
    || message.startsWith('NODE_NOT_FOUND:')
    || message.startsWith('EDGE_NOT_FOUND:')
    || message.startsWith('BRANCH_NOT_FOUND:')
    || message.startsWith('WORKFLOW_COPILOT_STRUCTURED_REF_MISSING:')
    || message.startsWith('WORKFLOW_COPILOT_TEMP_OUTPUT_PATH:')
  );
}

export function formatApplyError(value: unknown): string {
  const message = readThrownMessage(value) ?? 'WORKFLOW_COPILOT_APPLY_FAILED';
  if (message === 'EDGE_ENDPOINTS_MISSING') {
    return 'Workflow changes could not be applied because a proposed edge references a missing source or target node. (EDGE_ENDPOINTS_MISSING)';
  }
  if (message === 'EDGE_DUPLICATE') {
    return 'Workflow changes could not be applied because a proposed edge already exists. (EDGE_DUPLICATE)';
  }
  if (message.startsWith('NODE_NOT_FOUND:')) {
    return 'Workflow changes could not be applied because a referenced node does not exist. (NODE_NOT_FOUND)';
  }
  if (message.startsWith('EDGE_NOT_FOUND:')) {
    return 'Workflow changes could not be applied because a referenced edge does not exist. (EDGE_NOT_FOUND)';
  }
  if (message.startsWith('BRANCH_NOT_FOUND:')) {
    return 'Workflow changes could not be applied because a referenced branch does not exist. (BRANCH_NOT_FOUND)';
  }
  if (message.startsWith('WORKFLOW_COPILOT_STRUCTURED_REF_MISSING:')) {
    return 'Workflow changes could not be applied because structured workflow content references a missing node. (WORKFLOW_COPILOT_STRUCTURED_REF_MISSING)';
  }
  if (message.startsWith('WORKFLOW_COPILOT_TEMP_OUTPUT_PATH:')) {
    return 'Workflow changes could not be applied because a final published output points to a temporary path. (WORKFLOW_COPILOT_TEMP_OUTPUT_PATH)';
  }
  return `Workflow changes could not be applied. (${message})`;
}

function readThrownMessage(value: unknown): string | undefined {
  if (value instanceof BadRequestException) {
    const response = value.getResponse();
    if (typeof response === 'string') {
      const text = response.trim();
      if (text) return text;
    }
    const message = readString(readRecord(response)?.message)?.trim();
    if (message) return message;
  }
  if (value instanceof Error) {
    const message = value.message.trim();
    if (message) return message;
  }
  return undefined;
}

function buildRuntimeErrorOutput(rawOutput: string, error: string): string {
  const raw = rawOutput.trim();
  if (!raw) return error;
  if (raw.includes(error)) return raw;
  return `${raw}\n${error}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
