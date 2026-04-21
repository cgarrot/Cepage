import {
  workflowArchitectureSpecSchema,
  workflowCopilotTurnSchema,
  type WorkflowCopilotTurn,
} from '@cepage/shared-core';

export const WORKFLOW_COPILOT_PARSE_FAILED = 'WORKFLOW_COPILOT_PARSE_FAILED';

export function parseWorkflowCopilotTurn(output: string):
  | { success: true; turn: WorkflowCopilotTurn }
  | { success: false; error: string } {
  for (const item of collectJsonCandidates(output)) {
    const turn = parseCandidate(item);
    if (turn) {
      return { success: true, turn };
    }
  }
  return {
    success: false,
    error: WORKFLOW_COPILOT_PARSE_FAILED,
  };
}

function parseCandidate(input: string): WorkflowCopilotTurn | null {
  const queue = [input.trim()];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift()?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    const value = parseJsonCandidate(item);
    if (value === null) continue;
    if (typeof value === 'string') {
      queue.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') queue.push(entry);
        if (entry && typeof entry === 'object') queue.push(JSON.stringify(entry));
      }
      continue;
    }
    if (!looksLikeTurn(value)) continue;
    const parsed = workflowCopilotTurnSchema.safeParse(normalizeTurn(value));
    if (parsed.success) return parsed.data;
  }
  return null;
}

function parseJsonCandidate(input: string): unknown | null {
  const fixed = repairJsonControlChars(input);
  const quoted = repairJsonUnterminatedStrings(fixed);
  for (const item of new Set([input, fixed, quoted, repairJsonStructure(fixed), repairJsonStructure(quoted)])) {
    try {
      return JSON.parse(item) as unknown;
    } catch {}
  }
  return null;
}

function repairJsonControlChars(input: string): string {
  let out = '';
  let escaped = false;
  let inString = false;
  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString) {
      out += ch;
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    if (ch === '\r') {
      out += '\\r';
      continue;
    }
    if (ch === '\t') {
      out += '\\t';
      continue;
    }
    if (ch < ' ') {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function repairJsonStructure(input: string): string {
  let out = '';
  let escaped = false;
  let inString = false;
  const stack: string[] = [];
  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (inString) {
      out += ch;
      continue;
    }
    if (ch === '{') {
      stack.push('}');
      out += ch;
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      out += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack.length === 0) continue;
      while (stack.length > 0 && stack.at(-1) !== ch) {
        out += stack.pop();
      }
      if (stack.length === 0) continue;
      out += ch;
      stack.pop();
      continue;
    }
    out += ch;
  }
  while (stack.length > 0) {
    out += stack.pop();
  }
  return out;
}

function repairJsonUnterminatedStrings(input: string): string {
  return input.replace(
    /(:\s*"([^"\\}\],]|\\.)*)(?=\s*[}\],])/g,
    '$1"',
  );
}

function looksLikeTurn(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return [
    'analysis',
    'reasoning',
    'plan',
    'thinking',
    'reply',
    'content',
    'message',
    'response',
    'assistant',
    'summary',
    'changes',
    'warnings',
    'cautions',
    'notes',
    'ops',
    'operations',
    'executions',
    'runs',
    'attachmentGraph',
  ].some((key) => key in obj);
}

function normalizeTurn(value: Record<string, unknown>): unknown {
  const rawExec = Array.isArray(value.executions)
    ? value.executions
    : Array.isArray(value.runs)
      ? value.runs
      : [];
  const architecture = normalizeArchitecture(value.architecture ?? value.architect ?? value.spec);
  return {
    analysis: pickText(value.analysis, value.reasoning, value.plan, value.thinking),
    reply: pickText(value.reply, value.content, value.message, value.response, value.assistant),
    summary: readTextList(value.summary ?? value.changes),
    warnings: readTextList(value.warnings ?? value.cautions ?? value.notes),
    ops: normalizeOps(
      Array.isArray(value.ops) ? value.ops : Array.isArray(value.operations) ? value.operations : [],
    ),
    executions: normalizeExecutions(rawExec),
    attachmentGraph: normalizeAttachmentGraph(value.attachmentGraph),
    ...(architecture !== undefined ? { architecture } : {}),
  };
}

function normalizeArchitecture(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  // Models often emit `architecture: {}` (or other partial objects) when no
  // architecture review is needed. The architecture spec however requires a
  // non-empty `goal` and at least one module, so a strict parse would reject
  // the whole envelope. Treat any architecture payload that does not fully
  // validate as "absent" so the rest of the turn (analysis/reply/summary/ops)
  // still flows through to the chat.
  const parsed = workflowArchitectureSpecSchema.safeParse(raw);
  return parsed.success ? raw : undefined;
}

function normalizeAttachmentGraph(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'none' };
  }
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === 'existing' && typeof o.nodeId === 'string' && o.nodeId.trim()) {
    return { kind: 'existing', nodeId: o.nodeId.trim() };
  }
  if (kind === 'new') {
    const pos = o.position;
    const branches = o.branches;
    const position =
      pos &&
      typeof pos === 'object' &&
      !Array.isArray(pos) &&
      typeof (pos as { x?: unknown }).x === 'number' &&
      typeof (pos as { y?: unknown }).y === 'number'
        ? { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
        : undefined;
    const br = Array.isArray(branches)
      ? branches.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined;
    return {
      kind: 'new',
      ...(position ? { position } : {}),
      ...(br && br.length > 0 ? { branches: br } : {}),
    };
  }
  return { kind: 'none' };
}

const MAX_EXECUTIONS = 5;

function normalizeExecutions(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean).slice(0, MAX_EXECUTIONS);
}

function normalizeOps(value: unknown[]): unknown[] {
  return value.map(normalizeOp);
}

function normalizeOp(value: unknown): unknown {
  const op = readObject(value);
  if (!op) return value;
  if (op.kind !== 'add_node') return value;
  const node = readObject(op.node);
  if (node) {
    const { node: _node, ...rest } = op;
    return normalizeAddNode({
      ...node,
      ...rest,
    });
  }
  return normalizeAddNode(op);
}

function normalizeAddNode(value: Record<string, unknown>): Record<string, unknown> {
  const type = normalizeNodeType(value.type);
  return type ? { ...value, type } : value;
}

function normalizeNodeType(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : undefined;
  if (!raw) return undefined;
  if (raw === 'managedFlow' || raw === 'managed-flow') return 'managed_flow';
  if (raw === 'workflowCopilot' || raw === 'workflow-copilot') return 'workflow_copilot';
  if (raw === 'subGraph' || raw === 'sub-graph') return 'sub_graph';
  if (raw === 'workspaceFile' || raw === 'workspace-file') return 'workspace_file';
  if (raw === 'humanMessage' || raw === 'human-message') return 'human_message';
  if (raw === 'agentStep' || raw === 'agent-step') return 'agent_step';
  if (raw === 'fileSummary' || raw === 'file-summary') return 'file_summary';
  return raw;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return undefined;
}

function readTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }
  return [];
}

function collectJsonCandidates(output: string): string[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const values = new Set<string>([trimmed]);
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const item = match[1]?.trim();
    if (item) values.add(item);
  }
  for (const item of extractBalanced(trimmed, '{', '}')) {
    values.add(item);
  }
  for (const item of extractBalanced(trimmed, '[', ']')) {
    values.add(item);
  }
  return [...values];
}

function extractBalanced(text: string, open: string, close: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === close && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return values;
}
