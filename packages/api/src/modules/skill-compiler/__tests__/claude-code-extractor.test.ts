import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClaudeCodeExtractorService,
  type ClaudeCodeEvent,
} from '../extractors/claude-code-extractor.service.js';

const svc = new ClaudeCodeExtractorService();

test('empty event stream returns empty session', () => {
  const result = svc.parse([]);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
  assert.equal(result.metadata.eventCount, 0);
  assert.equal(result.metadata.collapsedRetries, 0);
});

test('user and assistant messages map to human_message and agent_output nodes', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Hello Claude' },
    { type: 'assistant', content: 'Hi there!' },
  ];
  const result = svc.parse(events);

  assert.equal(result.nodes.length, 3);
  assert.ok(result.nodes.some((n) => n.type === 'agent_step'));
  assert.ok(result.edges.length >= 1);

  const humanNode = result.nodes.find((n) => n.type === 'human_message');
  assert.ok(humanNode);
  assert.equal(humanNode?.content.text, 'Hello Claude');

  const out = result.nodes.find((n) => n.type === 'agent_output');
  assert.ok(out);
  assert.equal(out?.content.text, 'Hi there!');
});

test('tool_use Bash maps to runtime_run node with command content', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Run tests' },
    {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test', cwd: '/project' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      output: '2 passing',
    },
  ];
  const result = svc.parse(events);

  const toolNode = result.nodes.find((n) => n.type === 'runtime_run');
  assert.ok(toolNode);
  assert.equal(toolNode?.content.command, 'npm test');
  assert.equal(toolNode?.content.output, '2 passing');
});

test('tool_use Write maps to file_diff node', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Create a file' },
    {
      type: 'tool_use',
      name: 'Write',
      input: { path: 'src/index.ts', content: 'console.log(1);' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      output: 'File written',
    },
  ];
  const result = svc.parse(events);

  const editNode = result.nodes.find((n) => n.type === 'file_diff');
  assert.ok(editNode);
  assert.equal(editNode?.content.path, 'src/index.ts');
  assert.equal(editNode?.content.content, 'console.log(1);');
});

test('tool_use Read maps to workspace_file node', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Read a file' },
    {
      type: 'tool_use',
      name: 'Read',
      input: { path: 'package.json' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      output: '{"name": "test"}',
    },
  ];
  const result = svc.parse(events);

  const readNode = result.nodes.find((n) => n.type === 'workspace_file');
  assert.ok(readNode);
  assert.equal(readNode?.content.path, 'package.json');
  assert.equal(readNode?.content.output, '{"name": "test"}');
});

test('thinking content is captured in agent_output node', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Solve this' },
    { type: 'assistant', thinking: 'Let me think...', content: 'The answer is 42.' },
  ];
  const result = svc.parse(events);

  const out = result.nodes.find((n) => n.type === 'agent_output');
  assert.equal(out?.content.reasoning, 'Let me think...');
  assert.equal(out?.content.text, 'The answer is 42.');
});

test('retry loop deduplication collapses failed + success into single node', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Remove file' },
    {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'rm x' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      error: 'No such file',
      isError: true,
    },
    {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'rm x' },
      callId: 'call-2',
    },
    {
      type: 'tool_result',
      callId: 'call-2',
      output: 'removed',
    },
  ];
  const result = svc.parse(events);

  const runNodes = result.nodes.filter((n) => n.type === 'runtime_run');
  assert.equal(runNodes.length, 1);
  assert.equal(result.metadata.collapsedRetries, 1);
  assert.equal(runNodes[0]?.content.output, 'removed');
  assert.equal(runNodes[0]?.metadata.isRetry, true);
});

