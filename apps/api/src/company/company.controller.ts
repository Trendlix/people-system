import {
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

  @Public()
  @Get('logo')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async logo(): Promise<StreamableFile> {
    const { data, type } = await this.company.logo();
    return new StreamableFile(data, { type, length: data.length, disposition: 'inline' });
  }

  @Roles('hr', 'admin')
  @Put('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  setLogo(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.company.setLogo(file, user.id);
  }

  @DeletesRecords()
  @Delete('logo')
  @HttpCode(204)
  removeLogo(@CurrentUser() user: SessionUser) {
    return this.company.removeLogo(user);
  }
}
