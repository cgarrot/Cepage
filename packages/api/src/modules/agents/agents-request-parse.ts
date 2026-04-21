import { BadRequestException } from '@nestjs/common';
import {
  inputNodeStartRequestSchema,
  workflowRunRequestSchema,
  type AgentModelRef,
  type InputNodeStartRequest,
  type WorkflowRunRequest,
} from '@cepage/shared-core';
import { readString } from './workflow-inputs.util';
import type { RunRow } from './agents.types';

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function readModel(value: unknown): AgentModelRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const providerID = readString((value as { providerID?: unknown }).providerID);
  const modelID = readString((value as { modelID?: unknown }).modelID);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function readRunModel(run: RunRow): AgentModelRef | undefined {
  if (!run.modelProviderId || !run.modelId) return undefined;
  return {
    providerID: run.modelProviderId,
    modelID: run.modelId,
  };
}

export function parsePayload<T>(body: unknown, parse: (value: unknown) => T, code: string): T {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const payload = (body as { payload?: unknown }).payload;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        return parse(JSON.parse(payload));
      } catch {
        throw new BadRequestException(code);
      }
    }
  }
  return parse(body);
}

export function parseWorkflowRunBody(body: unknown): WorkflowRunRequest {
  return parsePayload(
    body,
    (value) => workflowRunRequestSchema.parse(value),
    'WORKFLOW_RUN_PAYLOAD_INVALID',
  );
}

export function parseInputNodeStartBody(body: unknown): InputNodeStartRequest {
  return parsePayload(
    body,
    (value) => inputNodeStartRequestSchema.parse(value),
    'INPUT_NODE_START_PAYLOAD_INVALID',
  );
}
