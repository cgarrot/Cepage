import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenDirectoryCommand,
  buildChooseFolderScript,
  isDirectoryPickerCancelled,
  normalizeChosenDirectory,
} from '../session-directory-picker';

test('buildChooseFolderScript includes the default path when provided', () => {
  const script = buildChooseFolderScript('/Users/test/workspaces');
  assert.match(script, /default location POSIX file "\/Users\/test\/workspaces"/);
});

test('normalizeChosenDirectory trims osascript output', () => {
  assert.equal(normalizeChosenDirectory('/Users/test/workspaces/\n'), '/Users/test/workspaces');
});

test('isDirectoryPickerCancelled detects a cancelled macOS dialog', () => {
  assert.equal(
    isDirectoryPickerCancelled(new Error('execution error: User canceled. (-128)')),
    true,
  );
});

test('buildOpenDirectoryCommand uses open on macOS', () => {
  assert.deepEqual(buildOpenDirectoryCommand('/Users/test/workspaces', 'darwin'), {
    cmd: 'open',
    args: ['/Users/test/workspaces'],
  });
});

test('buildOpenDirectoryCommand uses xdg-open on linux', () => {
  assert.deepEqual(buildOpenDirectoryCommand('/tmp/workspaces', 'linux'), {
    cmd: 'xdg-open',
    args: ['/tmp/workspaces'],
  });
});
