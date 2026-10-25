import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, StreamableFile, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser, DeletesRecords, NotForDevelopers, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { wantsDownload } from '../pdf/pdf-file.js';
import { attachment } from '../templates/template-file.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { ApplicationsService } from './applications.service.js';
import { InterviewsService } from './interviews.service.js';
import { RecruitmentAnalyticsService } from './recruitment-analytics.service.js';
import { RecruitmentSettingsService } from './recruitment-settings.service.js';
import { CvUploadFilter } from './cv-upload.filter.js';
import { CAREERS_FILES, CAREERS_UPLOAD, type CareersFiles } from './portfolio-file.js';
import { PublicCareersService } from './public-careers.service.js';
import { RecruitmentDeletesService } from './recruitment-deletes.service.js';
import { APPROVES, MANAGES, READS } from './recruitment-access.js';
import {
  AnalyticsQueryDto,
  ApplicationNotesDto,
  ApplyDto,
  CancelInterviewDto,
  FeedbackDto,
  InterviewDto,
  InterviewMeetingDto,
  InterviewOutcomeDto,
  RecruitmentSettingsDto,
  CvPositionChoicesDto,
  SuggestionDto,
  CreateVacancyDto,
  ListApplicationsDto,
  ListVacanciesDto,
  MoveApplicationDto,
  UpdateVacancyDto,
  VacancyReasonDto,
} from './recruitment.dto.js';
import { VacanciesService } from './vacancies.service.js';

// Recruitment, Phase 1 (owner, 22 October 2026: "where will we include the ATS?"; packages/shared recruitment.ts).
// Vacancies and applicants: HR, the CEO and a Super Admin read them (a C-level vacancy only the CEO and a Super Admin:
// the services answer 404); HR (and a Super Admin) drafts, changes, sends for approval, holds, reopens and closes
// vacancies and moves applicants; the CEO (and a Super Admin) approves or sends back a vacancy; only a Super Admin
// deletes one, since 25 October 2026 with its applications, and one applicant on their own (owner: "Vacancy alone -
// applicant alone - superadmin only"; recruitment-deletes.service.ts). The careers page's addresses are public
// (PublicCareersController).
// Phase 2 (owner, 22 October 2026; packages/shared recruitment-hiring.ts): a vacancy's page, its pipeline board and an
// applicant's page (and CV) are open to its hiring manager and the applicant's interviewers too, the services answering
// as each may see them (404 otherwise); interviews, scorecards, the hiring manager's suggestion, My Hiring, Recruitment
// Settings (the rejection email) and the analytics with their Excel.

@Controller('recruitment/vacancies')
export class VacanciesController {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly deletes: RecruitmentDeletesService,
  ) {}

  /** ?status= (a status, active: the default, or all) and ?q= (title, number, job title). */
  @Roles(...READS)
  @Get()
  list(@Query() query: ListVacanciesDto, @CurrentUser() user: SessionUser) {
    return this.vacancies.list(query, user);
  }

  @Roles(...MANAGES)
  @Post()
  create(@Body() dto: CreateVacancyDto, @CurrentUser() user: SessionUser) {
    return this.vacancies.create(dto, user);
  }

  /** HR, the CEO, a Super Admin; the vacancy's hiring manager without the salary range (the service: 404 for anyone else). */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.get(id, user);
  }

  @Roles(...MANAGES)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVacancyDto, @CurrentUser() user: SessionUser) {
    return this.vacancies.update(id, dto, user);
  }

  @Roles(...MANAGES)
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'submit', null, user);
  }

  @Roles(...APPROVES)
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'approve', null, user);
  }

  /** { reason }: required. */
  @Roles(...APPROVES)
  @Post(':id/send-back')
  @HttpCode(200)
  sendBack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VacancyReasonDto, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'send_back', dto.reason, user);
  }

  @Roles(...MANAGES)
  @Post(':id/hold')
  @HttpCode(200)
  hold(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'hold', null, user);
  }

  @Roles(...MANAGES)
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'reopen', null, user);
  }

  /** { reason }: optional. */
  @Roles(...MANAGES)
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VacancyReasonDto, @CurrentUser() user: SessionUser) {
    return this.vacancies.move(id, 'close', dto.reason, user);
  }

  /** What deleting it takes with it (its applications, the candidate profiles left with nothing), or why it stays: a Super Admin only. */
  @Roles('super_admin')
  @Get(':id/deletion')
  deletion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.deletes.vacancyDeletion(id, user);
  }

  /** ?confirm=: its number typed (VAC-2026-0001), needed once people applied (25 October 2026): their applications go with it. */
  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Query('confirm') confirm: string | undefined, @CurrentUser() user: SessionUser) {
    return this.vacancies.remove(id, typeof confirm === 'string' ? confirm : null, user);
  }
}

