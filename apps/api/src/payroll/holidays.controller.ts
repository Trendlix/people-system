import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateHolidayDto, HolidaysQueryDto, UpdateHolidayDto } from './holidays.dto.js';
import { HolidaysService } from './holidays.service.js';

// The official holidays (Organization → Payroll Setup, owner's request of 16 October 2026): HR, Finance, the CEO and
// Admin read them, as the payroll settings; HR and Admin add and change them; a Super Admin removes one (every deletion
// is a Super Admin's: owner's decision, 15 October 2026).
@Controller('payroll/holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  /** ?year=YYYY: that year's, in date order; every holiday without it. */
  @Roles('hr', 'finance', 'ceo', 'admin')
  @Get()
  list(@Query() query: HolidaysQueryDto) {
    return this.holidays.list(query.year);
  }

  /** { date: 'YYYY-MM-DD', nameEn, nameAr? } */
  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: SessionUser) {
    return this.holidays.create(dto, user);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHolidayDto, @CurrentUser() user: SessionUser) {
    return this.holidays.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.holidays.remove(id, user);
  }
}