test('file tool retry deduplication by tool name', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Fix file' },
    {
      type: 'tool_use',
      name: 'Write',
      input: { path: 'a.txt', content: 'bad' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      error: 'Permission denied',
      isError: true,
    },
    {
      type: 'tool_use',
      name: 'Write',
      input: { path: 'a.txt', content: 'good' },
      callId: 'call-2',
    },
    {
      type: 'tool_result',
      callId: 'call-2',
      output: 'written',
    },
  ];
  const result = svc.parse(events);

  const edits = result.nodes.filter((n) => n.type === 'file_diff');
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.content.content, 'good');
  assert.equal(result.metadata.collapsedRetries, 1);
});

test('error event creates agent_output with error status', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Do something' },
    { type: 'assistant', content: 'Working...' },
    { type: 'error', message: 'API rate limit exceeded', code: 'RATE_LIMIT' },
  ];
  const result = svc.parse(events);

  const out = result.nodes.find((n) => n.type === 'agent_output' && n.content.error);
  assert.ok(out);
  assert.equal(out?.status, 'error');
  assert.equal(out?.content.error, 'API rate limit exceeded');
  assert.equal(out?.content.code, 'RATE_LIMIT');
});

test('orphan tool_result without pending tool is silently dropped', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Hello' },
    { type: 'tool_result', callId: 'orphan', output: 'ignored' },
  ];
  const result = svc.parse(events);

  assert.equal(result.nodes.filter((n) => n.type === 'runtime_run').length, 0);
});

test('complex session with multiple tools, outputs and steps', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Build Stripe integration' },
    { type: 'assistant', thinking: 'Planning...' },
    {
      type: 'tool_use',
      name: 'Write',
      input: { path: 'src/stripe.ts', content: '...' },
      callId: 'c1',
    },
    {
      type: 'tool_result',
      callId: 'c1',
      output: 'File written',
    },
    { type: 'assistant', content: 'Now setting up tests...' },
    {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test' },
      callId: 'c2',
    },
    {
      type: 'tool_result',
      callId: 'c2',
      output: '2 passing',
    },
  ];
  const result = svc.parse(events);

  assert.ok(result.nodes.length >= 5);
  assert.ok(result.edges.length >= 4);

  const steps = result.nodes.filter((n) => n.type === 'agent_step');
  const outputs = result.nodes.filter((n) => n.type === 'agent_output');
  const files = result.nodes.filter((n) => n.type === 'file_diff');
  const runs = result.nodes.filter((n) => n.type === 'runtime_run');

  assert.ok(steps.length >= 1);
  assert.ok(outputs.length >= 1);
  assert.equal(files.length, 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.content.command, 'npm test');
});

test('coverage: at least 80% of synthetic events map to nodes', () => {
  const events: ClaudeCodeEvent[] = [
    { type: 'user', content: 'Hello' },
    { type: 'assistant', content: 'Hi' },
    {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'echo 1' },
      callId: 'c1',
    },
    { type: 'tool_result', callId: 'c1', output: '1' },
    {
      type: 'tool_use',
      name: 'Write',
      input: { path: 'x.txt', content: 'data' },
      callId: 'c2',
    },
    { type: 'tool_result', callId: 'c2', output: 'done' },
    {
      type: 'tool_use',
      name: 'Read',
      input: { path: 'y.txt' },
      callId: 'c3',
    },
    { type: 'tool_result', callId: 'c3', output: 'content' },
  ];

  const result = svc.parse(events);
  const meaningfulEvents = events.filter(
    (e) => e.type !== 'tool_result',
  ).length;

  const mappedNodes = result.nodes.filter(
    (n) =>
      n.type === 'agent_output' ||
      n.type === 'runtime_run' ||
      n.type === 'file_diff' ||
      n.type === 'workspace_file' ||
      n.type === 'human_message' ||
      n.type === 'agent_step',
  ).length;

  const ratio = mappedNodes / meaningfulEvents;
  assert.ok(
    ratio >= 0.8,
    `Mapped ${mappedNodes} nodes from ${meaningfulEvents} meaningful events (ratio ${ratio})`,
  );
});