/** A vacancy's pipeline board: HR, the CEO, a Super Admin; its hiring manager from Shortlisted on (the service: 404 for anyone else). */
@Controller('recruitment/vacancies')
export class BoardController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get(':id/board')
  board(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.board(id, user);
  }
}

@Controller('recruitment/applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly interviews: InterviewsService,
    private readonly deletes: RecruitmentDeletesService,
  ) {}

  /** ?vacancyId=, ?stage=, ?minMatch=, ?minYears=, ?source=, ?filtered= (hide: the default, only, all), ?q=. */
  @Roles(...READS)
  @Get()
  list(@Query() query: ListApplicationsDto, @CurrentUser() user: SessionUser) {
    return this.applications.list(query, user);
  }

  /** HR, the CEO, a Super Admin; the vacancy's hiring manager and the applicant's interviewers (the service: 404 for anyone else). */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.get(id, user);
  }

  /**
   * The CV's text and the contacts found in it (22 October 2026: "make the OCR egine reads the CV and analyse it"), for
   * those who may open the applicant; never for a developer (phones and emails).
   */
  @NotForDevelopers()
  @Get(':id/cv-text')
  @Header('Cache-Control', 'private, no-store')
  cvText(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.cvText(id, user);
  }

  /**
   * The CV as a PDF for the CV window (24 October 2026: "when opening a CV, open it in a popup window"): a PDF as sent, a
   * Word file converted by the PDF service and kept (409 in words without one: downloaded instead). For those who may
   * open the applicant; never a developer.
   */
  @NotForDevelopers()
  @Get(':id/cv/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async cvPreview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.applications.cvPreview(id, user);
    return new StreamableFile(file.data, { type: 'application/pdf', length: file.data.length, disposition: contentDisposition(file.fileName) });
  }

  /** The CV as sent: shown in the browser, or saved with ?download=1. For those who may open the applicant. */
  @NotForDevelopers()
  @Get(':id/cv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async cv(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.applications.cv(id, user);
    // a Word file is always saved; a PDF is shown unless saving is asked for
    const save = wantsDownload(download) || file.mimeType !== 'application/pdf';
    return new StreamableFile(file.data, { type: file.mimeType, length: file.data.length, disposition: save ? attachment(file.fileName) : contentDisposition(file.fileName) });
  }

  /** { to: shortlisted | interview | rejected, reason } (a reason to reject). */
  @Roles(...MANAGES)
  @Post(':id/stage')
  @HttpCode(200)
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveApplicationDto, @CurrentUser() user: SessionUser) {
    return this.applications.move(id, dto.to, dto.reason, user, dto.email === true);
  }

  /** The vacancy's hiring manager suggests the next step or a rejection: { suggestion, note }. */
  @Post(':id/suggest')
  @HttpCode(200)
  suggest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SuggestionDto, @CurrentUser() user: SessionUser) {
    return this.applications.suggest(id, dto.suggestion, dto.note, user);
  }

  /** Schedules an interview (HR, a Super Admin): the candidate invited by email with the calendar invitation. */
  @Roles(...MANAGES)
  @Post(':id/interviews')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InterviewDto, @CurrentUser() user: SessionUser) {
    return this.interviews.schedule(id, dto, user);
  }

  @Roles(...MANAGES)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.restore(id, user);
  }

  /**
   * What deleting the applicant takes with it (interviews, comments, files, their candidate profile when nothing else is
   * left), or why they stay on record (owner, 25 October 2026: "Vacancy alone - applicant alone - superadmin only"): a
   * Super Admin only, never a developer.
   */
  @Roles('super_admin')
  @Get(':id/deletion')
  deletion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.deletes.applicationDeletion(id, user);
  }

  /** Deletes the applicant on their own (409 in words when hired, an offer was sent, or an interview is still to come). */
  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.deletes.removeApplication(id, user);
  }

  /** Gone (410) since HR's notes became screening comments (24 October 2026): POST /recruitment/comments instead. */
  @Roles(...MANAGES)
  @Patch(':id/notes')
  notes(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: ApplicationNotesDto, @CurrentUser() user: SessionUser) {
    return this.applications.notes(id, user);
  }
}

