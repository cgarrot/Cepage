import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpencodeExtractorService,
  type OpenCodeEvent,
} from '../extractors/opencode-extractor.service.js';

const svc = new OpencodeExtractorService();

test('empty event stream returns empty session', () => {
  const result = svc.parse([]);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
  assert.equal(result.metadata.eventCount, 0);
  assert.equal(result.metadata.collapsedRetries, 0);
});

test('simple text response maps to agent_output + agent_step', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start', role: 'user', content: 'Hello' },
    { type: 'content_block_delta', delta: 'Hi there!', blockType: 'text' },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.ok(result.nodes.some((n) => n.type === 'agent_step'));
  assert.ok(result.nodes.some((n) => n.type === 'agent_output'));

  const out = result.nodes.find((n) => n.type === 'agent_output');
  assert.equal(out?.content.text, 'Hi there!');
});

test('tool_use → tool_result maps to runtime_run node', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'tool_use',
      name: 'shell',
      input: { command: 'ls -la' },
      callId: 'call-1',
    },
    {
      type: 'tool_result',
      callId: 'call-1',
      output: 'total 42',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const toolNode = result.nodes.find((n) => n.type === 'runtime_run');
  assert.ok(toolNode);
  assert.equal(toolNode?.content.toolName, 'shell');
  assert.equal(toolNode?.content.output, 'total 42');
});

test('file_edit event maps to file_edit node', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'file_edit',
      path: 'src/index.ts',
      operation: 'write',
      content: 'console.log(1);',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const editNode = result.nodes.find((n) => n.type === 'file_diff');
  assert.ok(editNode);
  assert.equal(editNode?.content.path, 'src/index.ts');
  assert.equal(editNode?.content.operation, 'write');
});

test('command_execution maps to runtime_run node', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'command_execution',
      command: 'npm test',
      cwd: '/project',
      exitCode: 0,
      stdout: 'passing',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const runNode = result.nodes.find((n) => n.type === 'runtime_run');
  assert.ok(runNode);
  assert.equal(runNode?.content.command, 'npm test');
  assert.equal(runNode?.content.stdout, 'passing');
});

test('reasoning deltas are captured in agent_output content', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    { type: 'content_block_delta', delta: 'Let me think...', blockType: 'reasoning' },
    { type: 'content_block_delta', delta: ' Done.', blockType: 'text' },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const out = result.nodes.find((n) => n.type === 'agent_output');
  assert.equal(out?.content.reasoning, 'Let me think...');
  assert.equal(out?.content.text, ' Done.');
});

test('retry loop deduplication collapses failed + success into single node', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'tool_use',
      name: 'shell',
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
      name: 'shell',
      input: { command: 'rm x' },
      callId: 'call-2',
    },
    {
      type: 'tool_result',
      callId: 'call-2',
      output: 'removed',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const runNodes = result.nodes.filter((n) => n.type === 'runtime_run');
  assert.equal(runNodes.length, 1);
  assert.equal(result.metadata.collapsedRetries, 1);
  assert.equal(runNodes[0]?.content.output, 'removed');
  assert.equal(runNodes[0]?.metadata.isRetry, true);
});

test('file_edit retry deduplication by path', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'file_edit',
      path: 'a.txt',
      operation: 'write',
      content: 'bad',
    },
    {
      type: 'tool_result',
      error: 'Permission denied',
      isError: true,
    },
    {
      type: 'file_edit',
      path: 'a.txt',
      operation: 'write',
      content: 'good',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const edits = result.nodes.filter((n) => n.type === 'file_diff');
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.content.content, 'good');
  assert.equal(result.metadata.collapsedRetries, 1);
});

test('command retry deduplication by command string', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    {
      type: 'command_execution',
      command: 'git push',
      exitCode: 1,
      stderr: 'rejected',
    },
    {
      type: 'command_execution',
      command: 'git push',
      exitCode: 0,
      stdout: 'ok',
    },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  const runs = result.nodes.filter((n) => n.type === 'runtime_run');
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.content.stdout, 'ok');
  assert.equal(result.metadata.collapsedRetries, 1);
});

test('error event creates agent_output with error status', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    { type: 'content_block_delta', delta: 'Working...' },
    { type: 'error', message: 'Stream closed', code: 'EPIPE' },
  ];
  const result = svc.parse(events);

  const out = result.nodes.find((n) => n.type === 'agent_output' && n.content.error);
  assert.ok(out);
  assert.equal(out?.status, 'error');
  assert.equal(out?.content.error, 'Stream closed');
  assert.equal(out?.content.code, 'EPIPE');
});

test('message_stop records stopReason on last output node', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    { type: 'content_block_delta', delta: 'Done' },
    { type: 'message_stop', stopReason: 'end_turn' },
  ];
  const result = svc.parse(events);

  const out = result.nodes.find((n) => n.type === 'agent_output');
  assert.equal(out?.content.stopReason, 'end_turn');
});

test('orphan tool_result without pending tool is silently dropped', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start' },
    { type: 'tool_result', callId: 'orphan', output: 'ignored' },
    { type: 'message_stop' },
  ];
  const result = svc.parse(events);

  assert.equal(result.nodes.filter((n) => n.type === 'runtime_run').length, 0);
});

test('complex session with multiple tools, outputs and steps', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start', role: 'user', content: 'Build Stripe integration' },
    { type: 'content_block_delta', delta: 'Planning...', blockType: 'reasoning' },
    {
      type: 'tool_use',
      name: 'file_write',
      input: { path: 'src/stripe.ts', content: '...' },
      callId: 'c1',
    },
    {
      type: 'tool_result',
      callId: 'c1',
      output: 'File written',
    },
    { type: 'content_block_delta', delta: 'Now setting up tests...' },
    {
      type: 'command_execution',
      command: 'npm test',
      exitCode: 0,
      stdout: '2 passing',
    },
    { type: 'message_stop', stopReason: 'end_turn' },
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
  const fileInput = files[0]?.content.input as Record<string, unknown> | undefined;
  assert.equal(fileInput?.path, 'src/stripe.ts');
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.content.command, 'npm test');
});

test('coverage: at least 80% of synthetic events map to nodes', () => {
  const events: OpenCodeEvent[] = [
    { type: 'message_start', role: 'user', content: 'Hello' },
    { type: 'content_block_delta', delta: 'Hi', blockType: 'text' },
    { type: 'content_block_delta', delta: '!', blockType: 'text' },
    {
      type: 'tool_use',
      name: 'shell',
      input: { command: 'echo 1' },
      callId: 'c1',
    },
    { type: 'tool_result', callId: 'c1', output: '1' },
    {
      type: 'file_edit',
      path: 'x.txt',
      operation: 'write',
      content: 'data',
    },
    {
      type: 'command_execution',
      command: 'ls',
      exitCode: 0,
      stdout: 'x.txt',
    },
    { type: 'message_stop' },
  ];

  const result = svc.parse(events);
  const meaningfulEvents = events.filter(
    (e) =>
      e.type !== 'message_start' &&
      e.type !== 'message_stop' &&
      e.type !== 'tool_result',
  ).length;

  const mappedNodes = result.nodes.filter(
    (n) =>
      n.type === 'agent_output' ||
      n.type === 'runtime_run' ||
      n.type === 'file_diff' ||
      n.type === 'agent_step',
  ).length;

  const ratio = mappedNodes / meaningfulEvents;
  assert.ok(
    ratio >= 0.8,
    `Mapped ${mappedNodes} nodes from ${meaningfulEvents} meaningful events (ratio ${ratio})`,
  );
});
