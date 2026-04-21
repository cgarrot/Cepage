import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnRequestId, collectConnectedNodeIds } from '../graph-context.js';

test('collectConnectedNodeIds returns the whole connected component', () => {
  const ids = collectConnectedNodeIds('a', [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'x', target: 'y' },
  ]).sort();

  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('collectConnectedNodeIds keeps an isolated node', () => {
  const ids = collectConnectedNodeIds('solo', [{ source: 'a', target: 'b' }]);
  assert.deepEqual(ids, ['solo']);
});

test('buildSpawnRequestId stays stable with duplicate or reordered seeds', () => {
  const a = buildSpawnRequestId('session-1', ['n3', 'n1', 'n2', 'n1']);
  const b = buildSpawnRequestId('session-1', ['n2', 'n3', 'n1']);
  assert.equal(a, b);
});

test('buildSpawnRequestId changes when workspace or trigger changes', () => {
  const a = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'node-a',
    workingDirectory: '/tmp/a',
  });
  const b = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'node-a',
    workingDirectory: '/tmp/b',
  });
  const c = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'node-b',
    workingDirectory: '/tmp/a',
  });

  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('buildSpawnRequestId changes when agent selection changes', () => {
  const a = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    type: 'opencode',
    providerID: 'anthropic',
    modelID: 'claude-4.5-sonnet',
  });
  const b = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    type: 'opencode',
    providerID: 'openai',
    modelID: 'gpt-5.4-medium',
  });
  const c = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    type: 'cursor_agent',
    providerID: 'openai',
    modelID: 'gpt-5.4-medium',
  });

  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

test('buildSpawnRequestId changes when input materialization changes', () => {
  const a = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'input-1',
    variant: 'inline:brief-a',
  });
  const b = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'input-1',
    variant: 'inline:brief-b',
  });
  const c = buildSpawnRequestId('session-1', ['n1', 'n2'], {
    triggerNodeId: 'input-1',
    variant: 'source:note-1',
  });

  assert.notEqual(a, b);
  assert.notEqual(b, c);
});