/** Interviews (Phase 2): the upcoming ones, changing one, its outcome and the interviewers' scorecards. */
@Controller('recruitment/interviews')
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  /** HR, the CEO, a Super Admin: the interviews to come. */
  @Roles(...READS)
  @Get()
  upcoming(@CurrentUser() user: SessionUser) {
    return this.interviews.upcoming(user);
  }

  @Roles(...MANAGES)
  @Put(':id')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InterviewDto, @CurrentUser() user: SessionUser) {
    return this.interviews.reschedule(id, dto, user);
  }

  @Roles(...MANAGES)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInterviewDto, @CurrentUser() user: SessionUser) {
    return this.interviews.cancel(id, dto.reason, user);
  }

  /**
   * An online interview still without its link (24 October 2026: its meeting refused): { meeting } to try again with a
   * choice, or { link } to paste one; then the candidate and the interviewers are told.
   */
  @Roles(...MANAGES)
  @Post(':id/meeting')
  @HttpCode(200)
  meeting(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InterviewMeetingDto, @CurrentUser() user: SessionUser) {
    return this.interviews.retryMeeting(id, dto, user);
  }

  /** { outcome: done | no_show }, once it has started. */
  @Roles(...MANAGES)
  @Post(':id/outcome')
  @HttpCode(200)
  outcome(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InterviewOutcomeDto, @CurrentUser() user: SessionUser) {
    return this.interviews.mark(id, dto.outcome, user);
  }

  /** An interviewer's scorecard (only theirs, once the interview has started). */
  @Put(':id/feedback')
  feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedbackDto, @CurrentUser() user: SessionUser) {
    return this.interviews.feedback(id, dto, user);
  }
}

/** My Hiring (Phase 2): what the signed-in person hires for or interviews; empty for anyone else. */
@Controller('recruitment/my-hiring')
export class MyHiringController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get()
  mine(@CurrentUser() user: SessionUser) {
    return this.interviews.myHiring(user);
  }
}

/** Recruitment Settings (Phase 2): the rejection email's words; HR, the CEO and a Super Admin read, HR and a Super Admin change. */
@Controller('recruitment/settings')
export class RecruitmentSettingsController {
  constructor(private readonly settings: RecruitmentSettingsService) {}

  @Roles(...READS)
  @Get()
  get() {
    return this.settings.get();
  }

  @Roles(...MANAGES)
  @Patch()
  update(@Body() dto: RecruitmentSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }

  /**
   * The positions on "Send us your CV" (owner, 25 October 2026: "Position, grouped by team"): every one, hidden ones too,
   * and the teams HR's lists filter by. HR, the CEO and a Super Admin read (HR's Add a CV and the bulk upload too).
   */
  @Roles(...READS)
  @Get('positions')
  positions() {
    return this.settings.positions();
  }

  /** HR's choices for them: each shown or hidden, and a public name; HR and a Super Admin, audited. */
  @Roles(...MANAGES)
  @Put('positions')
  savePositions(@Body() dto: CvPositionChoicesDto, @CurrentUser() user: SessionUser) {
    return this.settings.savePositions(dto, user);
  }
}

/** Recruitment Analytics (Phase 2): ?year= and ?departmentId=; HR, the CEO and a Super Admin; the Excel audited. */
@Controller('recruitment/analytics')
export class RecruitmentAnalyticsController {
  constructor(private readonly analytics: RecruitmentAnalyticsService) {}

  @Roles(...READS)
  @Get()
  get(@Query() query: AnalyticsQueryDto, @CurrentUser() user: SessionUser) {
    return this.analytics.analytics(query, user);
  }

  @Roles(...READS)
  @NotForDevelopers()
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query() query: AnalyticsQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.analytics.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}

/** The careers page, without signing in. */
@Public()
@Controller('public/careers')
export class PublicCareersController {
  constructor(private readonly careers: PublicCareersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.careers.list();
  }

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  get(@Param('slug') slug: string) {
    return this.careers.get(slug);
  }

  /** A multipart form: the fields of ApplyDto, the CV as `cv` and a PDF case study as `portfolioFile` (25 October 2026). */
  @Post(':slug/apply')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileFieldsInterceptor(CAREERS_FILES, CAREERS_UPLOAD))
  apply(@Param('slug') slug: string, @Body() dto: ApplyDto, @UploadedFiles() files: CareersFiles, @Req() req: Request) {
    return this.careers.apply(slug, dto, files?.cv?.[0], { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, headers: req.headers }, files?.portfolioFile?.[0]);
  }
}
