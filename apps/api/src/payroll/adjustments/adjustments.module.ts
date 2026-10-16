import { Global, Module } from '@nestjs/common';
import { AdjustmentsController, AdvancesController } from './adjustments.controller.js';
import { AdjustmentsService } from './adjustments.service.js';
import { AdvancesService } from './advances.service.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';

// Additions / Deductions, and advances and loans (owner, 17 October 2026: "make the Payroll in the side tab a main title
// below it - Unsettled - Additions / Deductions"): one-off amounts on an employee's month, and what is given ahead and
// recovered from the pay. Global, as Unsettled reads them and the month's run takes and applies them.
@Global()
@Module({
  controllers: [AdjustmentsController, AdvancesController],
  providers: [AdjustmentsService, AdvancesService, RunAdjustmentsService],
  exports: [AdjustmentsService, AdvancesService, RunAdjustmentsService],
})
export class PayrollAdjustmentsModule {}
