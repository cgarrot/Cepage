import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import {
  generateSecret,
  parseSignatureHeader,
  signPayload,
  verifySignature,
} from '../webhooks.signer.js';

test('signPayload produces a deterministic, parseable header', () => {
  const { header, timestamp, signature } = signPayload({
    secret: 'whsec_test',
    body: '{"hello":"world"}',
    timestamp: 1_700_000_000,
  });

  assert.equal(timestamp, 1_700_000_000);
  assert.equal(header, `v1,t=1700000000,sig=${signature}`);

  const parsed = parseSignatureHeader(header);
  assert.ok(parsed);
  assert.equal(parsed.scheme, 'v1');
  assert.equal(parsed.timestamp, 1_700_000_000);
  assert.equal(parsed.signature, signature);
});

test('parseSignatureHeader returns null on malformed input', () => {
  assert.equal(parseSignatureHeader(''), null);
  assert.equal(parseSignatureHeader(null), null);
  assert.equal(parseSignatureHeader('v2,t=1,sig=abc'), null);
  assert.equal(parseSignatureHeader('v1,t=notanumber,sig=abc'), null);
  assert.equal(parseSignatureHeader('v1,sig=abc'), null);
});

test('verifySignature accepts a well-formed signature within tolerance', () => {
  const secret = 'whsec_abc';
  const body = JSON.stringify({ runId: 'run_1' });
  const { header } = signPayload({ secret, body, timestamp: 1_700_000_000 });

  assert.equal(
    verifySignature({ secret, body, header, now: 1_700_000_299, toleranceSec: 300 }),
    true,
  );
  assert.equal(
    verifySignature({ secret, body, header, now: 1_700_001_000, toleranceSec: 300 }),
    false,
    'rejects deliveries outside the replay window',
  );
});

test('verifySignature rejects a tampered body and a wrong secret', () => {
  const body = JSON.stringify({ runId: 'run_1' });
  const { header } = signPayload({
    secret: 'correct',
    body,
    timestamp: 1_700_000_000,
  });

  assert.equal(
    verifySignature({
      secret: 'correct',
      body: body + ' ',
      header,
      now: 1_700_000_001,
    }),
    false,
  );
  assert.equal(
    verifySignature({
      secret: 'wrong',
      body,
      header,
      now: 1_700_000_001,
    }),
    false,
  );
});

test('verifySignature is compatible with an externally-computed signature', () => {
  // Third-party verifiers typically derive the expected signature exactly
  // like this snippet — confirming we match Stripe-style v1 semantics.
  const secret = 'whsec_external';
  const body = '{}';
  const timestamp = 1_700_000_000;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const header = `v1,t=${timestamp},sig=${expected}`;

  assert.equal(
    verifySignature({ secret, body, header, now: timestamp + 10, toleranceSec: 300 }),
    true,
  );
});

test('generateSecret produces high-entropy, URL-safe prefixed tokens', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.ok(a.startsWith('whsec_'));
  assert.ok(b.startsWith('whsec_'));
  assert.notEqual(a, b);
  assert.ok(a.length > 30);
  assert.match(a.slice('whsec_'.length), /^[A-Za-z0-9_-]+$/);
});
