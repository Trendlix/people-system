import { Module } from '@nestjs/common';
import { UnsettledController } from './unsettled.controller.js';
import { UnsettledService } from './unsettled.service.js';

// Unsettled (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled - Additions /
// Deductions"): the runs not yet paid, the lines on hold not paid out since, the final settlements of people who left,
// and the advances and loans still being recovered (from the global PayrollAdjustmentsModule).
@Module({
  controllers: [UnsettledController],
  providers: [UnsettledService],
  exports: [UnsettledService],
})
export class UnsettledModule {}
