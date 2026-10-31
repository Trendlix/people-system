import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, NoFilesInterceptor } from '@nestjs/platform-express';
import { CreateEndingDto } from '../contracts/contracts.dto.js';
import { CurrentUser, NotForDevelopers } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { pdfFile, wantsDownload } from '../pdf/pdf-file.js';
import { PdfService } from '../pdf/pdf.service.js';
import { LETTER_UPLOAD, LetterUploadFilter, NO_LETTER, NoLetterFilter } from './letter.js';
import { CreateResignationRequestDto, ListResignationRequestsDto, ReturnResignationRequestDto } from './resignation-requests.dto.js';
import { ResignationRequestsService } from './resignation-requests.service.js';

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"; packages/shared resignation-request.ts). The employee's own: their requests with whether they
// may send one, a new request (JSON or a form, no file) and withdrawing one. Seeing and recording them: HR, the CEO and a
// Super Admin see all, a direct manager their reports' (each checked by the service, which tells anyone else a request
// isn't there); HR records one as an ending or returns it (a C-level person's: the CEO). The letter (owner, 31 October
// 2026: "on the resignation, the letter is auto generated, viewed by the employee but uploaded by the HR"): People's,
// filled in from the request, given as a protected PDF to the employee, HR and the CEO; the signed copy uploaded by HR
// (`letter`, replaceable) and opened by them too.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/resignation')
export class MyResignationController {
  constructor(private readonly requests: ResignationRequestsService) {}

  /** { requests, form }: theirs, newest first, and whether and how they may send one now. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.requests.mine(user);
  }

  /** { reason, preferredLastDay?, confirmed }, as JSON or a form; a file is refused: People prepares the letter. */
  @Post()
  @UseFilters(NoLetterFilter)
  @UseInterceptors(NoFilesInterceptor(NO_LETTER))
  create(@Body() dto: CreateResignationRequestDto, @CurrentUser() user: SessionUser) {
    return this.requests.create(dto, user);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.withdraw(id, user);
  }
}

@Controller('resignation-requests')
export class ResignationRequestsController {
  constructor(
    private readonly requests: ResignationRequestsService,
    private readonly pdf: PdfService,
  ) {}

  /** ?status=: HR, the CEO and a Super Admin everyone's; a direct manager their reports'. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListResignationRequestsDto, @CurrentUser() user: SessionUser) {
    return this.requests.list(query.status, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.one(id, user);
  }

  /** The signed letter HR uploaded (or the employee attached before 31 October 2026), shown in the browser. */
  @NotForDevelopers()
  @Get(':id/letter')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async letter(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.requests.letter(id, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
  }

  /** HR uploads the signed letter (`letter`: a PDF or a photo, up to 4 MB), or replaces it. Answers the request. */
  @Post(':id/letter')
  @HttpCode(200)
  @UseFilters(LetterUploadFilter)
  @UseInterceptors(FileInterceptor('letter', LETTER_UPLOAD))
  uploadLetter(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.requests.uploadLetter(id, file, user);
  }

  /**
   * The letter People prepares from the request, as a protected PDF to view and print, or saved with ?download=1. 409
   * while no Resignation request template is published, or without the server's PDF converter.
   */
  @NotForDevelopers()
  @Get(':id/generated-letter')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async generatedLetter(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.requests.generatedLetter(id, user);
    return pdfFile(await this.pdf.protectedFile(file), wantsDownload(download));
  }

  /** "Record the resignation": the End employment form's body ({ ruleKey: 'resignation', noticeGivenOn, certified…, reason?, note? }). Answers { request, ending }. */
  @Post(':id/record')
  @HttpCode(200)
  record(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEndingDto, @CurrentUser() user: SessionUser) {
    return this.requests.record(id, dto, user);
  }

  /** { reason }: a mistaken request, returned; the employee may send it again. */
  @Post(':id/return')
  @HttpCode(200)
  returnIt(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnResignationRequestDto, @CurrentUser() user: SessionUser) {
    return this.requests.returnIt(id, dto, user);
  }
}
