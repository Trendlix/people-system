import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SCREENING_LIMITS, SCREENING_VERDICTS, type ScreeningVerdict } from '@trendlix/shared';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { READS } from './recruitment-access.js';
import { ScreeningCommentsService } from './screening-comments.service.js';

// Screening comments (owner, 24 October 2026: "is there a way to add screening comments?", "and i can add genearrl
// comments"; "HR + hiring manager & interviewers"; packages/shared screening.ts). A candidate's and a general CV's
// comments are HR's, the CEO's and a Super Admin's; an applicant's are open to its hiring manager and interviewers too,
// the service answering as each may see them (404 otherwise). Writing follows reading; its author edits a comment for 24
// hours; only a Super Admin deletes one.

const L = SCREENING_LIMITS;

export class ScreeningCommentDto {
  /** About an application, a general CV, or (only this) the candidate in general: one of the three. */
  @IsOptional() @IsUUID('all', { message: 'Choose the application.' })
  applicationId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the general CV.' })
  generalCvId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the candidate.' })
  candidateId?: string;

  /** Checked by the service (screeningCommentProblems): written, at most 2,000 characters once trimmed. */
  @IsOptional() @IsString({ message: 'Write the comment.' }) @MaxLength(L.text + 200, { message: `Keep the comment to ${L.text.toLocaleString('en-US')} characters or fewer.` })
  comment?: string;

  /** None (null or left out): a comment without a verdict. */
  @IsOptional() @IsIn(SCREENING_VERDICTS, { message: 'Choose Good fit, Maybe or Not a fit, or no verdict.' })
  verdict?: ScreeningVerdict | null;

  /** The colleagues mentioned: their user ids, each someone who may read the comment. */
  @IsOptional() @IsArray() @ArrayMaxSize(L.mentions, { message: `Mention at most ${L.mentions} people in one comment.` }) @IsUUID('all', { each: true, message: 'Choose who to mention from the list.' })
  mentions?: string[];
}

export class EditScreeningCommentDto {
  @IsOptional() @IsString({ message: 'Write the comment.' }) @MaxLength(L.text + 200, { message: `Keep the comment to ${L.text.toLocaleString('en-US')} characters or fewer.` })
  comment?: string;

  /** null: the verdict taken off. */
  @IsOptional() @IsIn(SCREENING_VERDICTS, { message: 'Choose Good fit, Maybe or Not a fit, or no verdict.' })
  verdict?: ScreeningVerdict | null;

  @IsOptional() @IsArray() @ArrayMaxSize(L.mentions, { message: `Mention at most ${L.mentions} people in one comment.` }) @IsUUID('all', { each: true, message: 'Choose who to mention from the list.' })
  mentions?: string[];
}

@Controller('recruitment')
export class ScreeningCommentsController {
  constructor(private readonly comments: ScreeningCommentsService) {}

  /** A candidate's every comment, CV and target the caller sees. */
  @Roles(...READS)
  @Get('candidates/:id/comments')
  ofCandidate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.comments.forCandidate(id, user);
  }

  /** HR, the CEO, a Super Admin: their candidate's; the vacancy's hiring manager and the applicant's interviewers: the application's own. */
  @Get('applications/:id/comments')
  ofApplication(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.comments.forApplication(id, user);
  }

  @Roles(...READS)
  @Get('general-cvs/:id/comments')
  ofGeneralCv(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.comments.forGeneralCv(id, user);
  }

  /** { applicationId | generalCvId | candidateId, comment, verdict?, mentions? }. */
  @Post('comments')
  add(@Body() dto: ScreeningCommentDto, @CurrentUser() user: SessionUser) {
    return this.comments.add(dto, user);
  }

  /** { comment?, verdict? (null: none), mentions? }: its author, within 24 hours. */
  @Patch('comments/:id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditScreeningCommentDto, @CurrentUser() user: SessionUser) {
    return this.comments.edit(id, dto, user);
  }

  @DeletesRecords()
  @Delete('comments/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    await this.comments.remove(id, user);
  }
}
