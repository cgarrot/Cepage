import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  clearStoredConfig,
  configPath,
  loadStoredConfig,
  redactToken,
  resolveConfig,
  saveStoredConfig,
} from '../src/config.js';

test('configPath returns ~/.cepage/config.json under the given base', () => {
  assert.equal(configPath('/home/alice'), '/home/alice/.cepage/config.json');
});

test('redactToken hides the middle of long tokens', () => {
  assert.equal(redactToken(undefined), '(none)');
  assert.equal(redactToken('abcd1234'), '****');
  assert.equal(redactToken('cep_live_abc123xyz789'), 'cep_…z789');
});

test('saveStoredConfig + loadStoredConfig round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-conf-'));
  try {
    await saveStoredConfig({ apiUrl: 'https://x.com/api/v1', token: 'tok_1234' }, dir);
    const loaded = await loadStoredConfig(dir);
    assert.deepEqual(loaded, { apiUrl: 'https://x.com/api/v1', token: 'tok_1234' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadStoredConfig returns {} when no config file is present', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-conf-'));
  try {
    const loaded = await loadStoredConfig(dir);
    assert.deepEqual(loaded, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearStoredConfig returns true on remove, false on missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-conf-'));
  try {
    assert.equal(await clearStoredConfig(dir), false);
    await saveStoredConfig({ apiUrl: 'x' }, dir);
    assert.equal(await clearStoredConfig(dir), true);
    assert.equal(await clearStoredConfig(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig prefers CLI > env > file > default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-conf-'));
  try {
    await saveStoredConfig({ apiUrl: 'https://file.example.com/api/v1', token: 'file-token' }, dir);

    const withCli = await resolveConfig({
      base: dir,
      cliApiUrl: 'https://cli.example.com/api/v1',
      env: {},
    });
    assert.equal(withCli.apiUrl, 'https://cli.example.com/api/v1');
    assert.equal(withCli.source, 'cli');

    const withEnv = await resolveConfig({
      base: dir,
      env: { CEPAGE_API_URL: 'https://env.example.com/api/v1' },
    });
    assert.equal(withEnv.apiUrl, 'https://env.example.com/api/v1');
    assert.equal(withEnv.source, 'env');

    const fromFile = await resolveConfig({ base: dir, env: {} });
    assert.equal(fromFile.apiUrl, 'https://file.example.com/api/v1');
    assert.equal(fromFile.source, 'file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig falls back to the default when nothing is set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-conf-'));
  try {
    const r = await resolveConfig({ base: dir, env: {} });
    assert.equal(r.apiUrl, 'http://localhost:31947/api/v1');
    assert.equal(r.source, 'default');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
