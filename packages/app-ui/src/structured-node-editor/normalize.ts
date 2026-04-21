import {
  readWorkflowDecisionValidatorContent,
  readWorkflowLoopContent,
  type WorkflowDecisionValidatorContent,
  type WorkflowLoopContent,
  type WorkflowLoopSource,
  type WorkflowSubgraphContent,
  type WorkflowSubgraphInputBinding,
  type WorkflowValidatorCheck,
} from '@cepage/shared-core';

export const validatorActions = [
  'pass',
  'retry_same_item',
  'retry_new_execution',
  'block',
  'request_human',
  'complete',
] as const;

export type BindingRow = {
  key: string;
  template: string;
  format: 'text' | 'json';
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function trim(value: string): string | undefined {
  const next = value.trim();
  return next ? next : undefined;
}

export function lines(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function positive(value: string): number | undefined {
  const next = value.trim();
  if (!next) return undefined;
  const parsed = Number.parseInt(next, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function formatOption(value: string): string {
  return value.replaceAll('_', ' ');
}

export function defaultSource(kind: WorkflowLoopSource['kind']): WorkflowLoopSource {
  if (kind === 'input_parts') {
    return { kind, templateNodeId: '' };
  }
  if (kind === 'json_file') {
    return { kind };
  }
  if (kind === 'future_source') {
    return { kind, sourceKey: '' };
  }
  return { kind, items: [''] };
}

export function defaultCheck(kind: WorkflowValidatorCheck['kind']): WorkflowValidatorCheck {
  switch (kind) {
    case 'file_contains':
    case 'file_not_contains':
    case 'file_last_line_equals':
      return { kind, path: '', text: '' };
    case 'json_path_exists':
    case 'json_path_nonempty':
    case 'json_path_array_nonempty':
      return { kind, path: '', jsonPath: '' };
    case 'connector_status_is':
      return { kind, status: 'completed' };
    case 'connector_exit_code_in':
      return { kind, codes: [0] };
    case 'connector_http_status_in':
      return { kind, statuses: [200] };
    case 'path_exists':
    case 'path_not_exists':
    case 'path_nonempty':
    case 'json_array_nonempty':
    case 'workflow_transfer_valid':
      return { kind, path: '' };
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return { kind: 'path_exists', path: '' };
    }
  }
}

function normalizeValidatorAction(
  value: unknown,
  fallback: (typeof validatorActions)[number],
): (typeof validatorActions)[number] {
  const raw = readString(value)?.trim();
  if (!raw) return fallback;
  if (validatorActions.includes(raw as (typeof validatorActions)[number])) {
    return raw as (typeof validatorActions)[number];
  }
  if (raw === 'advance') return 'pass';
  if (raw === 'retry_body' || raw === 'retry' || raw === 'retry_item') return 'retry_same_item';
  if (raw === 'retry_execution' || raw === 'retry_new_run') return 'retry_new_execution';
  if (raw === 'pause' || raw === 'pause_controller') return 'block';
  if (raw === 'human' || raw === 'ask_human') return 'request_human';
  return fallback;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(readString)
      .filter((entry): entry is string => Boolean(entry?.trim()))
      .map((entry) => entry.trim());
  }
  const text = readString(value);
  return text ? lines(text) : [];
}

function normalizeCheck(value: unknown): WorkflowValidatorCheck | null {
  const record = readRecord(value);
  const kind = readString(record?.kind);
  if (!kind) return null;
  if (kind === 'file_contains' || kind === 'file_not_contains' || kind === 'file_last_line_equals') {
    const path = readString(record?.path)?.trim();
    const text =
      readString(record?.text)?.trim()
      ?? readString(record?.substring)?.trim()
      ?? readString(record?.contains)?.trim()
      ?? readString(record?.line)?.trim()
      ?? readString(record?.lastLine)?.trim();
    if (!path || !text) return null;
    return { kind, path, text } as WorkflowValidatorCheck;
  }
  if (
    kind === 'path_exists'
    || kind === 'path_not_exists'
    || kind === 'path_nonempty'
    || kind === 'json_array_nonempty'
  ) {
    const path = readString(record?.path)?.trim();
    if (!path) return null;
    return { kind, path };
  }
  if (
    kind === 'json_path_exists'
    || kind === 'json_path_nonempty'
    || kind === 'json_path_array_nonempty'
  ) {
    const path = readString(record?.path)?.trim();
    const jsonPath =
      readString(record?.jsonPath)?.trim()
      ?? readString(record?.pathInJson)?.trim()
      ?? readString(record?.pointer)?.trim();
    if (!path || !jsonPath) return null;
    return { kind, path, jsonPath };
  }
  return null;
}

function normalizeLoopAdvancePolicy(value: unknown): WorkflowLoopContent['advancePolicy'] {
  const raw = readString(value)?.trim();
  if (raw === 'always_advance') return 'always_advance';
  return 'only_on_pass';
}

function normalizeLoopBlockedPolicy(value: unknown): WorkflowLoopContent['blockedPolicy'] {
  const raw = readString(value)?.trim();
  if (raw === 'request_human' || raw === 'skip_item' || raw === 'stop_controller') {
    return raw;
  }
  if (raw === 'pause' || raw === 'block') {
    return 'pause_controller';
  }
  return 'pause_controller';
}

export function normalizeLoopSource(value: unknown): WorkflowLoopSource | null {
  const source = readRecord(value);
  const kind = readString(source?.kind);
  if (!kind) return null;
  if (kind === 'input_parts') {
    const templateNodeId =
      readString(source?.templateNodeId)?.trim()
      ?? readString(source?.inputNodeId)?.trim()
      ?? readString(source?.sourceNodeId)?.trim();
    if (!templateNodeId) return null;
    return {
      kind,
      templateNodeId,
      boundNodeId:
        readString(source?.boundNodeId)?.trim()
        ?? readString(source?.boundInputNodeId)?.trim(),
    };
  }
  if (kind === 'json_file') {
    const fileNodeId = readString(source?.fileNodeId)?.trim();
    const relativePath = readString(source?.relativePath)?.trim();
    if (!fileNodeId && !relativePath) return null;
    return {
      kind,
      ...(fileNodeId ? { fileNodeId } : {}),
      ...(relativePath ? { relativePath } : {}),
    };
  }
  if (kind === 'inline_list') {
    const items = Array.isArray(source?.items) ? source.items : [];
    if (items.length === 0) return null;
    return { kind, items };
  }
  if (kind === 'future_source') {
    const sourceKey =
      readString(source?.sourceKey)?.trim()
      ?? readString(source?.key)?.trim();
    if (!sourceKey) return null;
    return { kind, sourceKey };
  }
  return null;
}

function normalizeLoopSessionPolicy(value: unknown): WorkflowLoopContent['sessionPolicy'] {
  const record = readRecord(value);
  const within = readString(record?.withinItem)?.trim();
  const between = readString(record?.betweenItems)?.trim();
  if (
    (within === 'reuse_execution' || within === 'new_execution')
    && (between === 'reuse_execution' || between === 'new_execution')
  ) {
    return {
      withinItem: within,
      betweenItems: between,
    };
  }
  const legacy = readString(value)?.trim();
  if (legacy === 'new_within_item') {
    return { withinItem: 'new_execution', betweenItems: 'new_execution' };
  }
  return { withinItem: 'reuse_execution', betweenItems: 'new_execution' };
}

export function readLooseWorkflowLoopContent(value: unknown): WorkflowLoopContent | null {
  const strict = readWorkflowLoopContent(value);
  if (strict) return strict;
  const record = readRecord(value);
  const mode = readString(record?.mode);
  const source = normalizeLoopSource(record?.source);
  const bodyNodeId =
    readString(record?.bodyNodeId)?.trim()
    ?? readString(record?.stepNodeId)?.trim()
    ?? readString(record?.childNodeId)?.trim();
  if ((mode !== 'for_each' && mode !== 'while') || !source || !bodyNodeId) {
    return null;
  }
  return {
    mode,
    source,
    bodyNodeId,
    validatorNodeId:
      readString(record?.validatorNodeId)?.trim()
      ?? readString(record?.decisionNodeId)?.trim(),
    advancePolicy: normalizeLoopAdvancePolicy(record?.advancePolicy),
    sessionPolicy: normalizeLoopSessionPolicy(record?.sessionPolicy),
    maxAttemptsPerItem: positive(String(record?.maxAttemptsPerItem ?? '')),
    maxIterations: positive(String(record?.maxIterations ?? '')),
    blockedPolicy: normalizeLoopBlockedPolicy(record?.blockedPolicy),
    itemLabel: readString(record?.itemLabel)?.trim(),
  };
}

export function readLooseWorkflowDecisionValidatorContent(
  value: unknown,
): WorkflowDecisionValidatorContent | null {
  const strict = readWorkflowDecisionValidatorContent(value);
  if (strict) return strict;
  const record = readRecord(value);
  if (readString(record?.mode) !== 'workspace_validator') return null;
  const checks = Array.isArray(record?.checks)
    ? record.checks
        .map(normalizeCheck)
        .filter((entry): entry is WorkflowValidatorCheck => Boolean(entry))
    : normalizeCheck(record?.checks)
      ? [normalizeCheck(record?.checks) as WorkflowValidatorCheck]
      : [];
  return {
    mode: 'workspace_validator',
    requirements: normalizeStringList(record?.requirements),
    evidenceFrom: normalizeStringList(record?.evidenceFrom),
    checks,
    passAction: normalizeValidatorAction(record?.passAction, 'pass'),
    failAction: normalizeValidatorAction(record?.failAction, 'retry_same_item'),
    blockAction: normalizeValidatorAction(record?.blockAction, 'block'),
  };
}

export function bindingRows(map: WorkflowSubgraphContent['inputMap']): BindingRow[] {
  return Object.entries(map).map(([key, binding]) => {
    if (typeof binding === 'string') {
      return { key, template: binding, format: 'text' };
    }
    return {
      key,
      template: binding.template,
      format: binding.format ?? 'text',
    };
  });
}

export function writeBindingRows(rows: BindingRow[]): Record<string, WorkflowSubgraphInputBinding> {
  return Object.fromEntries(
    rows
      .map((row) => ({
        key: row.key.trim(),
        template: row.template.trim(),
        format: row.format,
      }))
      .filter((row) => row.key && row.template)
      .map((row) => [
        row.key,
        row.format === 'json' ? { template: row.template, format: 'json' as const } : row.template,
      ]),
  );
}
