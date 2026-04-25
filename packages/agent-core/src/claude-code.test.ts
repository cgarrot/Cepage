import assert from 'node:assert/strict';
import test from 'node:test';
import { type AgentRuntimeEvent } from '@cepage/shared-core';
import {
  listClaudeCodeCatalog,
  parseClaudeModelsOutput,
  runClaudeCodeStream,
} from './claude-code.js';

test('parseClaudeModelsOutput extracts models from markdown table', () => {
  const providers = parseClaudeModelsOutput(`
Current Claude models:

| Model | ID |
|---|---|
| Opus 4.7 | \`claude-opus-4-7\` |
| Sonnet 4.6 | \`claude-sonnet-4-6\` |
| Haiku 4.5 | \`claude-haiku-4-5\` |
`);

  assert.equal(providers.length, 1);
  const anthropic = providers[0];
  assert.ok(anthropic);
  assert.equal(anthropic.agentType, 'claude_code');
  assert.equal(anthropic.providerID, 'anthropic');
  assert.equal(anthropic.models.length, 3);
  assert.equal(anthropic.models[0]?.modelID, 'claude-haiku-4-5');
  assert.equal(anthropic.models[1]?.modelID, 'claude-opus-4-7');
  assert.equal(anthropic.models[2]?.modelID, 'claude-sonnet-4-6');
});

test('parseClaudeModelsOutput returns empty array for malformed output', () => {
  const providers = parseClaudeModelsOutput('No models here');
  assert.deepEqual(providers, []);
});

test('listClaudeCodeCatalog returns fallback catalog when CLI fails', async () => {
  process.env.CLAUDE_BIN = '/nonexistent/claude';
  try {
    const catalog = await listClaudeCodeCatalog();
    assert.equal(catalog.providers.length, 1);
    assert.equal(catalog.providers[0]?.agentType, 'claude_code');
    assert.equal(catalog.providers[0]?.models.length, 3);
    assert.ok(catalog.fetchedAt);
  } finally {
    delete process.env.CLAUDE_BIN;
  }
});

test('runClaudeCodeStream emits stdout, done, and respects abort', async () => {
  const events: AgentRuntimeEvent[] = [];
  const ac = new AbortController();
  ac.abort();

  const stream = runClaudeCodeStream({
    workingDirectory: '/tmp',
    promptText: 'hello',
    signal: ac.signal,
  });

  for await (const event of stream) {
    events.push(event as AgentRuntimeEvent);
  }

  assert.ok(events.length >= 1, 'expected at least one event');
  const doneEvent = events.find((e) => e.type === 'done');
  assert.ok(doneEvent, 'expected a done event');
});
