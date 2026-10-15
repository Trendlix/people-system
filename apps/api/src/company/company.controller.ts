import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, DeletesRecords, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { UpdateCompanyDto } from './company.dto.js';
import { CompanyService } from './company.service.js';
import { LOGO_MAX_BYTES } from './logo-type.js';

/** A public image's headers: cached for five minutes, never taken for another type, and nothing in it runs. */
const ImageHeaders = () =>
  applyDecorators(
    Header('Cache-Control', 'public, max-age=300'),
    Header('X-Content-Type-Options', 'nosniff'),
    Header('Content-Security-Policy', "default-src 'none'"),
  );

/** One file, refused over 1 MB before it is read in full (413). */
const ImageUpload = () => FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } });

function imageFile({ data, type }: { data: Buffer; type: string }): StreamableFile {
  return new StreamableFile(data, { type, length: data.length, disposition: 'inline' });
}

@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  get() {
    return this.company.get();
  }

  @Public()
  @Get('brand')
  brand() {
    return this.company.brand();
  }

  @Roles('hr', 'admin')
  @Patch()
  update(@Body() dto: UpdateCompanyDto, @CurrentUser() user: SessionUser) {
    return this.company.update(dto, user.id);
  }

  // The logo and the thumbnail (the square brand mark beside it, owner's request, 15 October 2026) go the same way: read
  // by anyone (the sign-in page, the browser tab icon), uploaded or replaced by HR and Admin, removed by a Super Admin.
  // The web app asks for them with the image's version in the address, so the five minutes' caching never shows an old one.

  @Public()
  @Get('logo')
  @ImageHeaders()
  async logo(): Promise<StreamableFile> {
    return imageFile(await this.company.image('logo'));
  }

  @Roles('hr', 'admin')
  @Put('logo')
  @UseInterceptors(ImageUpload())
  setLogo(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.company.setImage('logo', file, user.id);
  }

  @DeletesRecords()
  @Delete('logo')
  @HttpCode(204)
  removeLogo(@CurrentUser() user: SessionUser) {
    return this.company.removeImage('logo', user);
  }

  @Public()
  @Get('thumbnail')
  @ImageHeaders()
  async thumbnail(): Promise<StreamableFile> {
    return imageFile(await this.company.image('thumbnail'));
  }

  @Roles('hr', 'admin')
  @Put('thumbnail')
  @UseInterceptors(ImageUpload())
  setThumbnail(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.company.setImage('thumbnail', file, user.id);
  }

  @DeletesRecords()
  @Delete('thumbnail')
  @HttpCode(204)
  removeThumbnail(@CurrentUser() user: SessionUser) {
    return this.company.removeImage('thumbnail', user);
  }
}
