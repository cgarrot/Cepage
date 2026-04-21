import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Dev API/worker shells often omit ~/.local/bin; Nest and child_process need PATH
 * so `cursor-agent` resolves the same way as in agent-core `cursorAgentSpawnEnv`.
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
export function applyDevCursorAgentBin(base) {
  const raw = String(base?.HOME?.trim() || homedir()).replace(/\/$/, '');
  const extra = [
    path.join(raw, '.local/bin'),
    path.join(raw, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean);
  const prev = base.PATH ?? '';
  const parts = prev ? prev.split(path.delimiter) : [];
  const missing = extra.filter((dir) => !parts.includes(dir));
  if (missing.length === 0) {
    return { ...base };
  }
  const prefix = missing.join(path.delimiter);
  return { ...base, PATH: prev ? `${prefix}${path.delimiter}${prev}` : prefix };
}
