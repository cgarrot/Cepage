import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import { UsageError } from './errors.js';

export interface ParsedInputs {
  inputs: Record<string, unknown>;
  source: 'file' | 'flags' | 'merge' | 'empty';
}

export interface ParseInputsOptions {
  inputsFile?: string;
  rawInputs?: string[];
  baseDir?: string;
}

export async function parseInputs(opts: ParseInputsOptions): Promise<ParsedInputs> {
  const fromFile = opts.inputsFile
    ? await readInputsFile(opts.inputsFile, opts.baseDir)
    : undefined;
  const fromFlags =
    opts.rawInputs && opts.rawInputs.length > 0 ? parseKeyValueFlags(opts.rawInputs) : undefined;

  if (fromFile && fromFlags) {
    return { inputs: { ...fromFile, ...fromFlags }, source: 'merge' };
  }
  if (fromFile) return { inputs: fromFile, source: 'file' };
  if (fromFlags) return { inputs: fromFlags, source: 'flags' };
  return { inputs: {}, source: 'empty' };
}

async function readInputsFile(path: string, baseDir?: string): Promise<Record<string, unknown>> {
  const full = resolve(baseDir ?? process.cwd(), path);
  const raw = await fs.readFile(full, 'utf8').catch((err: NodeJS.ErrnoException) => {
    throw new UsageError(`could not read ${path}: ${err.message}`, {
      hint: 'Check the path is correct and readable.',
    });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new UsageError(
      `inputs file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { hint: 'Expected a JSON object like `{"startDate":"2026-04-14"}`.' },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`inputs file ${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse `key=value` strings into a JS object. Values are decoded
 * best-effort as JSON (so `count=42` becomes `42`, `active=true` becomes
 * `true`, and `name=Alice` stays a string). Nested keys like `a.b=1` are
 * flattened into nested objects to keep the CLI simple.
 */
export function parseKeyValueFlags(raw: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of raw) {
    const equals = entry.indexOf('=');
    if (equals === -1) {
      throw new UsageError(`invalid --input \`${entry}\``, {
        hint: 'Inputs must be in the form key=value (e.g. --input startDate=2026-04-14).',
      });
    }
    const key = entry.slice(0, equals);
    const value = entry.slice(equals + 1);
    if (!key) {
      throw new UsageError(`invalid --input \`${entry}\``, {
        hint: 'Keys cannot be empty (expected key=value).',
      });
    }
    assignNested(out, key.split('.'), decodeValue(value));
  }
  return out;
}

function decodeValue(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function assignNested(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 1) {
    target[path[0]] = value;
    return;
  }
  const [head, ...rest] = path;
  const existing = target[head];
  const next =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  assignNested(next, rest, value);
  target[head] = next;
}
