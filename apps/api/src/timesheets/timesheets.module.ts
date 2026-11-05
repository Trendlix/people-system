import { Module } from '@nestjs/common';
import { ClientHoursController } from './client-hours.controller.js';
import { ClientHoursService } from './client-hours.service.js';
import { TimesheetUploadController } from './timesheet-upload.controller.js';
import { TimesheetUploadService } from './timesheet-upload.service.js';
import { MyTimesheetController, TimesheetsController } from './timesheets.controller.js';
import { TimesheetsService } from './timesheets.service.js';

// Timesheets (owner, 4 November 2026; packages/shared timesheets.ts): logging hours, sending a week, approving it; and
// the month's hours by client (Clients → Client Hours); hours uploaded from the Excel template (5 November 2026).
@Module({
  controllers: [TimesheetUploadController, MyTimesheetController, TimesheetsController, ClientHoursController],
  providers: [TimesheetsService, ClientHoursService, TimesheetUploadService],
  exports: [TimesheetsService],
})
export class TimesheetsModule {}
