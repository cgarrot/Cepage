import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  buildRunArtifactsBundle,
  captureWorkspaceState,
  resolveWorkspaceFilePath,
} from '../run-artifacts.util.js';

test('buildRunArtifactsBundle reports added modified and deleted files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-artifacts-'));
  try {
    await fs.writeFile(path.join(root, 'keep.txt'), 'before');
    await fs.writeFile(path.join(root, 'remove.txt'), 'gone');
    const before = await captureWorkspaceState(root);

    await fs.writeFile(path.join(root, 'keep.txt'), 'after');
    await fs.rm(path.join(root, 'remove.txt'));
    await fs.writeFile(path.join(root, 'new.txt'), 'brand new');
    const after = await captureWorkspaceState(root);

    const bundle = buildRunArtifactsBundle({
      runId: 'run-1',
      ownerNodeId: 'node-1',
      cwd: root,
      before,
      after,
      preview: { status: 'available', strategy: 'static' },
    });

    assert.deepEqual(bundle.summary.counts, {
      added: 1,
      modified: 1,
      deleted: 1,
      total: 3,
    });
    assert.deepEqual(
      bundle.files.map((file) => `${file.kind}:${file.path}`),
      ['added:new.txt', 'modified:keep.txt', 'deleted:remove.txt'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveWorkspaceFilePath blocks traversal outside the workspace root', () => {
  assert.throws(
    () => resolveWorkspaceFilePath('/tmp/demo', '../secret.txt'),
    /WORKSPACE_FILE_PATH_INVALID/,
  );
});
