import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutoWorkspaceDirectoryName,
  buildSessionWorkspace,
  normalizeWorkspaceDirectoryName,
  readSessionWorkspace,
} from '../session-workspace.util';

test('normalizeWorkspaceDirectoryName keeps a user name and strips path separators', () => {
  assert.equal(
    normalizeWorkspaceDirectoryName('client / alpha', 'session-12345678'),
    'client - alpha',
  );
});

test('normalizeWorkspaceDirectoryName auto-generates when empty', () => {
  assert.equal(
    normalizeWorkspaceDirectoryName('', 'session-12345678'),
    buildAutoWorkspaceDirectoryName('session-12345678'),
  );
});

test('buildSessionWorkspace resolves the final working directory', () => {
  assert.deepEqual(
    buildSessionWorkspace('/srv/cepage', 'session-12345678', '/tmp/workspaces', 'alpha'),
    {
      parentDirectory: '/tmp/workspaces',
      directoryName: 'alpha',
      workingDirectory: '/tmp/workspaces/alpha',
    },
  );
});

test('readSessionWorkspace rebuilds a persisted session workspace', () => {
  assert.deepEqual(
    readSessionWorkspace('/srv/cepage', {
      id: 'session-12345678',
      workspaceParentDirectory: 'sandbox',
      workspaceDirectoryName: 'session-123456',
    }),
    {
      parentDirectory: 'sandbox',
      directoryName: 'session-123456',
      workingDirectory: '/srv/cepage/sandbox/session-123456',
    },
  );
});
