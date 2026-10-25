import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { suggestKeySkills } from '@trendlix/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddRecommendedDto, SuggestKeySkillsDto } from './cv-fit.dto.js';
import { DECIDES_SUGGESTIONS, MANAGES, READS } from './recruitment-access.js';
import { DismissSuggestionDto, ListSuggestionsDto } from './recruitment.dto.js';
import { VacancySuggestionsService } from './vacancy-suggestions.service.js';

// Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds", "General CVs + past applicants", "Yes, HR
// presses 'Invite to apply'"; packages/shared suggested-cvs.ts): a vacancy's list, for HR, the CEO and a Super Admin
// (never its hiring manager); HR and a Super Admin add one to the vacancy, invite one to apply by email, or dismiss one.

@Controller('recruitment/vacancies')
export class VacancySuggestionsController {
  constructor(private readonly suggestions: VacancySuggestionsService) {}

  /** ?status= (suggested, invited, added, applied, dismissed; suggested unless asked). */
  @Roles(...READS)
  @Get(':id/suggestions')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListSuggestionsDto, @CurrentUser() user: SessionUser) {
    return this.suggestions.list(id, query.status, user);
  }

  /**
   * Add to this vacancy from an applicant's or a general CV's Other Open Positions (owner, 25 October 2026: "and if it
   * recomended to another position based on the CV"): { applicationId } or { generalCvId }, through the suggestions' add.
   */
  @Roles(...DECIDES_SUGGESTIONS)
  @Post(':id/recommended/add')
  @HttpCode(200)
  addRecommended(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddRecommendedDto, @CurrentUser() user: SessionUser) {
    return this.suggestions.addRecommended(id, dto, user);
  }
}

/**
 * Key skills suggested from a vacancy's title and texts (owner, 25 October 2026: "when a vacancy has no key skills,
 * suggest them from its description for HR to confirm"; packages/shared cv-fit.ts suggestKeySkills): for the vacancy
 * form, which shows them as chips HR keeps, removes or adds to; nothing is saved here.
 */
@Controller('recruitment/key-skills')
export class KeySkillsController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(...MANAGES)
  @Post('suggest')
  @HttpCode(200)
  async suggest(@Body() dto: SuggestKeySkillsDto): Promise<{ skills: string[] }> {
    const job = dto.jobTitleId ? await this.prisma.jobTitle.findUnique({ where: { id: dto.jobTitleId }, select: { titleEn: true } }) : null;
    return { skills: suggestKeySkills({ title: dto.title, jobTitle: job?.titleEn ?? null, requirements: dto.requirements, responsibilities: dto.responsibilities, about: dto.about }) };
  }
}

@Controller('recruitment/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: VacancySuggestionsService) {}

  /** Add to this vacancy: the application made from the earlier CV, at Applied. */
  @Roles(...DECIDES_SUGGESTIONS)
  @Post(':id/add')
  @HttpCode(200)
  add(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.suggestions.add(id, user);
  }

  /** Invite to apply: the email with the job's apply link, sent now (HR confirmed on the page). */
  @Roles(...DECIDES_SUGGESTIONS)
  @Post(':id/invite')
  @HttpCode(200)
  invite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.suggestions.invite(id, user);
  }

  /** { reason }: optional. */
  @Roles(...DECIDES_SUGGESTIONS)
  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DismissSuggestionDto, @CurrentUser() user: SessionUser) {
    return this.suggestions.dismiss(id, dto.reason, user);
  }
}
