import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { HiringBatchResult } from '@trendlix/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ApplicationsService } from './applications.service.js';
import { ReviewBatchDto, ShortlistBatchDto } from './hiring-steps.dto.js';
import { MANAGES } from './recruitment-access.js';

/**
 * The hiring steps' batches on a vacancy (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the
 * shortlisted and accept or reject them"; "Tick several at once", "One message per batch"): HR shortlists several of its
 * applicants at once, its hiring manager accepts or rejects several of the shortlist at once. Each answers what it did and
 * what it skipped, with why.
 */
@Controller('recruitment/vacancies')
export class HiringStepsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** { applicationIds }: those at Applied shortlisted (HR, a Super Admin); the hiring manager told once. */
  @Roles(...MANAGES)
  @Post(':id/shortlist')
  @HttpCode(200)
  shortlist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShortlistBatchDto, @CurrentUser() user: SessionUser): Promise<HiringBatchResult> {
    return this.applications.shortlistMany(id, dto.applicationIds, user);
  }

  /** { applicationIds, decision: next | reject, note }: the vacancy's hiring manager only (the service: 403 for anyone else); HR told once. */
  @Post(':id/review')
  @HttpCode(200)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewBatchDto, @CurrentUser() user: SessionUser): Promise<HiringBatchResult> {
    return this.applications.reviewMany(id, dto.applicationIds, dto.decision, dto.note, user);
  }
}
