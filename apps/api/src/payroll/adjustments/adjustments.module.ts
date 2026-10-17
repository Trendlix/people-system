import { Global, Module } from '@nestjs/common';
import { AdjustmentsController, AdvancesController } from './adjustments.controller.js';
import { AdjustmentsService } from './adjustments.service.js';
import { AdvancesService } from './advances.service.js';
import { GridInputsService } from './grid-inputs.service.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';

// Additions / Deductions, and advances and loans (owner, 17 October 2026: "make the Payroll in the side tab a main title
// below it - Unsettled - Additions / Deductions"): one-off amounts on an employee's month, and what is given ahead and
// recovered from the pay. Global, as Unsettled reads them and the month's run takes and applies them. The run grid's
// bonus and penalty days, commission and settlements moved here (17 October 2026): GridInputsService makes a draft's
// typed ones additions and deductions.
@Global()
@Module({
  controllers: [AdjustmentsController, AdvancesController],
  providers: [AdjustmentsService, AdvancesService, RunAdjustmentsService, GridInputsService],
  exports: [AdjustmentsService, AdvancesService, RunAdjustmentsService, GridInputsService],
})
export class PayrollAdjustmentsModule {}
