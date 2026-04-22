import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  parseWebhookSignatureHeader,
  verifyWebhookSignature,
} from '../src/signature.js';

// Keep the reference signature in Node's crypto so the test exercises
// the real cross-runtime path (WebCrypto HMAC inside the SDK vs
// node:crypto on the server). If the two diverge this test fails
// loudly — that would be a correctness bug since the server signs
// using node:crypto.

function sign(secret: string, timestamp: number, body: string): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `v1,t=${timestamp},sig=${sig}`;
}

test('parseWebhookSignatureHeader parses the canonical format', () => {
  const parsed = parseWebhookSignatureHeader('v1,t=1700000000,sig=deadbeef');
  assert.ok(parsed);
  assert.equal(parsed.scheme, 'v1');
  assert.equal(parsed.timestamp, 1700000000);
  assert.equal(parsed.signature, 'deadbeef');
});

test('parseWebhookSignatureHeader returns null for malformed input', () => {
  assert.equal(parseWebhookSignatureHeader(null), null);
  assert.equal(parseWebhookSignatureHeader(''), null);
  assert.equal(parseWebhookSignatureHeader('v1,t=xxx,sig=abc'), null);
  assert.equal(parseWebhookSignatureHeader('t=1,sig=abc'), null);
});

test('verifyWebhookSignature accepts a valid node:crypto signature', async () => {
  const secret = 'whsec_verify_me';
  const ts = 1_700_000_000;
  const body = JSON.stringify({ event: 'skill_run.completed', data: { id: 'r_1' } });
  const header = sign(secret, ts, body);
  const ok = await verifyWebhookSignature({
    secret,
    body,
    header,
    now: ts + 10,
  });
  assert.equal(ok, true);
});

test('verifyWebhookSignature rejects stale timestamps', async () => {
  const secret = 'whsec_stale';
  const ts = 1_700_000_000;
  const body = 'payload';
  const header = sign(secret, ts, body);
  const ok = await verifyWebhookSignature({
    secret,
    body,
    header,
    now: ts + 10_000,
    toleranceSec: 60,
  });
  assert.equal(ok, false);
});

test('verifyWebhookSignature rejects tampered payloads', async () => {
  const secret = 'whsec_tamper';
  const ts = 1_700_000_000;
  const header = sign(secret, ts, 'original');
  const ok = await verifyWebhookSignature({
    secret,
    body: 'tampered',
    header,
    now: ts,
  });
  assert.equal(ok, false);
});

test('verifyWebhookSignature rejects the wrong secret', async () => {
  const ts = 1_700_000_000;
  const header = sign('right_secret', ts, 'payload');
  const ok = await verifyWebhookSignature({
    secret: 'wrong_secret',
    body: 'payload',
    header,
    now: ts,
  });
  assert.equal(ok, false);
});
