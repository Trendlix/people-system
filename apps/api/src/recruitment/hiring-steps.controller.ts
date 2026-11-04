import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { HiringBatchResult } from '@trendlix/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ApplicationsService } from './applications.service.js';
import { DecideBatchDto, SendToReviewBatchDto } from './hiring-steps.dto.js';
import { MANAGES } from './recruitment-access.js';

/**
 * The batches on a vacancy (owner, 29 October 2026: "Tick several at once", "One message per batch"; the recruitment tree,
 * 3 November 2026): HR sends several of its applicants to Review 1 at once; whoever takes a step decides several at it
 * at once (the recruiter Review 1, the recruiter's manager Review 2, the hiring manager the Final Review, HR the rest).
 * Each answers what it did and what it skipped, with why.
 */
@Controller('recruitment/vacancies')
export class HiringStepsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** { applicationIds }: those at Applicants sent to Review 1 (HR, a Super Admin); the recruiter told once. */
  @Roles(...MANAGES)
  @Post(':id/send-to-review')
  @HttpCode(200)
  sendToReview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendToReviewBatchDto, @CurrentUser() user: SessionUser): Promise<HiringBatchResult> {
    return this.applications.sendToReviewMany(id, dto.applicationIds, user);
  }

  /** { applicationIds, stage, outcome, reasons, feedback }: whoever takes the step (the service: 403 for anyone else). */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideBatchDto, @CurrentUser() user: SessionUser): Promise<HiringBatchResult> {
    return this.applications.decideMany(id, dto.stage, dto.applicationIds, { outcome: dto.outcome, reasons: dto.reasons, feedback: dto.feedback }, user);
  }
}
