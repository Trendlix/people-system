import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CorrectionsService } from './corrections.service.js';
import { FileTooLargeFilter } from './file-too-large.filter.js';
import { ID_CARD_SIDES } from './paperwork.controller.js';
import { LearnCorrectionsDto } from './paperwork.dto.js';
import { PaperworkService, type IdCardFiles } from './paperwork.service.js';

// National ID cards on a scan, and what is learned from HR's corrections to their readings.
@Controller('id-card')
export class IdCardController {
  constructor(
    private readonly paperwork: PaperworkService,
    private readonly corrections: CorrectionsService,
  ) {}

  /** One or two scans or photos (front required, back optional) → the cards found, cut out and straightened. */
  @Roles('hr')
  @Post('prepare')
  @HttpCode(200)
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(ID_CARD_SIDES)
  prepare(@UploadedFiles() files: IdCardFiles) {
    return this.paperwork.prepareIdCard(files);
  }

  @Roles('hr', 'admin')
  @Get('corrections')
  list() {
    return this.corrections.list();
  }

  /** What HR saved after reading a card, compared with what the reading said: the changed words are learned. */
  @Roles('hr')
  @Post('corrections')
  @HttpCode(200)
  learn(@Body() dto: LearnCorrectionsDto, @CurrentUser() user: SessionUser) {
    return this.corrections.learn(dto.corrections, user);
  }

  @DeletesRecords()
  @Delete('corrections/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.corrections.remove(id, user);
  }
}
