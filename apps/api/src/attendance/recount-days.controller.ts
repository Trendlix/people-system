import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { RecountDaysDto } from './recount-days.dto.js';
import { RecountDaysService } from './recount-days.service.js';

// Recount past days (owner, 26 October 2026): HR and a Super Admin, on Organization → Shifts; a developer only sees.
@Controller('attendance/recount-days')
export class RecountDaysController {
  constructor(private readonly recount: RecountDaysService) {}

  /** { from, to, shiftId? }: what would change; nothing is written. */
  @Roles('hr', 'admin')
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: RecountDaysDto) {
    return this.recount.preview(dto);
  }

  /** The same, done: audited. */
  @Roles('hr', 'admin')
  @Post()
  @HttpCode(200)
  run(@Body() dto: RecountDaysDto, @CurrentUser() user: SessionUser) {
    return this.recount.run(dto, user);
  }
}
