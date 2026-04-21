import assert from 'node:assert/strict';
import test from 'node:test';
import type { Creator, GraphNode, NodeContent, NodeType } from '@cepage/shared-core';
import {
  buildWorkspaceFileTree,
  selectWorkspaceFiles,
  selectWorkspaceFilesView,
} from '../workspace-files.js';

function node(input: {
  id: string;
  type: NodeType;
  creator: Creator;
  content?: NodeContent;
  createdAt?: string;
  updatedAt?: string;
}): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-07T10:00:00.000Z',
    updatedAt: input.updatedAt ?? input.createdAt ?? '2026-04-07T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator,
    position: { x: 0, y: 0 },
    dimensions: { width: 280, height: 120 },
    metadata: {},
    status: 'active',
    branches: [],
  };
}

const agent: Creator = { type: 'agent', agentType: 'opencode', agentId: 'a1' };

function file(
  id: string,
  relativePath: string,
  options: {
    updatedAt?: string;
    title?: string;
    status?: 'declared' | 'available' | 'missing' | 'deleted';
    change?: 'added' | 'modified' | 'deleted';
    resolvedRelativePath?: string;
  } = {},
): GraphNode {
  return node({
    id,
    type: 'workspace_file',
    creator: agent,
    updatedAt: options.updatedAt ?? '2026-04-07T10:00:00.000Z',
    content: {
      title: options.title,
      relativePath,
      role: 'output',
      origin: 'agent_output',
      kind: 'text',
      status: options.status ?? 'available',
      ...(options.change ? { change: options.change } : {}),
      ...(options.resolvedRelativePath
        ? { resolvedRelativePath: options.resolvedRelativePath }
        : {}),
    },
  });
}

test('selectWorkspaceFiles ignores non workspace_file nodes', () => {
  const out = selectWorkspaceFiles([
    file('f1', 'a.md'),
    node({
      id: 'msg',
      type: 'agent_message',
      creator: agent,
      content: { text: 'hi' },
    }),
  ]);
  assert.deepEqual(
    out.map((entry) => entry.id),
    ['f1'],
  );
});

test('selectWorkspaceFiles drops artifacts missing a relative path', () => {
  const out = selectWorkspaceFiles([
    node({
      id: 'broken',
      type: 'workspace_file',
      creator: agent,
      content: { role: 'output', origin: 'agent_output', kind: 'text' },
    }),
    file('ok', 'docs/keep.md'),
  ]);
  assert.deepEqual(
    out.map((entry) => entry.id),
    ['ok'],
  );
});

test('selectWorkspaceFiles sorts by updatedAt desc, then path asc', () => {
  const out = selectWorkspaceFiles([
    file('old', 'docs/old.md', { updatedAt: '2026-04-07T08:00:00.000Z' }),
    file('newest', 'src/new.ts', { updatedAt: '2026-04-07T10:00:00.000Z' }),
    file('tied-a', 'src/a.ts', { updatedAt: '2026-04-07T09:00:00.000Z' }),
    file('tied-b', 'src/b.ts', { updatedAt: '2026-04-07T09:00:00.000Z' }),
  ]);
  assert.deepEqual(
    out.map((entry) => entry.id),
    ['newest', 'tied-a', 'tied-b', 'old'],
  );
});

test('selectWorkspaceFiles prefers resolvedRelativePath when present', () => {
  const [entry] = selectWorkspaceFiles([
    file('f1', 'plan.md', { resolvedRelativePath: 'runs/r-1/plan.md' }),
  ]);
  assert.equal(entry.path, 'runs/r-1/plan.md');
  assert.equal(entry.resolvedPath, 'runs/r-1/plan.md');
});

test('buildWorkspaceFileTree groups files by folder and sorts directories first', () => {
  const entries = selectWorkspaceFiles([
    file('a', 'src/a.ts'),
    file('b', 'src/components/b.tsx'),
    file('c', 'README.md'),
    file('d', 'src/components/c.tsx'),
  ]);
  const tree = buildWorkspaceFileTree(entries);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].kind, 'directory');
  assert.equal(tree[0].name, 'src');
  assert.equal(tree[1].kind, 'file');
  assert.equal(tree[1].name, 'README.md');

  if (tree[0].kind !== 'directory') return;
  const srcChildren = tree[0].children;
  assert.equal(srcChildren.length, 2);
  assert.equal(srcChildren[0].kind, 'directory');
  assert.equal(srcChildren[0].name, 'components');
  assert.equal(srcChildren[1].kind, 'file');
  assert.equal(srcChildren[1].name, 'a.ts');
  if (srcChildren[0].kind !== 'directory') return;
  assert.deepEqual(
    srcChildren[0].children.map((child) => child.name),
    ['b.tsx', 'c.tsx'],
  );
});

test('buildWorkspaceFileTree skips empty path segments and `..` traversals safely', () => {
  const entries = selectWorkspaceFiles([
    file('a', '/safe/file.txt'),
    file('b', 'dirty/../file.txt'),
    file('c', './leading.txt'),
  ]);
  const tree = buildWorkspaceFileTree(entries);
  const paths = (function flatten(nodes: typeof tree): string[] {
    return nodes.flatMap((n) =>
      n.kind === 'file' ? [n.path] : flatten(n.children),
    );
  })(tree);
  assert.deepEqual(paths.sort(), ['./leading.txt', '/safe/file.txt', 'dirty/../file.txt'].sort());
});

test('selectWorkspaceFilesView returns both flat list and tree in one call', () => {
  const view = selectWorkspaceFilesView([file('a', 'src/a.ts'), file('b', 'src/b.ts')]);
  assert.equal(view.entries.length, 2);
  assert.equal(view.tree.length, 1);
  assert.equal(view.tree[0].kind, 'directory');
  if (view.tree[0].kind !== 'directory') return;
  assert.equal(view.tree[0].children.length, 2);
});

test('buildWorkspaceFileTree de-duplicates files sharing the same path', () => {
  const entries = selectWorkspaceFiles([
    file('a', 'src/dup.ts', { updatedAt: '2026-04-07T10:00:00.000Z' }),
    file('b', 'src/dup.ts', { updatedAt: '2026-04-07T11:00:00.000Z' }),
  ]);
  const tree = buildWorkspaceFileTree(entries);
  assert.equal(tree[0].kind, 'directory');
  if (tree[0].kind !== 'directory') return;
  assert.equal(tree[0].children.length, 1);
  if (tree[0].children[0].kind !== 'file') return;
  assert.equal(tree[0].children[0].entry.id, 'b');
});
