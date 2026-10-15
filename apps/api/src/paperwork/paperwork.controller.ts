import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { FileTooLargeFilter } from './file-too-large.filter.js';
import { contentDisposition, PAPERWORK_MAX_BYTES } from './paperwork-file.js';
import { SearchPaperworkDto, UpdatePaperworkDto, UploadPaperworkDto } from './paperwork.dto.js';
import { PaperworkService, type IdCardFiles } from './paperwork.service.js';

// The employee file is HR and CEO only: both read it, only HR adds, adjusts, re-reads and deletes. National ID scans
// are restricted data on top of that: every view is written to the audit log (see PaperworkService).

// File names are read as UTF-8, so Arabic names arrive intact.
const ONE_FILE = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };
const ID_CARD = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 2, fields: 5 }, defParamCharset: 'utf8' };
// Photos of the national ID card: the front (required) and the back (optional).
export const ID_CARD_SIDES = FileFieldsInterceptor(
  [
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ],
  ID_CARD,
);

@Controller('employees')
export class EmployeePaperworkController {
  constructor(private readonly paperwork: PaperworkService) {}

  @Roles('hr', 'ceo')
  @Get(':id/paperwork')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.paperwork.list(id);
  }

  @Roles('hr')
  @Post(':id/paperwork')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadPaperworkDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.paperwork.upload(id, dto, file, user);
  }

  /**
   * Photos of a new employee's national ID card → suggestions for the Add employee form. Nothing is stored: the
   * photos go to the employee file once the employee is added. (POST only, so no clash with GET /employees/:id.)
   */
  @Roles('hr')
  @Post('read-id-card')
  @HttpCode(200)
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(ID_CARD_SIDES)
  readIdCard(@UploadedFiles() files: IdCardFiles) {
    return this.paperwork.readNewIdCard(files);
  }

  /** Photos of the national ID card (front required, back optional) → suggestions for the identity form. */
  @Roles('hr')
  @Post(':id/identity/scan')
  @HttpCode(200)
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(ID_CARD_SIDES)
  scan(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: IdCardFiles, @CurrentUser() user: SessionUser) {
    return this.paperwork.scanIdentity(id, files, user);
  }
}

@Controller('paperwork')
export class PaperworkController {
  constructor(private readonly paperwork: PaperworkService) {}

  @Roles('hr', 'ceo')
  @Get('search')
  search(@Query() dto: SearchPaperworkDto) {
    return this.paperwork.search(dto.q);
  }

  /**
   * A photo or a PDF → { pages: [{ image (base64 JPEG), width, height }] }, its pages in order, for cropping and
   * adjusting in the browser before it is uploaded (or in place of a stored file: PUT :itemId/file). Nothing is stored.
   */
  @Roles('hr')
  @Post('prepare')
  @HttpCode(200)
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  prepare(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.paperwork.preparePages(file);
  }

  @Roles('hr', 'ceo')
  @Get(':itemId/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async file(@Param('itemId', ParseUUIDPipe) itemId: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.paperwork.file(itemId, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
  }

  @Roles('hr', 'ceo')
  @Get(':itemId/text')
  @Header('Cache-Control', 'private, no-store')
  text(@Param('itemId', ParseUUIDPipe) itemId: string, @CurrentUser() user: SessionUser) {
    return this.paperwork.text(itemId, user);
  }

  /** A stored paper's file replaced by an adjusted one; its kind, number and expiry stay. Answers the paper as listed. */
  @Roles('hr')
  @Put(':itemId/file')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  replaceFile(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.paperwork.replaceFile(itemId, file, user);
  }

  @Roles('hr')
  @Post(':itemId/ocr')
  @HttpCode(200)
  reread(@Param('itemId', ParseUUIDPipe) itemId: string, @CurrentUser() user: SessionUser) {
    return this.paperwork.reread(itemId, user);
  }

  /** The number printed on a paper and when it expires. */
  @Roles('hr')
  @Patch(':itemId')
  describe(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdatePaperworkDto, @CurrentUser() user: SessionUser) {
    return this.paperwork.describe(itemId, dto, user);
  }

  @Roles('hr')
  @Delete(':itemId')
  @HttpCode(204)
  remove(@Param('itemId', ParseUUIDPipe) itemId: string, @CurrentUser() user: SessionUser) {
    return this.paperwork.remove(itemId, user);
  }
}
