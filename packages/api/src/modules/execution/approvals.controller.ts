import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApprovalService } from './approval.service';

@Controller('sessions/:sessionId/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get('pending')
  listPending(@Param('sessionId') sessionId: string) {
    return this.approvals.listPending(sessionId);
  }

  @Post(':approvalId/resolve')
  resolve(
    @Param('sessionId') sessionId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
  ) {
    const status = typeof (body as { status?: unknown } | null)?.status === 'string'
      ? ((body as { status: string }).status)
      : null;
    const summary = typeof (body as { summary?: unknown } | null)?.summary === 'string'
      ? ((body as { summary: string }).summary)
      : null;
    const resolvedByType = typeof (body as { resolvedByType?: unknown } | null)?.resolvedByType === 'string'
      ? ((body as { resolvedByType: string }).resolvedByType)
      : 'human';
    const resolvedById = typeof (body as { resolvedById?: unknown } | null)?.resolvedById === 'string'
      ? ((body as { resolvedById: string }).resolvedById)
      : 'operator';
    if (!status || (status !== 'approved' && status !== 'rejected' && status !== 'cancelled') || !summary) {
      throw new BadRequestException('APPROVAL_RESOLUTION_INVALID');
    }
    return this.approvals.resolve({
      sessionId,
      approvalId,
      status,
      summary,
      resolvedByType,
      resolvedById,
    });
  }
}
