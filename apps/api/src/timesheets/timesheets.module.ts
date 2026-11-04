import { Module } from '@nestjs/common';
import { ClientHoursController } from './client-hours.controller.js';
import { ClientHoursService } from './client-hours.service.js';
import { MyTimesheetController, TimesheetsController } from './timesheets.controller.js';
import { TimesheetsService } from './timesheets.service.js';

// Timesheets (owner, 4 November 2026; packages/shared timesheets.ts): logging hours, sending a week, approving it; and
// the month's hours by client (Clients → Client Hours).
@Module({
  controllers: [MyTimesheetController, TimesheetsController, ClientHoursController],
  providers: [TimesheetsService, ClientHoursService],
  exports: [TimesheetsService],
})
export class TimesheetsModule {}
