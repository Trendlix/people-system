import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateEndingDto } from '../contracts/contracts.dto.js';
import { CurrentUser, NotForDevelopers } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { LETTER_UPLOAD, LetterUploadFilter } from './letter.js';
import { CreateResignationRequestDto, ListResignationRequestsDto, ReturnResignationRequestDto } from './resignation-requests.dto.js';
import { ResignationRequestsService } from './resignation-requests.service.js';

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"; packages/shared resignation-request.ts). The employee's own: their requests with whether they
// may send one, a new request (a form, the signed letter as `letter`) and withdrawing one. Seeing and recording them: HR,
// the CEO and a Super Admin see all, a direct manager their reports' (each checked by the service, which tells anyone
// else a request isn't there); HR records one as an ending or returns it (a C-level person's: the CEO).

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

  /** A form: reason, preferredLastDay?, confirmed, and the signed letter as `letter`. */
  @Post()
  @UseFilters(LetterUploadFilter)
  @UseInterceptors(FileInterceptor('letter', LETTER_UPLOAD))
  create(@Body() dto: CreateResignationRequestDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.requests.create(dto, file, user);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.withdraw(id, user);
  }
}

@Controller('resignation-requests')
export class ResignationRequestsController {
  constructor(private readonly requests: ResignationRequestsService) {}

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

  @NotForDevelopers()
  @Get(':id/letter')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async letter(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.requests.letter(id, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
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
