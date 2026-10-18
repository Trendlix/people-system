import { Global, Module } from '@nestjs/common';
import { AdjustmentsController, AdvancesController, DeductionPlansController, RecurringDeductionsController } from './adjustments.controller.js';
import { AdjustmentsService } from './adjustments.service.js';
import { AdvancesService } from './advances.service.js';
import { DeductionPlansService } from './deduction-plans.service.js';
import { GridInputsService } from './grid-inputs.service.js';
import { InstallmentsService } from './installments.service.js';
import { RecurringDeductionsService } from './recurring.service.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';

// Additions / Deductions, and advances and loans (owner, 17 October 2026: "make the Payroll in the side tab a main title
// below it - Unsettled - Additions / Deductions"): one-off amounts on an employee's month, and what is given ahead and
// recovered from the pay. Global, as Unsettled reads them and the month's run takes and applies them. The run grid's
// bonus and penalty days, commission and settlements moved here (17 October 2026): GridInputsService makes a draft's
// typed ones additions and deductions. Installments and recurring deductions (owner, 18 October 2026: "in the deductions
// i might have a loan of a medical subscription or something that needs to be deducted as installments on the
// employee"): an advance's or a loan's installments made at once and moved or changed by HR (InstallmentsService), and
// monthly shares each month's run adds (RecurringDeductionsService, which an employment's end stops); the employee sees
// their own (DeductionPlansService).
@Global()
@Module({
  controllers: [AdjustmentsController, AdvancesController, RecurringDeductionsController, DeductionPlansController],
  providers: [AdjustmentsService, AdvancesService, RunAdjustmentsService, GridInputsService, InstallmentsService, RecurringDeductionsService, DeductionPlansService],
  exports: [AdjustmentsService, AdvancesService, RunAdjustmentsService, GridInputsService, InstallmentsService, RecurringDeductionsService],
})
export class PayrollAdjustmentsModule {}
