import assert from 'node:assert/strict';
import { access, rm, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { hookCommand } from './hook.js';

const hookPath = join(homedir(), '.claude', 'hooks', 'cepage-compile.sh');

async function ensureClean(): Promise<void> {
  try {
    await rm(hookPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test.beforeEach(async () => {
  await ensureClean();
});

test.afterEach(async () => {
  await ensureClean();
});

test('install hook for claude-code creates the hook script', async () => {
  const fakeBinDir = mkdtempSync(join(homedir(), '.cepage-test-bin-'));
  const fakeClaude = join(fakeBinDir, 'claude');
  await writeFile(fakeClaude, '#!/bin/sh\necho claude-stub\n', { mode: 0o755 });

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}${originalPath ? ':' + originalPath : ''}`;

  try {
    const code = await hookCommand(
      ['install', 'claude-code'],
      { apiUrl: 'http://test', token: undefined, json: false, color: true }
    );
    assert.equal(code, 0);
    assert.ok(await fileExists(hookPath), 'hook file should exist after install');

    const content = await readFile(hookPath, 'utf8');
    assert.ok(
      content.includes('CEPAGE_API_URL') || content.includes('http://test'),
      'script should reference CEPAGE_API_URL or contain the provided apiUrl'
    );
    assert.ok(content.includes('skill-compiler/compile'), 'script should contain the endpoint path');
  } finally {
    process.env.PATH = originalPath ?? '';
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});

test('uninstall hook removes the hook script', async () => {
  const fakeBinDir = mkdtempSync(join(homedir(), '.cepage-test-bin-'));
  const fakeClaude = join(fakeBinDir, 'claude');
  await writeFile(fakeClaude, '#!/bin/sh\necho claude-stub\n', { mode: 0o755 });

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}${originalPath ? ':' + originalPath : ''}`;

  try {
    await hookCommand(
      ['install', 'claude-code'],
      { apiUrl: 'http://test', token: undefined, json: false, color: true }
    );
    assert.ok(await fileExists(hookPath), 'hook file should exist after install');

    const code = await hookCommand(
      ['install', '--uninstall', 'claude-code'],
      { apiUrl: undefined, token: undefined, json: false, color: true }
    );
    assert.equal(code, 0);
    assert.ok(!(await fileExists(hookPath)), 'hook file should be removed after uninstall');
  } finally {
    process.env.PATH = originalPath ?? '';
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});
