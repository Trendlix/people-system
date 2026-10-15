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
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TEMPLATE_TAGS } from '@trendlix/shared';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { contentDisposition, PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { PdfService } from '../pdf/pdf.service.js';
import { attachment, fileFormat } from './template-file.js';
import { PdfFieldsDto, RenameTemplateVersionDto, UploadTemplateDto } from './templates.dto.js';
import { TemplatesService } from './templates.service.js';

// The template library (spec §8; owner's request, 15 October 2026: "Start working on the templates tab; I need to
// upload the templates"). HR, Admin and Super Admin manage it; the CEO views it and downloads the files; nobody else
// sees it. Only a Super Admin deletes, and only a draft (owner's decision, 15 October 2026). The tag dictionary, and
// the Fields Guide made from it, are for everyone signed in. A version is a Word template or a PDF form (owner's
// decision, 15 October 2026), on which HR and Admin place the fields; the CEO sees where they are.

// One Word file or PDF of up to 10 MB, as paperwork's; its name read as UTF-8, so Arabic names arrive intact.
const ONE_FILE = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly pdf: PdfService,
  ) {}

  @Roles('hr', 'admin', 'ceo')
  @Get()
  list() {
    return this.templates.list();
  }

  /** The tags a template may use (packages/shared TEMPLATE_TAGS), for the reference page. Before :slot. */
  @Get('tags')
  tags() {
    return TEMPLATE_TAGS;
  }

  /**
   * The Fields Guide (owner's request, 15 October 2026): how to use the tags, every tag by group and the library's
   * templates, as a Word file to download, or (?format=pdf) a PDF to open in the browser. Before :slot.
   */
  @Get('fields-guide')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async fieldsGuide(@Query('format') format?: string): Promise<StreamableFile> {
    const wanted = fileFormat(format);
    const guide = await this.templates.fieldsGuide();
    if (wanted === 'pdf') {
      // refused (409) without a PDF converter: the Word file can still be downloaded
      const { data, type, fileName } = await this.pdf.preview(guide);
      return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
    }
    return new StreamableFile(guide.data, { type: guide.type, length: guide.data.length, disposition: attachment(guide.fileName) });
  }

  @Roles('hr', 'admin', 'ceo')
  @Get(':slot')
  slot(@Param('slot') slot: string) {
    return this.templates.slot(slot);
  }

  /** A new draft version: the .docx or the PDF form (`file`), its language when the slot has none, and a note. */
  @Roles('hr', 'admin')
  @Post(':slot/versions')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  upload(
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadTemplateDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.templates.upload(slot, dto, file, user);
  }

  /** A version's file name, as the library shows it; ".docx" or ".pdf" is kept. Nothing else about the version changes. */
  @Roles('hr', 'admin')
  @Patch('versions/:id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameTemplateVersionDto, @CurrentUser() user: SessionUser) {
    return this.templates.rename(id, dto.fileName, user);
  }

  /** A PDF version's fields with its pages as shown: { version, pages, fields, editable }. 409 for a Word version. */
  @Roles('hr', 'admin', 'ceo')
  @Get('versions/:id/fields')
  fields(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.fields(id);
  }

  /** Saves all the fields of a PDF version (a draft or the one in use), as fields() answers them. */
  @Roles('hr', 'admin')
  @Put('versions/:id/fields')
  saveFields(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PdfFieldsDto, @CurrentUser() user: SessionUser) {
    return this.templates.saveFields(id, dto.fields, user);
  }

  /**
   * The PDF version filled in with made-up values where the fields sent (not saved) place them, shown in the browser.
   * Unprotected: it holds no one's data.
   */
  @Roles('hr', 'admin', 'ceo')
  @Post('versions/:id/fields/sample')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async sample(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PdfFieldsDto): Promise<StreamableFile> {
    const { data, fileName } = await this.templates.sample(id, dto.fields);
    return new StreamableFile(data, { type: 'application/pdf', length: data.length, disposition: contentDisposition(fileName) });
  }

  @Roles('hr', 'admin')
  @Post('versions/:id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.templates.publish(id, user);
  }

  @Roles('hr', 'admin', 'ceo')
  @Get('versions/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async file(@Param('id', ParseUUIDPipe) id: string, @Query('format') format?: string): Promise<StreamableFile> {
    const wanted = fileFormat(format);
    const file = await this.templates.file(id);
    if (wanted === 'pdf') {
      // Preview: the file as uploaded, its {{tags}} as they are, shown in the browser; a PDF form as it is (the editor
      // shows it)
      const { data, type, fileName } = await this.pdf.preview(file);
      return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
    }
    return new StreamableFile(file.data, { type: file.type, length: file.data.length, disposition: attachment(file.fileName) });
  }

  @DeletesRecords()
  @Delete('versions/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.templates.remove(id, user);
  }
}
