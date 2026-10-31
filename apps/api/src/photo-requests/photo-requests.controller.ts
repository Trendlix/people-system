import {
  Body,
  Controller,
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
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { CreatePhotoRequestDto, ListPhotoRequestsDto, PhotoDecisionDto } from './photo-requests.dto.js';
import { PhotoRequestsService } from './photo-requests.service.js';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"): the employee sends it for their own profile (checked by the service) and may cancel it
// while it waits; those who decide their change requests (HR, an Admin, the CEO for a C-level person's: checked by the
// service) see it and approve it, which makes it the employee file's personal photo, or reject it.

// One photo, no larger than a paper of the employee file; its name read as UTF-8, so an Arabic name arrives intact.
const ONE_PHOTO = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 2 }, defParamCharset: 'utf8' };

@Controller()
export class PhotoRequestsController {
  constructor(private readonly photos: PhotoRequestsService) {}

  /** The photo as `file` (a JPEG, PNG or WebP image), a note for HR as `note` (optional). */
  @Post('employees/:id/photo-requests')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_PHOTO))
  request(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreatePhotoRequestDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.photos.request(id, dto, file, user);
  }

  /** HR's queue is the default: the photos waiting (status pending); `?status=all` lists every request. */
  @Roles('hr', 'admin', 'ceo')
  @Get('photo-requests')
  list(@Query() query: ListPhotoRequestsDto, @CurrentUser() user: SessionUser) {
    return this.photos.list(query.status, user);
  }

  /**
   * The photo sent: to the employee who sent it, and to those who decide it. Never kept by the browser, and never a
   * developer's: a face is personal data (owner, 22 October 2026).
   */
  @NotForDevelopers()
  @Get('photo-requests/:id/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async photo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type } = await this.photos.photo(id, user);
    return new StreamableFile(data, { type, length: data.length });
  }

  @Roles('hr', 'admin', 'ceo')
  @Post('photo-requests/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDecisionDto, @CurrentUser() user: SessionUser) {
    return this.photos.approve(id, dto, user);
  }

  @Roles('hr', 'admin', 'ceo')
  @Post('photo-requests/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDecisionDto, @CurrentUser() user: SessionUser) {
    return this.photos.reject(id, dto, user);
  }

  /** The employee who sent it, while it waits. */
  @Post('photo-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.photos.cancel(id, user);
  }
}
