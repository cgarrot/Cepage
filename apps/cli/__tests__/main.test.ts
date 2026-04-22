import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCli } from '../src/main.js';

async function capture<T>(run: () => Promise<T>): Promise<{
  stdout: string;
  stderr: string;
  result: T;
}> {
  const chunks: { out: string[]; err: string[] } = { out: [], err: [] };
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const stdoutWrite = (chunk: string | Uint8Array) => {
    chunks.out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  const stderrWrite = (chunk: string | Uint8Array) => {
    chunks.err.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  process.stdout.write = stdoutWrite as typeof process.stdout.write;
  process.stderr.write = stderrWrite as typeof process.stderr.write;
  try {
    const result = await run();
    return {
      stdout: chunks.out.join(''),
      stderr: chunks.err.join(''),
      result,
    };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test('runCli with no args prints usage and exits 0', async () => {
  const { stdout, result } = await capture(() => runCli([]));
  assert.equal(result, 0);
  assert.match(stdout, /Usage:\s*\n\s+cepage <command>/);
});

test('runCli with --help prints usage', async () => {
  const { stdout, result } = await capture(() => runCli(['--help']));
  assert.equal(result, 0);
  assert.ok(stdout.includes('skills list'));
  assert.ok(stdout.includes('auth login'));
});

test('runCli with --version prints the version', async () => {
  const { stdout, result } = await capture(() => runCli(['--version']));
  assert.equal(result, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+\n$/);
});

test('runCli with an unknown command prints an error and exits 2', async () => {
  const { stderr, result } = await capture(() => runCli(['not-a-command']));
  assert.equal(result, 2);
  assert.match(stderr, /unknown command "not-a-command"/);
});

test('runCli routes --help through the skills subcommand', async () => {
  const { stdout, result } = await capture(() => runCli(['skills', '--help']));
  assert.equal(result, 0);
  assert.ok(stdout.includes('cepage skills list'));
});

test('runCli --help advertises the webhooks command', async () => {
  const { stdout, result } = await capture(() => runCli(['--help']));
  assert.equal(result, 0);
  assert.ok(stdout.includes('webhooks list'));
  assert.ok(stdout.includes('webhooks rotate-secret'));
});

test('runCli routes --help through the webhooks subcommand', async () => {
  const { stdout, result } = await capture(() => runCli(['webhooks', '--help']));
  assert.equal(result, 0);
  assert.ok(stdout.includes('cepage webhooks list'));
  assert.ok(stdout.includes('cepage webhooks ping'));
});
