import { Module } from '@nestjs/common';
import { MyTimesheetController, TimesheetsController } from './timesheets.controller.js';
import { TimesheetsService } from './timesheets.service.js';

// Timesheets (owner, 4 November 2026; packages/shared timesheets.ts): logging hours, sending a week, approving it.
@Module({
  controllers: [MyTimesheetController, TimesheetsController],
  providers: [TimesheetsService],
  exports: [TimesheetsService],
})
export class TimesheetsModule {}
