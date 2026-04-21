import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { buildPreviewLaunchSpec, detectPreviewLaunchSpec } from '../preview-detect.util.js';

test('detectPreviewLaunchSpec finds a static html workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-preview-static-'));
  try {
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>ok</body></html>');
    const detected = await detectPreviewLaunchSpec(root);
    assert.equal(detected.preview.status, 'available');
    assert.equal(detected.preview.strategy, 'static');
    assert.equal(detected.preview.root, '.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('buildPreviewLaunchSpec prefers apps/web package scripts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-preview-script-'));
  try {
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await fs.mkdir(path.join(root, 'apps', 'web'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({
        scripts: {
          dev: 'next dev',
        },
        dependencies: {
          next: '15.0.0',
        },
      }),
    );

    const detected = await buildPreviewLaunchSpec(root, 4310);
    assert.equal(detected.preview.strategy, 'script');
    assert.equal(detected.preview.status, 'available');
    assert.equal(detected.preview.root, 'apps/web');
    assert.equal(detected.command, 'pnpm');
    assert.deepEqual(detected.args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '4310']);
    assert.match(detected.preview.command ?? '', /pnpm run dev/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
