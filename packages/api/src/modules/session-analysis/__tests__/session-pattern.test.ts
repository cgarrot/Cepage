import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionPatternService } from '../session-pattern.service.js';

function makeService(options?: {
  analyzedFingerprint?: string;
  sessions?: Array<{ id: string; metadata: unknown }>;
}) {
  return new SessionPatternService(
    {
      session: {
        async findMany(): Promise<Array<{ id: string; metadata: unknown }>> {
          return options?.sessions ?? [];
        },
      },
    } as never,
    {
      async analyze(): Promise<{ fingerprint: string; summary: { nodeCount: number; edgeCount: number; topParameters: string[] } }> {
        return {
          fingerprint: options?.analyzedFingerprint ?? 'aaaaaaaa',
          summary: { nodeCount: 0, edgeCount: 0, topParameters: [] },
        };
      },
    } as never,
  );
}

test('findSimilar ranks matching sessions by fingerprint similarity', async () => {
  const service = makeService({
    analyzedFingerprint: 'aaaaaaaa',
    sessions: [
      { id: 'session-1', metadata: { analysis: { fingerprint: 'aaaaaaaa' } } },
      { id: 'session-2', metadata: { analysis: { fingerprint: 'aaaaaaab' } } },
      { id: 'session-3', metadata: { analysis: { fingerprint: 'aaaabbaa' } } },
      { id: 'session-4', metadata: { analysis: { fingerprint: 'bbbbbbbb' } } },
      { id: 'session-5', metadata: {} },
    ],
  });

  const result = await service.findSimilar('session-1', 0.7);

  assert.deepEqual(result, [
    { sessionId: 'session-2', similarity: 0.875, fingerprint: 'aaaaaaab' },
    { sessionId: 'session-3', similarity: 0.75, fingerprint: 'aaaabbaa' },
  ]);
});

test('findSimilar treats extra fingerprint characters as differences', async () => {
  const service = makeService({
    analyzedFingerprint: 'abcd',
    sessions: [{ id: 'session-2', metadata: { analysis: { fingerprint: 'abcdff' } } }],
  });

  const result = await service.findSimilar('session-1', 0.6);

  assert.deepEqual(result, [{ sessionId: 'session-2', similarity: 1 - 2 / 6, fingerprint: 'abcdff' }]);
});

test('getPatternName returns known names for hardcoded fingerprint heuristics', () => {
  const service = makeService();

  assert.equal(service.getPatternName('c0ffee1234'), 'payment-integration');
  assert.equal(service.getPatternName('00face99'), 'auth-setup');
  assert.equal(service.getPatternName('cafe1234'), 'dockerization');
  assert.equal(service.getPatternName('12345678'), null);
});
