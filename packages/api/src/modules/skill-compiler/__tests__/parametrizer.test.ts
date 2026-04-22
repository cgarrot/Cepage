import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode, GraphSnapshot } from '@cepage/shared-core';
import { ParametrizerService } from '../parametrizer/parametrizer.service.js';

function makeNode(
  id: string,
  type: string,
  content: Record<string, unknown>,
): GraphNode {
  return {
    id,
    type: type as GraphNode['type'],
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
    content: content as GraphNode['content'],
    creator: { type: 'human', userId: 'u1' } as GraphNode['creator'],
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 100 },
    metadata: {},
    status: 'idle' as GraphNode['status'],
    branches: [],
  };
}

function makeSnapshot(nodes: GraphNode[]): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1' as GraphSnapshot['id'],
    createdAt: '2026-04-22T10:00:00.000Z',
    nodes,
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('parameterize replaces hardcoded values with semantic placeholders', () => {
  const service = new ParametrizerService();
  const result = service.parameterize(
    makeSnapshot([
      makeNode('n1', 'agent_step', { text: 'Create Stripe integration with sk_live_abc123' }),
      makeNode('n2', 'file_edit', { content: 'const API_URL = "https://api.stripe.com";' }),
      makeNode('n3', 'agent_output', { text: 'Webhook endpoint: https://example.com/webhooks' }),
    ]),
  );

  assert.deepEqual(
    result.parameters.map((parameter) => parameter.name).sort(),
    ['api_base_url', 'payment_provider', 'stripe_api_key', 'webhook_url'],
  );
  assert.equal(result.graph.nodes[0]?.content.text, 'Create {{payment_provider}} integration with {{stripe_api_key}}');
  assert.equal(result.graph.nodes[1]?.content.content, 'const API_URL = "{{api_base_url}}";');
  assert.equal(result.graph.nodes[2]?.content.text, 'Webhook endpoint: {{webhook_url}}');
  assert.ok(!JSON.stringify(result.graph).includes('sk_live_abc123'));

  const secret = result.parameters.find((parameter) => parameter.name === 'stripe_api_key');
  assert.ok(secret);
  assert.equal(secret?.isSecret, true);
  assert.equal(secret?.inferredType, 'secret');
  assert.equal(secret?.originalValue, '[REDACTED]');
  assert.equal(secret?.suggestedDefault, '');
  assert.match(result.warnings.join('\n'), /stripe_api_key/);
});

test('parameterize detects emails and file paths without scanning nested objects', () => {
  const service = new ParametrizerService();
  const result = service.parameterize(
    makeSnapshot([
      makeNode('n1', 'agent_step', {
        text: 'Send updates to support@example.com and write report to /tmp/output/report.json',
        nested: { text: 'PayPal lives here: paypal@example.com' },
      }),
    ]),
  );

  assert.deepEqual(
    result.parameters.map((parameter) => parameter.name).sort(),
    ['output_file_path', 'support_email'],
  );
  assert.equal(
    result.graph.nodes[0]?.content.text,
    'Send updates to {{support_email}} and write report to {{output_file_path}}',
  );
  assert.deepEqual(result.graph.nodes[0]?.content.nested, { text: 'PayPal lives here: paypal@example.com' });
});

test('parameterize detects at least 80% of hardcoded values in representative sessions', () => {
  const service = new ParametrizerService();
  const expectedHardcodedValues = 5;
  const result = service.parameterize(
    makeSnapshot([
      makeNode('n1', 'agent_step', {
        text: 'Use GitHub with pk_publishable123 and notify dev@example.com',
      }),
      makeNode('n2', 'file_edit', {
        content: 'Fetch from https://api.github.com and save to /var/tmp/build.log',
      }),
      makeNode('n3', 'agent_output', {
        text: 'GitHub integration ready',
        details: { ignored: 'https://nested.example.com' },
      }),
    ]),
  );

  const detectionRate = result.parameters.length / expectedHardcodedValues;
  assert.ok(detectionRate >= 0.8, `expected >=80% detection, got ${(detectionRate * 100).toFixed(1)}%`);
  assert.ok(result.parameters.some((parameter) => parameter.name === 'github_api_key'));
  assert.ok(result.parameters.some((parameter) => parameter.name === 'api_base_url'));
  assert.ok(result.parameters.some((parameter) => parameter.name === 'notification_email'));
  assert.ok(result.parameters.some((parameter) => parameter.name === 'file_path'));
  assert.ok(result.parameters.some((parameter) => parameter.name === 'git_provider'));
});
