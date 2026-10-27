import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { SetAgencyMarkDto } from './agency-marks.dto.js';
import { AgencyMarksService } from './agency-marks.service.js';
import { MANAGES, READS } from './recruitment-access.js';

/** HR's list of marketing agencies (owner, 27 October 2026: "Name words + your list"). */
@Controller('recruitment/agency-marks')
export class AgencyMarksController {
  constructor(private readonly marks: AgencyMarksService) {}

  @Roles(...READS)
  @Get()
  list() {
    return this.marks.list();
  }

  /** A company marked a marketing agency or not: HR and a Super Admin, audited. */
  @Roles(...MANAGES)
  @Put()
  set(@Body() dto: SetAgencyMarkDto, @CurrentUser() user: SessionUser) {
    return this.marks.set(dto, user);
  }

  @Roles(...MANAGES)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.marks.remove(id, user);
  }
}
