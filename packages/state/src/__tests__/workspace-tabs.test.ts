import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_TAB_ID,
  closeFileTab,
  emptyTabsState,
  getSessionTabs,
  isFileTab,
  openFileTab,
  setActiveTab,
} from '../workspace-tabs.js';

test('emptyTabsState seeds the chat tab as active without any open files', () => {
  const state = emptyTabsState();
  assert.equal(state.activeId, CHAT_TAB_ID);
  assert.deepEqual(state.order, []);
  assert.deepEqual(state.byId, {});
});

test('getSessionTabs returns an empty state for unknown sessions', () => {
  const state = getSessionTabs({}, 'session-1');
  assert.deepEqual(state, emptyTabsState());
  assert.deepEqual(getSessionTabs({}, null), emptyTabsState());
});

test('isFileTab differentiates the chat pin from file tabs', () => {
  assert.equal(isFileTab(CHAT_TAB_ID), false);
  assert.equal(isFileTab('file:s1:foo.ts'), true);
});

test('openFileTab opens a new tab, derives title from filename, and activates it', () => {
  const empty: ReturnType<typeof emptyTabsState> extends infer T ? Record<string, T> : never =
    {};
  const { next, tabId } = openFileTab(empty, 'session-1', { path: 'src/foo/bar.ts' });
  const state = next['session-1']!;
  assert.equal(tabId, 'file:session-1:src/foo/bar.ts');
  assert.equal(state.activeId, tabId);
  assert.deepEqual(state.order, [tabId]);
  assert.equal(state.byId[tabId]!.title, 'bar.ts');
  assert.equal(state.byId[tabId]!.path, 'src/foo/bar.ts');
});

test('openFileTab keeps an existing tab and just refocuses it', () => {
  const first = openFileTab({}, 'session-1', { path: 'foo.ts' });
  const second = openFileTab(first.next, 'session-1', { path: 'bar.ts' });
  // Reopen foo.ts: order must not duplicate it but it must become active again
  const refocus = openFileTab(second.next, 'session-1', { path: 'foo.ts' });
  const state = refocus.next['session-1']!;
  assert.deepEqual(state.order, [first.tabId, second.tabId]);
  assert.equal(state.activeId, first.tabId);
});

test('openFileTab honors a custom title when provided', () => {
  const { next, tabId } = openFileTab({}, 'session-1', {
    path: 'docs/plan.md',
    title: 'Plan',
  });
  assert.equal(next['session-1']!.byId[tabId]!.title, 'Plan');
});

test('openFileTab is a no-op when path is blank', () => {
  const { next, tabId } = openFileTab({}, 'session-1', { path: '   ' });
  assert.deepEqual(next, {});
  assert.equal(tabId, CHAT_TAB_ID);
});

test('closeFileTab refocuses the chat tab when closing the only file', () => {
  const opened = openFileTab({}, 'session-1', { path: 'a.ts' });
  const closed = closeFileTab(opened.next, 'session-1', opened.tabId);
  const state = closed['session-1']!;
  assert.deepEqual(state.order, []);
  assert.equal(state.activeId, CHAT_TAB_ID);
  assert.equal(Object.keys(state.byId).length, 0);
});

test('closeFileTab refocuses an adjacent tab when closing the active one', () => {
  const a = openFileTab({}, 'session-1', { path: 'a.ts' });
  const b = openFileTab(a.next, 'session-1', { path: 'b.ts' });
  const c = openFileTab(b.next, 'session-1', { path: 'c.ts' });
  // c.ts is active; close b.ts -> active stays on c.ts
  const closedB = closeFileTab(c.next, 'session-1', b.tabId);
  assert.equal(closedB['session-1']!.activeId, c.tabId);
  // Now close c.ts (active) -> previous index 1 was b (gone); pick last remaining
  const closedC = closeFileTab(closedB, 'session-1', c.tabId);
  assert.equal(closedC['session-1']!.activeId, a.tabId);
});

test('closeFileTab refuses to close the pinned chat tab', () => {
  const opened = openFileTab({}, 'session-1', { path: 'a.ts' });
  const noop = closeFileTab(opened.next, 'session-1', CHAT_TAB_ID);
  assert.equal(noop, opened.next);
});

test('setActiveTab returns the same reference when activating the current tab', () => {
  const { next, tabId } = openFileTab({}, 'session-1', { path: 'a.ts' });
  const same = setActiveTab(next, 'session-1', tabId);
  assert.equal(same, next);
});

test('setActiveTab can switch back to the chat pin even with file tabs open', () => {
  const opened = openFileTab({}, 'session-1', { path: 'a.ts' });
  const switched = setActiveTab(opened.next, 'session-1', CHAT_TAB_ID);
  assert.equal(switched['session-1']!.activeId, CHAT_TAB_ID);
});

test('setActiveTab refuses to activate a tab that does not exist', () => {
  const opened = openFileTab({}, 'session-1', { path: 'a.ts' });
  const noop = setActiveTab(opened.next, 'session-1', 'file:session-1:ghost.ts');
  assert.equal(noop, opened.next);
});
