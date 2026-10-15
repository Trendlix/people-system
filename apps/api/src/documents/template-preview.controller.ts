import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { attachment, fileFormat, type FileFormat } from '../templates/template-file.js';
import { TemplatePreviewService } from './template-preview.service.js';

// A template version previewed with a real employee's data (owner's request, 15 October 2026), beside the Preview of
// the file as uploaded (GET /templates/versions/:id/file): for HR, Admin and the CEO, who see the template library.
// A job offer template is previewed with a job offer's data, while there is one of its employment type. Restricted
// data prints only for those who may see it.

/** ?format= read: a PDF to show unless the Word file is asked for. */
const previewFormat = (format: string | undefined): FileFormat => (format === undefined || format === '' ? 'pdf' : fileFormat(format));

@Controller('templates')
export class TemplatePreviewController {
  constructor(private readonly preview: TemplatePreviewService) {}

  /**
   * Up to 50 people to preview the version with, those with the most of its tags filled in first: { kind: 'employee', … };
   * for a job offer template, the newest 50 offers of its employment type ({ kind: 'offer', … }), or the people while
   * there is none.
   */
  @Roles('hr', 'admin', 'ceo')
  @Get('versions/:id/preview-people')
  people(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.preview.people(id, user);
  }

  /**
   * The version filled in for ?employeeId= or (a job offer template) ?offerId=, else the first of preview-people, as a
   * PDF shown in the browser, or (?format=docx) the Word file to download. X-Preview-Employee or X-Preview-Offer says
   * whose data it is.
   */
  @Roles('hr', 'admin', 'ceo')
  @Get('versions/:id/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('employeeId', new ParseUUIDPipe({ optional: true })) employeeId: string | undefined,
    @Query('offerId', new ParseUUIDPipe({ optional: true })) offerId: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const wanted = previewFormat(format);
    const { data, type, fileName, used } = await this.preview.file(id, { employeeId, offerId }, wanted, user);
    res.setHeader(used.kind === 'offer' ? 'X-Preview-Offer' : 'X-Preview-Employee', used.id);
    return new StreamableFile(data, { type, length: data.length, disposition: wanted === 'pdf' ? contentDisposition(fileName) : attachment(fileName) });
  }
}
