import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { HandleLockedChangeDto } from './locked-changes.dto.js';
import { PayrollLockedChangesService } from './locked-changes.service.js';

// Leave and attendance changes made after the month's payroll moved on (27 October 2026): Unsettled lists them (GET
// /payroll/unsettled, lockedChanges); HR marks one handled once corrected by hand on a later payroll. A C-level person's
// is not there for anyone it is hidden from (owner, 19 October 2026): the service answers 404.
@Controller('payroll')
export class PayrollLockedChangesController {
  constructor(private readonly changes: PayrollLockedChangesService) {}

  /** HR marks a flagged change handled: { note? }. Answers the row as handled. */
  @Roles('hr')
  @Post('locked-changes/:id/handled')
  @HttpCode(200)
  handled(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HandleLockedChangeDto, @CurrentUser() user: SessionUser) {
    return this.changes.handle(id, dto, user);
  }
}
