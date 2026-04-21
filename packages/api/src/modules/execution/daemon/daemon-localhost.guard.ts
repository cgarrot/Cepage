import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

const LOCALHOST_PREFIXES = ['127.', '::1', '::ffff:127.', '0:0:0:0:0:0:0:1'];
const IPV4_MAPPED_PREFIX = '::ffff:';

type Cidr = { network: number; mask: number; prefix: number };

function isLoopback(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === 'localhost') return true;
  return LOCALHOST_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function normalizeIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  // Express may report IPv4-mapped IPv6 (`::ffff:172.27.0.1`); strip prefix so we can CIDR-match.
  const stripped = lower.startsWith(IPV4_MAPPED_PREFIX) ? lower.slice(IPV4_MAPPED_PREFIX.length) : lower;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(stripped) ? stripped : null;
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    // Use unsigned shift so the final value stays in the 32-bit unsigned range.
    result = (result * 256 + n) >>> 0;
  }
  return result;
}

function parseCidr(entry: string): Cidr | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const [addr, prefixRaw] = trimmed.includes('/') ? trimmed.split('/') : [trimmed, '32'];
  const network = ipv4ToInt(addr);
  const prefix = Number(prefixRaw);
  if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }
  // Compute the network address by masking off the host bits, again as unsigned 32-bit.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (network & mask) >>> 0, mask, prefix };
}

function parseTrustedPeerCidrs(raw: string | undefined): Cidr[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => parseCidr(entry))
    .filter((cidr): cidr is Cidr => cidr !== null);
}

@Injectable()
export class DaemonLocalhostGuard implements CanActivate {
  private readonly trustedCidrs: Cidr[];

  constructor() {
    // Read once at construction; guard instances are singletons and the env var is process-wide.
    // Operators set this when the API is reachable from a non-loopback peer (e.g. native daemon
    // hitting a Dockerized API across the bridge network) without enabling auth.
    this.trustedCidrs = parseTrustedPeerCidrs(process.env.DAEMON_TRUSTED_PEER_CIDRS);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? undefined;
    if (!ip) {
      throw new ForbiddenException('DAEMON_ACCESS_DENIED');
    }
    if (isLoopback(ip)) return true;
    if (this.matchesTrustedCidr(ip)) return true;
    throw new ForbiddenException('DAEMON_ACCESS_DENIED');
  }

  private matchesTrustedCidr(address: string): boolean {
    if (this.trustedCidrs.length === 0) return false;
    const ipv4 = normalizeIpv4(address);
    if (!ipv4) return false;
    const value = ipv4ToInt(ipv4);
    if (value === null) return false;
    return this.trustedCidrs.some((cidr) => ((value & cidr.mask) >>> 0) === cidr.network);
  }
}
