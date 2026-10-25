import { Module } from '@nestjs/common';
import { ExpectedHoursService } from './expected-hours.service.js';
import { HolidaysController } from './holidays.controller.js';
import { HolidaysService } from './holidays.service.js';
import { PayrollController, PayrollSettingsController } from './payroll.controller.js';
import { PayrollSettingsService } from './payroll-settings.service.js';
import { PayrollService } from './payroll.service.js';
import { MyPayslipsController, PayslipsController } from './payslips.controller.js';
import { PayslipsService } from './payslips.service.js';

// Payroll, phase 1 (owner's decisions, 16 October 2026): the settings, monthly runs worked out from the contracts and
// the month's inputs (packages/shared payroll.ts), the CEO's approval, the payroll register and the bank files; and the
// payslips, issued when HR marks a run paid. The official holidays (Payroll Setup, owner's request of 16 October 2026),
// which a run takes out of each shift's working days for the expected hours. The expected hours are worked out, never
// typed (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data"): ExpectedHoursService
// clears any a draft's line had typed. The employee's own payslips (owner, 20 October 2026, the employee app: "My
// attendance and payslips"): MyPayslipsController. The contracts module takes a person's draft lines again when a
// signing is undone or a draft deleted (owner's report, 25 October 2026): PayrollService.rebuildDraftLines.
@Module({
  controllers: [PayrollSettingsController, HolidaysController, PayrollController, PayslipsController, MyPayslipsController],
  providers: [PayrollSettingsService, HolidaysService, PayrollService, PayslipsService, ExpectedHoursService],
  exports: [PayrollService],
})
export class PayrollModule {}
