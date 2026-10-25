import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UploadedFile, UploadedFiles, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser, NotForDevelopers, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { wantsDownload } from '../pdf/pdf-file.js';
import { attachment } from '../templates/template-file.js';
import { CV_UPLOAD } from './cv-file.js';
import { CareersKeyGuard } from './careers-key.guard.js';
import { CvUploadFilter } from './cv-upload.filter.js';
import { CvUploadsService } from './cv-uploads.service.js';
import { GeneralCvsService } from './general-cvs.service.js';
import { CAREERS_FILES, CAREERS_UPLOAD, type CareersFiles } from './portfolio-file.js';
import { MANAGES, READS } from './recruitment-access.js';
import {
  AddGeneralCvDto,
  CvDiscardDto,
  CvSaveDto,
  CvUploadTargetDto,
  GeneralCvFormDto,
  GeneralCvNotesDto,
  ListGeneralCvsDto,
  MoveGeneralCvDto,
} from './recruitment.dto.js';

// General CVs and the bulk upload (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and
// what cam on randomly", "Both"; "is there a way to easy apply from linkedin?" … "why not"; packages/shared
// general-cvs.ts). HR, the CEO and a Super Admin read the general CVs and the Applicants page's summary; HR and a Super
// Admin add a CV, mark one reviewed, archive and restore it, note on it, move it to a vacancy, and upload CVs in bulk (to
// a vacancy, or to the general CVs). "Send us your CV" on the careers page is public. The CV itself is never opened by a
// developer (22 October 2026: the read-only Developer role).

@Controller('recruitment/general-cvs')
export class GeneralCvsController {
  constructor(private readonly cvs: GeneralCvsService) {}

  /** ?status= (a status or all; none: all but archived), ?source=, ?departmentId=, ?q=. */
  @Roles(...READS)
  @Get()
  list(@Query() query: ListGeneralCvsDto, @CurrentUser() user: SessionUser) {
    return this.cvs.list(query, user);
  }

  /** Add a CV (a multipart form: AddGeneralCvDto's fields, and the CV as `cv`). */
  @Roles(...MANAGES)
  @Post()
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileInterceptor('cv', CV_UPLOAD))
  add(@Body() dto: AddGeneralCvDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.cvs.add(dto, file, user);
  }

  @Roles(...READS)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.cvs.get(id, user);
  }

  /** The CV's text and the contacts found in it (22 October 2026); never for a developer (phones and emails). */
  @Roles(...READS)
  @NotForDevelopers()
  @Get(':id/cv-text')
  @Header('Cache-Control', 'private, no-store')
  cvText(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.cvs.cvText(id, user);
  }

  /** The CV as sent: shown in the browser (a PDF), or saved with ?download=1 (a Word file always). */
  @Roles(...READS)
  @NotForDevelopers()
  @Get(':id/cv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async cv(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.cvs.file(id, user);
    const save = wantsDownload(download) || file.mimeType !== 'application/pdf';
    return new StreamableFile(file.data, { type: file.mimeType, length: file.data.length, disposition: save ? attachment(file.fileName) : contentDisposition(file.fileName) });
  }

  /**
   * The CV as a PDF for the CV window (24 October 2026: "when opening a CV, open it in a popup window"): a PDF as sent, a
   * Word file converted and kept (409 in words without the converter). Never for a developer.
   */
  @Roles(...READS)
  @NotForDevelopers()
  @Get(':id/cv/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async cvPreview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.cvs.cvPreview(id, user);
    return new StreamableFile(file.data, { type: 'application/pdf', length: file.data.length, disposition: contentDisposition(file.fileName) });
  }

  @Roles(...MANAGES)
  @Post(':id/review')
  @HttpCode(200)
  review(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.cvs.setStatus(id, 'review', user);
  }

  @Roles(...MANAGES)
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.cvs.setStatus(id, 'archive', user);
  }

  @Roles(...MANAGES)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.cvs.setStatus(id, 'restore', user);
  }

  /** Gone (410) since HR's notes became screening comments (24 October 2026): POST /recruitment/comments instead. */
  @Roles(...MANAGES)
  @Patch(':id/notes')
  notes(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: GeneralCvNotesDto, @CurrentUser() user: SessionUser) {
    return this.cvs.notes(id, user);
  }

  /** Add to a vacancy: { vacancyId, stage: applied | shortlisted }. */
  @Roles(...MANAGES)
  @Post(':id/move')
  @HttpCode(200)
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveGeneralCvDto, @CurrentUser() user: SessionUser) {
    return this.cvs.move(id, dto, user);
  }
}

/** The Applicants page's summary: the tabs' counts, and each vacancy's applicants by stage and by source. */
@Controller('recruitment/applicants')
export class ApplicantsSummaryController {
  constructor(private readonly cvs: GeneralCvsService) {}

  @Roles(...READS)
  @Get('summary')
  summary(@CurrentUser() user: SessionUser) {
    return this.cvs.summary(user);
  }
}

/** The bulk upload of CVs: ?vacancyId= (none: the general CVs), one CV a request; the batch, its save and its discard. */
@Controller('recruitment/cv-uploads')
export class CvUploadsController {
  constructor(private readonly uploads: CvUploadsService) {}

  @Roles(...MANAGES)
  @Get()
  list(@Query() query: CvUploadTargetDto, @CurrentUser() user: SessionUser) {
    return this.uploads.list({ vacancyId: query.vacancyId ?? null }, user);
  }

  /** One CV of the batch (a multipart form with the CV as `cv`): read, its row guessed. */
  @Roles(...MANAGES)
  @Post()
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileInterceptor('cv', CV_UPLOAD))
  upload(@Query() query: CvUploadTargetDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.uploads.upload({ vacancyId: query.vacancyId ?? null }, file, user);
  }

  @Roles(...MANAGES)
  @Post('save')
  @HttpCode(200)
  save(@Body() dto: CvSaveDto, @CurrentUser() user: SessionUser) {
    return this.uploads.save({ vacancyId: dto.vacancyId ?? null }, Array.isArray(dto.rows) ? dto.rows : [], user);
  }

  @Roles(...MANAGES)
  @Post('discard')
  @HttpCode(200)
  discard(@Body() dto: CvDiscardDto, @CurrentUser() user: SessionUser) {
    return this.uploads.discard({ vacancyId: dto.vacancyId ?? null }, dto.id, user);
  }
}

/** "Send us your CV" on the careers page, without signing in. */
@Public()
@UseGuards(CareersKeyGuard)
@Controller('public/general-cvs')
export class PublicGeneralCvsController {
  constructor(private readonly cvs: GeneralCvsService) {}

  /** The company and the areas (departments) to choose from. */
  @Get('form')
  @Header('Cache-Control', 'no-store')
  form() {
    return this.cvs.publicForm();
  }

  /** A multipart form: GeneralCvFormDto's fields, the CV as `cv` and a PDF case study as `portfolioFile` (25 October 2026). */
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileFieldsInterceptor(CAREERS_FILES, CAREERS_UPLOAD))
  send(@Body() dto: GeneralCvFormDto, @UploadedFiles() files: CareersFiles, @Req() req: Request) {
    return this.cvs.send(dto, files?.cv?.[0], { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, headers: req.headers }, files?.portfolioFile?.[0]);
  }
}
