import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class SkillRunsRateLimitGuard implements CanActivate {
  private readonly windowMs = 60_000;
  private readonly limit: number;
  private readonly store = new Map<string, RateLimitEntry>();

  constructor() {
    const env = process.env.CEPAGE_SKILL_RUN_RATE_LIMIT;
    this.limit = env ? parseInt(env, 10) : 60;
    if (isNaN(this.limit) || this.limit < 1) {
      this.limit = 60;
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const slug = req.params?.slug || req.params?.skillId || '_';
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const key = `${slug}:${clientIp}`;
    const now = Date.now();

    let entry = this.store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
    }

    entry.count += 1;
    this.store.set(key, entry);

    const remaining = Math.max(0, this.limit - entry.count);
    const res = context.switchToHttp().getResponse();
    res.setHeader('X-RateLimit-Limit', String(this.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > this.limit) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
