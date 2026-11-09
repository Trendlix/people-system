import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { HiringBatchResult } from '@trendlix/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ApplicationsService } from './applications.service.js';
import { DecideBatchDto } from './hiring-steps.dto.js';

/**
 * The batches on a vacancy (owner, 29 October 2026: "Tick several at once", "One message per batch"; the recruitment tree,
 * 3 November 2026; 9 November 2026): whoever takes a step decides several at it at once (the recruiter Applicants, the
 * hiring manager the Final Review and the Technical Interview, HR HR Screening).
 * Each answers what it did and what it skipped, with why.
 */
@Controller('recruitment/vacancies')
export class HiringStepsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** { applicationIds, stage, outcome, reasons, feedback }: whoever takes the step (the service: 403 for anyone else). */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideBatchDto, @CurrentUser() user: SessionUser): Promise<HiringBatchResult> {
    return this.applications.decideMany(id, dto.stage, dto.applicationIds, { outcome: dto.outcome, reasons: dto.reasons, feedback: dto.feedback }, user);
  }
}
