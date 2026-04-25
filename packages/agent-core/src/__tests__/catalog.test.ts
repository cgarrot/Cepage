import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { cursorAgentSpawnEnv, parseCursorModelsOutput, resolveCursorAgentBin } from '../cursor-agent.js';
import { buildOpenCodeBaseUrl, parseOpenCodeModelsOutput } from '../opencode-run.js';
import { listAgentAdapters } from '../registry.js';

test('listAgentAdapters exposes opencode, cursor agent, and claude code adapters', () => {
  assert.deepEqual(
    listAgentAdapters().map((adapter) => adapter.type),
    ['opencode', 'cursor_agent', 'claude_code'],
  );
});

test('parseCursorModelsOutput groups models by provider family', () => {
  const providers = parseCursorModelsOutput(`
Loading models…

Available models

composer-2-fast - Composer 2 Fast  (current, default)
gpt-5.4-medium - GPT-5.4
claude-4.5-sonnet-thinking - Sonnet 4.5 Thinking
gemini-3.1-pro - Gemini 3.1 Pro

Tip: use --model <id> to switch.
`);

  const cursor = providers.find((provider) => provider.providerID === 'cursor');
  const openai = providers.find((provider) => provider.providerID === 'openai');
  const anthropic = providers.find((provider) => provider.providerID === 'anthropic');
  const google = providers.find((provider) => provider.providerID === 'google');

  assert.ok(cursor);
  assert.ok(openai);
  assert.ok(anthropic);
  assert.ok(google);
  assert.equal(cursor.models[0]?.modelID, 'composer-2-fast');
  assert.equal(cursor.models[0]?.isDefault, true);
  assert.equal(cursor.models[0]?.label, 'composer-2-fast');
  assert.equal(cursor.models[0]?.description, 'Composer 2 Fast');
  assert.equal(openai.models[0]?.modelID, 'gpt-5.4-medium');
  assert.equal(openai.models[0]?.label, 'gpt-5.4-medium');
  assert.equal(openai.models[0]?.description, 'GPT-5.4');
  assert.equal(anthropic.models[0]?.modelID, 'claude-4.5-sonnet-thinking');
  assert.equal(google.models[0]?.modelID, 'gemini-3.1-pro');
});

test('resolveCursorAgentBin uses env override else cursor-agent', () => {
  assert.equal(resolveCursorAgentBin({ env: { CURSOR_AGENT_BIN: '/tmp/custom-cursor-agent' } }), '/tmp/custom-cursor-agent');
  assert.equal(resolveCursorAgentBin({ env: {} }), 'cursor-agent');
});

test('cursorAgentSpawnEnv prepends user bin dirs without duplicating PATH entries', () => {
  const home = '/Users/tester';
  const base = { HOME: home, PATH: '/usr/bin' } as NodeJS.ProcessEnv;
  const withHome = cursorAgentSpawnEnv(base);
  const head = `${home}/.local/bin${path.delimiter}${home}/bin${path.delimiter}/opt/homebrew/bin${path.delimiter}/usr/local/bin`;
  assert.ok(withHome.PATH?.startsWith(head));
  const again = cursorAgentSpawnEnv(withHome);
  assert.equal(again.PATH, withHome.PATH);
});

test('cursorAgentSpawnEnv still prepends ~/.local/bin when PATH already has homebrew', () => {
  const home = '/Users/tester';
  const base = {
    HOME: home,
    PATH: `/opt/homebrew/bin${path.delimiter}/usr/bin`,
  } as NodeJS.ProcessEnv;
  const env = cursorAgentSpawnEnv(base);
  const expectPrefix = `${home}/.local/bin${path.delimiter}${home}/bin${path.delimiter}/usr/local/bin${path.delimiter}`;
  assert.ok(env.PATH?.startsWith(expectPrefix));
  assert.ok(env.PATH?.includes(`/opt/homebrew/bin${path.delimiter}`));
});

test('parseOpenCodeModelsOutput groups command output by provider', () => {
  const providers = parseOpenCodeModelsOutput(`
openai/gpt-5.4
openai/gpt-5.4-mini
minimax-coding-plan/MiniMax-M2.5
`);

  assert.deepEqual(
    providers.map((provider) => ({
      agentType: provider.agentType,
      providerID: provider.providerID,
      label: provider.label,
      models: provider.models.map((model: (typeof provider.models)[number]) => ({
        providerID: model.providerID,
        modelID: model.modelID,
        label: model.label,
      })),
    })),
    [
      {
        agentType: 'opencode',
        providerID: 'minimax-coding-plan',
        label: 'Minimax Coding Plan',
        models: [
          {
            providerID: 'minimax-coding-plan',
            modelID: 'MiniMax-M2.5',
            label: 'minimax-coding-plan/MiniMax-M2.5',
          },
        ],
      },
      {
        agentType: 'opencode',
        providerID: 'openai',
        label: 'OpenAI',
        models: [
          {
            providerID: 'openai',
            modelID: 'gpt-5.4',
            label: 'openai/gpt-5.4',
          },
          {
            providerID: 'openai',
            modelID: 'gpt-5.4-mini',
            label: 'openai/gpt-5.4-mini',
          },
        ],
      },
    ],
  );
});

test('buildOpenCodeBaseUrl only emits a URL for a real configured connection', () => {
  assert.equal(buildOpenCodeBaseUrl({}), null);
  assert.equal(buildOpenCodeBaseUrl({ port: 3939 }), 'http://127.0.0.1:3939/');
  assert.equal(buildOpenCodeBaseUrl({ hostname: 'localhost' }), 'http://localhost:4096/');
  assert.equal(buildOpenCodeBaseUrl({ port: Number.NaN }), null);
});
