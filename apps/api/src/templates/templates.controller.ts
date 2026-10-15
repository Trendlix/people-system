import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { UploadTemplateDto } from './templates.dto.js';
import { TemplatesService } from './templates.service.js';

// The template library (spec §8; owner's request, 15 October 2026: "Start working on the templates tab; I need to
// upload the templates"). HR, Admin and Super Admin manage it; the CEO views it and downloads the files; nobody else
// sees it. Only a Super Admin deletes, and only a draft (owner's decision, 15 October 2026). The tag dictionary is
// for everyone signed in.

// One Word file of up to 10 MB, as paperwork's; its name read as UTF-8, so Arabic names arrive intact.
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

  @Roles('hr', 'admin', 'ceo')
  @Get(':slot')
  slot(@Param('slot') slot: string) {
    return this.templates.slot(slot);
  }

  /** A new draft version: the .docx (`file`), its language when the slot has none, and a note. */
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
      // Preview: the file as uploaded, its {{tags}} as they are, shown in the browser
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
