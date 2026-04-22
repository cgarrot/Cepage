import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseInputs, parseKeyValueFlags } from '../src/parse-inputs.js';
import { UsageError } from '../src/errors.js';

test('parseKeyValueFlags decodes primitives and nested paths', () => {
  const parsed = parseKeyValueFlags([
    'name=Alice',
    'count=42',
    'active=true',
    'disabled=false',
    'rate=1.25',
    'nothing=null',
    'profile.email=alice@example.com',
    'tags=["a","b"]',
    'settings={"verbose":true}',
  ]);
  assert.deepEqual(parsed, {
    name: 'Alice',
    count: 42,
    active: true,
    disabled: false,
    rate: 1.25,
    nothing: null,
    profile: { email: 'alice@example.com' },
    tags: ['a', 'b'],
    settings: { verbose: true },
  });
});

test('parseKeyValueFlags raises UsageError for missing =', () => {
  assert.throws(() => parseKeyValueFlags(['badEntry']), UsageError);
});

test('parseKeyValueFlags raises UsageError for empty key', () => {
  assert.throws(() => parseKeyValueFlags(['=42']), UsageError);
});

test('parseInputs reads a JSON file and merges with flags', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-'));
  try {
    const file = join(dir, 'inputs.json');
    writeFileSync(file, JSON.stringify({ startDate: '2026-04-14', count: 1 }));
    const { inputs, source } = await parseInputs({
      inputsFile: file,
      rawInputs: ['count=3', 'endDate=2026-04-21'],
    });
    assert.equal(source, 'merge');
    assert.deepEqual(inputs, {
      startDate: '2026-04-14',
      count: 3,
      endDate: '2026-04-21',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseInputs returns empty object when no source is given', async () => {
  const { inputs, source } = await parseInputs({});
  assert.deepEqual(inputs, {});
  assert.equal(source, 'empty');
});

test('parseInputs rejects inputs files that are not an object', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cepage-cli-'));
  try {
    const file = join(dir, 'inputs.json');
    writeFileSync(file, '[1,2,3]');
    await assert.rejects(() => parseInputs({ inputsFile: file }), UsageError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
