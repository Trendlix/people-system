import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { MANAGES, READS } from './recruitment-access.js';
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
}

@Controller('recruitment/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: VacancySuggestionsService) {}

  /** Add to this vacancy: the application made from the earlier CV, at Applied. */
  @Roles(...MANAGES)
  @Post(':id/add')
  @HttpCode(200)
  add(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.suggestions.add(id, user);
  }

  /** Invite to apply: the email with the job's apply link, sent now (HR confirmed on the page). */
  @Roles(...MANAGES)
  @Post(':id/invite')
  @HttpCode(200)
  invite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.suggestions.invite(id, user);
  }

  /** { reason }: optional. */
  @Roles(...MANAGES)
  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DismissSuggestionDto, @CurrentUser() user: SessionUser) {
    return this.suggestions.dismiss(id, dto.reason, user);
  }
}
