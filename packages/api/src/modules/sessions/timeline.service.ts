import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ok, type TimelineActor } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import {
  buildTimelinePage,
  buildTimelineWhere,
  clampTimelineLimit,
  readTimelineCursor,
} from './timeline.util';

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async list(sessionId: string, limitRaw?: number, before?: string, actorType?: TimelineActor, runId?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const cursor = readTimelineCursor(before);
    if (before && !cursor) {
      throw new BadRequestException('INVALID_TIMELINE_CURSOR');
    }
    const limit = clampTimelineLimit(limitRaw);
    const rows = await this.prisma.activityEntry.findMany({
      where: buildTimelineWhere({ sessionId, actorType, runId, cursor }),
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return ok(buildTimelinePage(rows, limit));
  }
}
