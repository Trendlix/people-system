import { Module } from '@nestjs/common';
import { CompensatoryController, MyCompensatoryController } from './compensatory.controller.js';
import { CompensatoryService } from './compensatory.service.js';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month"):
// the requests, HR's recording and decision (a day off, or cash instead), and the Leave Setup's cash rate. How an
// approved day off counts in the attendance and the payroll is the attendance module's (compensatory-days.ts, read there).
@Module({
  controllers: [MyCompensatoryController, CompensatoryController],
  providers: [CompensatoryService],
  exports: [CompensatoryService],
})
export class CompensatoryModule {}
