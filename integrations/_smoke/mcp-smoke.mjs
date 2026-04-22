#!/usr/bin/env node
// End-to-end smoke test for the Cepage MCP stdio server.
//
// 1. Boots a tiny mock Cepage HTTP server (no real DB / no Nest).
// 2. Spawns `@cepage/mcp` as a subprocess pointed at the mock.
// 3. Connects as an MCP client over stdio, calls `tools/list`, then
//    runs one tool and asserts the response.
//
// Run it from the repo root:
//
//   node integrations/_smoke/mcp-smoke.mjs
//
// Exit code 0 on success, non-zero on failure. Used in CI (see
// scripts/integrations-smoke.mjs) to keep the reference configs
// honest whenever the API surface changes.

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const mcpBin = path.resolve(repoRoot, 'packages/mcp/dist/bin/cepage-mcp.js');

const skillFixture = {
  id: 'smoke-test',
  title: 'Smoke Test',
  summary: 'No-op skill wired into the smoke harness.',
  kind: 'workflow_template',
  version: '1.0.0',
  inputsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      topic: { type: 'string', description: 'Arbitrary input string' },
    },
    required: ['topic'],
  },
  outputsSchema: {
    type: 'object',
    properties: {
      echoed: { type: 'string' },
    },
  },
};

async function startMockApi() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/v1/workflow-skills') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ skills: [skillFixture] }));
      return;
    }
    if (
      req.method === 'POST' &&
      url.pathname === `/api/v1/skills/${skillFixture.id}/runs`
    ) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = body ? JSON.parse(body) : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'run-smoke-1',
          skillId: skillFixture.id,
          skillVersion: skillFixture.version,
          skillKind: skillFixture.kind,
          status: 'succeeded',
          inputs: payload.inputs ?? {},
          outputs: { echoed: payload.inputs?.topic ?? null },
          error: null,
          sessionId: null,
          triggeredBy: payload.triggeredBy ?? 'mcp',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `no mock route: ${req.method} ${url.pathname}` }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function main() {
  const { server, url } = await startMockApi();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpBin, '--api', url],
    env: { ...process.env, CEPAGE_MCP_SKILL_FILTER: '' },
  });
  const client = new Client({ name: 'cepage-smoke', version: '0.0.0' });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    const expected = 'cepage_smoke_test';
    if (!names.includes(expected)) {
      throw new Error(
        `listTools missing "${expected}". Got: ${JSON.stringify(names)}`,
      );
    }

    const result = await client.callTool({
      name: expected,
      arguments: { topic: 'hello' },
    });
    if (result.isError) {
      throw new Error(`callTool reported an error: ${JSON.stringify(result)}`);
    }
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (!text.includes('hello')) {
      throw new Error(`callTool output is missing the echoed input. Got: ${text}`);
    }

    process.stdout.write('ok: Cepage MCP smoke test passed\n');
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  process.stderr.write(`fail: ${err?.stack ?? err}\n`);
  process.exit(1);
});
