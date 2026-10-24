import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { RECRUITMENT_LIMITS, VERDICT_FILTERS, type VerdictFilter } from '@trendlix/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { Trim } from '../common/transforms.js';
import { CandidatesService } from './candidates.service.js';
import { MANAGES, READS } from './recruitment-access.js';

// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; "Email or mobile"; "Link and show rehire"; "HR decides
// from suggested match"; packages/shared candidates.ts). HR, the CEO and a Super Admin read the Candidates list, a
// profile and the possible matches; HR and a Super Admin merge two candidates, dismiss a pair ("Not the same person")
// and move an application to a new candidate; only a Super Admin undoes a merge. A hiring manager or an interviewer
// sees none of it (403). No file is answered here: a profile's CVs open from their application's or general CV's own
// routes, which refuse a developer.

export class CandidatesQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(100)
  q?: string;

  /** Only those with at least these years in one of their applications or general CVs: typed, else the CV's (24 October 2026). */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsNumber() @Min(0) @Max(RECRUITMENT_LIMITS.yearsExperience)
  minYears?: number;

  /** Only those whose latest screening verdict is this (across what the caller may read); `none`: none yet (24 October 2026). */
  @IsOptional() @IsIn(VERDICT_FILTERS, { message: 'Choose a verdict.' })
  verdict?: VerdictFilter;
}

export class MergeCandidatesDto {
  /** The candidate merged into the one in the address (that one is kept). */
  @IsUUID('all', { message: 'Choose the candidate to merge with.' })
  otherId!: string;
}

@Controller('recruitment/candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  /** ?q= (name, email, mobile, code, the CVs' text), ?minYears= (the years typed, else the CV's), ?verdict= (the latest screening verdict). */
  @Roles(...READS)
  @Get()
  list(@Query() query: CandidatesQueryDto, @CurrentUser() user: SessionUser) {
    return this.candidates.list(query, user);
  }

  /** The possible matches HR hasn't decided: the duplicates and the suggestions, strongest first. */
  @Roles(...READS)
  @Get('matches')
  matches(@CurrentUser() user: SessionUser) {
    return this.candidates.matches(user);
  }

  /** "Not the same person": the pair never suggested again. */
  @Roles(...MANAGES)
  @Post('matches/:matchId/dismiss')
  @HttpCode(200)
  dismiss(@Param('matchId', ParseUUIDPipe) matchId: string, @CurrentUser() user: SessionUser) {
    return this.candidates.dismiss(matchId, user);
  }

  /** A merge undone: a Super Admin only. */
  @Roles('super_admin')
  @Post('merges/:mergeId/undo')
  @HttpCode(200)
  undo(@Param('mergeId', ParseUUIDPipe) mergeId: string, @CurrentUser() user: SessionUser) {
    return this.candidates.undoMerge(mergeId, user);
  }

  /** "Move to a new candidate": the application split from its candidate. */
  @Roles(...MANAGES)
  @Post('split/:applicationId')
  @HttpCode(200)
  split(@Param('applicationId', ParseUUIDPipe) applicationId: string, @CurrentUser() user: SessionUser) {
    return this.candidates.split(applicationId, user);
  }

  @Roles(...READS)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.candidates.get(id, user);
  }

  /** "Merge with…": { otherId } merged into this one. */
  @Roles(...MANAGES)
  @Post(':id/merge')
  @HttpCode(200)
  merge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeCandidatesDto, @CurrentUser() user: SessionUser) {
    return this.candidates.merge(id, dto.otherId, user);
  }
}
