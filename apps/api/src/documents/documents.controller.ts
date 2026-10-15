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
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { contentDisposition, PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { PdfService } from '../pdf/pdf.service.js';
import { attachment, fileFormat } from '../templates/template-file.js';
import { CheckDocumentDto, GenerateDocumentDto } from './documents.dto.js';
import { DocumentsService } from './documents.service.js';

// The profile's Contracts tab: documents generated from the published templates (owner's request, 15 October 2026).
// HR and the CEO view the tab and download the files, like the employee file; only HR generates a document and moves
// it on (printed, signed copy uploaded, verified); only a Super Admin deletes one.

// One scan of up to 10 MB, as paperwork's; its name read as UTF-8, so Arabic names arrive intact.
const ONE_FILE = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };

@Controller('employees')
export class EmployeeDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** The Contracts tab: the documents offered, in sections, each with its generated copies (newest first). */
  @Roles('hr', 'ceo')
  @Get(':id/documents')
  tab(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.tab(id);
  }

  /** What a document's published template prints that has no value yet (?slotKey=&contractId=). */
  @Roles('hr')
  @Get(':id/documents/check')
  check(@Param('id', ParseUUIDPipe) id: string, @Query() query: CheckDocumentDto) {
    return this.documents.check(id, query);
  }

  @Roles('hr')
  @Post(':id/documents')
  generate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @CurrentUser() user: SessionUser) {
    return this.documents.generate(id, dto, user);
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
  ) {}

  /** The filled Word file, downloaded; ?format=pdf: the same as a PDF, shown in the browser (Preview). */
  @Roles('hr', 'ceo')
  @Get(':id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async file(@Param('id', ParseUUIDPipe) id: string, @Query('format') format: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const wanted = fileFormat(format);
    const file = await this.documents.file(id, user);
    if (wanted === 'pdf') {
      const { data, type, fileName } = await this.pdf.preview(file);
      return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
    }
    return new StreamableFile(file.data, { type: file.type, length: file.data.length, disposition: attachment(file.fileName) });
  }

  @Roles('hr')
  @Post(':id/printed')
  @HttpCode(200)
  printed(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.documents.printed(id, user);
  }

  /** The scan of the signed copy (`file`: a photo or a PDF). */
  @Roles('hr')
  @Post(':id/signed')
  @HttpCode(200)
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  signed(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.documents.signed(id, file, user);
  }

  /** The scan of the signed copy, shown in the browser (a photo or a PDF). */
  @Roles('hr', 'ceo')
  @Get(':id/signed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async signedFile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.documents.signedFile(id, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
  }

  @Roles('hr')
  @Post(':id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.documents.verify(id, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.documents.remove(id, user);
  }
}
