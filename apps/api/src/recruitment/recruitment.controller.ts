import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser, DeletesRecords, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { wantsDownload } from '../pdf/pdf-file.js';
import { attachment } from '../templates/template-file.js';
import { ApplicationsService } from './applications.service.js';
import { CV_UPLOAD } from './cv-file.js';
import { CvUploadFilter } from './cv-upload.filter.js';
import { PublicCareersService } from './public-careers.service.js';
import { APPROVES, MANAGES, READS } from './recruitment-access.js';
import {
  ApplicationNotesDto,
  ApplyDto,
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
// deletes one, nobody having applied. The careers page's addresses are public (PublicCareersController).

@Controller('recruitment/vacancies')
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

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

  @Roles(...READS)
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

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.vacancies.remove(id, user);
  }
}

@Controller('recruitment/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** ?vacancyId=, ?stage=, ?minMatch=, ?minYears=, ?source=, ?filtered= (hide: the default, only, all), ?q=. */
  @Roles(...READS)
  @Get()
  list(@Query() query: ListApplicationsDto, @CurrentUser() user: SessionUser) {
    return this.applications.list(query, user);
  }

  @Roles(...READS)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.get(id, user);
  }

  /** The CV as sent: shown in the browser, or saved with ?download=1. */
  @Roles(...READS)
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
    return this.applications.move(id, dto.to, dto.reason, user);
  }

  @Roles(...MANAGES)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.applications.restore(id, user);
  }

  @Roles(...MANAGES)
  @Patch(':id/notes')
  notes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplicationNotesDto, @CurrentUser() user: SessionUser) {
    return this.applications.notes(id, dto.notes, user);
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

  /** A multipart form: the fields of ApplyDto, and the CV as `cv`. */
  @Post(':slug/apply')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileInterceptor('cv', CV_UPLOAD))
  apply(@Param('slug') slug: string, @Body() dto: ApplyDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.careers.apply(slug, dto, file, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, headers: req.headers });
  }
}
