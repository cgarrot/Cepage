import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  applyRuntimeTemplate,
  buildDetectedRuntimeEnvelope,
  readRuntimeManifestFromFile,
  resolveRuntimeManifestCandidate,
} from '../runtime-manifest.util.js';

test('readRuntimeManifestFromFile loads cepage-run.json from the workspace root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-runtime-file-'));
  try {
    await fs.writeFile(
      path.join(root, 'cepage-run.json'),
      JSON.stringify({
        schema: 'cepage.runtime/v1',
        schemaVersion: 1,
        targets: [
          {
            kind: 'web',
            launchMode: 'local_process',
            serviceName: 'web',
            cwd: '.',
            preview: { mode: 'static', entry: 'index.html' },
          },
        ],
      }),
    );

    const manifest = await readRuntimeManifestFromFile(root);
    assert.equal(manifest?.source, 'file');
    assert.equal(manifest?.envelope.targets[0]?.serviceName, 'web');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveRuntimeManifestCandidate falls back to fenced cepage-run output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-runtime-text-'));
  try {
    const manifest = await resolveRuntimeManifestCandidate({
      root,
      textOutput: `
The app is ready.

\`\`\`cepage-run
{
  "schema": "cepage.runtime/v1",
  "schemaVersion": 1,
  "targets": [
    {
      "kind": "cli",
      "launchMode": "local_process",
      "serviceName": "tool",
      "cwd": ".",
      "command": "node",
      "args": ["cli.js"]
    }
  ]
}
\`\`\`
`,
    });
    assert.equal(manifest?.source, 'text');
    assert.equal(manifest?.envelope.targets[0]?.kind, 'cli');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveRuntimeManifestCandidate auto-detects a web app when no explicit manifest exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-runtime-detected-'));
  try {
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await fs.mkdir(path.join(root, 'apps', 'web'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({
        scripts: { dev: 'vite' },
        devDependencies: { vite: '6.0.0' },
      }),
    );

    const manifest = await resolveRuntimeManifestCandidate({ root, textOutput: '' });
    assert.equal(manifest?.source, 'detected');
    assert.equal(manifest?.envelope.targets[0]?.kind, 'web');
    assert.deepEqual(manifest?.envelope.targets[0]?.args, [
      'run',
      'dev',
      '--',
      '--host',
      '{{HOST}}',
      '--port',
      '{{PORT}}',
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('buildDetectedRuntimeEnvelope creates a static preview target', () => {
  const envelope = buildDetectedRuntimeEnvelope('/tmp/demo', {
    cwd: '/tmp/demo',
    preview: {
      status: 'available',
      strategy: 'static',
      root: '.',
      framework: 'html',
    },
  });
  assert.equal(envelope?.targets[0]?.preview?.mode, 'static');
  assert.equal(envelope?.targets[0]?.autoRun, true);
});

test('applyRuntimeTemplate replaces runtime placeholders', () => {
  assert.equal(
    applyRuntimeTemplate('pnpm run dev -- --host {{HOST}} --port {{PORT}}', {
      HOST: '127.0.0.1',
      PORT: '4321',
    }),
    'pnpm run dev -- --host 127.0.0.1 --port 4321',
  );
});
