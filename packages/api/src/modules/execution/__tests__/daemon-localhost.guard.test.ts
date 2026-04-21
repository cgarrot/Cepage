import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { DaemonLocalhostGuard } from '../daemon/daemon-localhost.guard.js';

function buildContext(request: Partial<{ ip?: string; remoteAddress?: string }>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: request.ip,
        socket: { remoteAddress: request.remoteAddress },
      }),
    }),
  } as never;
}

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.DAEMON_TRUSTED_PEER_CIDRS;
  if (value === undefined) {
    delete process.env.DAEMON_TRUSTED_PEER_CIDRS;
  } else {
    process.env.DAEMON_TRUSTED_PEER_CIDRS = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.DAEMON_TRUSTED_PEER_CIDRS;
    } else {
      process.env.DAEMON_TRUSTED_PEER_CIDRS = previous;
    }
  }
}

test('DaemonLocalhostGuard accepts loopback IPv4', () => {
  const guard = new DaemonLocalhostGuard();
  assert.equal(guard.canActivate(buildContext({ ip: '127.0.0.1' })), true);
});

test('DaemonLocalhostGuard accepts IPv6 loopback', () => {
  const guard = new DaemonLocalhostGuard();
  assert.equal(guard.canActivate(buildContext({ ip: '::1' })), true);
});

test('DaemonLocalhostGuard accepts IPv4-mapped IPv6 loopback', () => {
  const guard = new DaemonLocalhostGuard();
  assert.equal(guard.canActivate(buildContext({ ip: '::ffff:127.0.0.1' })), true);
});

test('DaemonLocalhostGuard falls back to socket remoteAddress', () => {
  const guard = new DaemonLocalhostGuard();
  assert.equal(
    guard.canActivate(buildContext({ ip: undefined, remoteAddress: '127.0.0.1' })),
    true,
  );
});

test('DaemonLocalhostGuard rejects external IPs without trust list', () => {
  const guard = new DaemonLocalhostGuard();
  assert.throws(
    () => guard.canActivate(buildContext({ ip: '10.0.0.5' })),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('DaemonLocalhostGuard accepts peers within DAEMON_TRUSTED_PEER_CIDRS', () => {
  withEnv('172.16.0.0/12,10.0.0.0/8', () => {
    const guard = new DaemonLocalhostGuard();
    assert.equal(guard.canActivate(buildContext({ ip: '172.27.0.1' })), true);
    assert.equal(guard.canActivate(buildContext({ ip: '10.5.6.7' })), true);
  });
});

test('DaemonLocalhostGuard accepts IPv4-mapped peers within trusted CIDRs', () => {
  withEnv('172.16.0.0/12', () => {
    const guard = new DaemonLocalhostGuard();
    assert.equal(guard.canActivate(buildContext({ ip: '::ffff:172.27.0.1' })), true);
  });
});

test('DaemonLocalhostGuard rejects peers outside trusted CIDRs', () => {
  withEnv('172.16.0.0/12', () => {
    const guard = new DaemonLocalhostGuard();
    assert.throws(
      () => guard.canActivate(buildContext({ ip: '8.8.8.8' })),
      (error: unknown) => error instanceof ForbiddenException,
    );
  });
});

test('DaemonLocalhostGuard ignores malformed CIDR entries', () => {
  withEnv('not-a-cidr,172.16.0.0/12', () => {
    const guard = new DaemonLocalhostGuard();
    assert.equal(guard.canActivate(buildContext({ ip: '172.27.0.1' })), true);
    assert.throws(
      () => guard.canActivate(buildContext({ ip: '8.8.8.8' })),
      (error: unknown) => error instanceof ForbiddenException,
    );
  });
});
