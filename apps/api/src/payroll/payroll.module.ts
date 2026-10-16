import { Module } from '@nestjs/common';
import { HolidaysController } from './holidays.controller.js';
import { HolidaysService } from './holidays.service.js';
import { PayrollController, PayrollSettingsController } from './payroll.controller.js';
import { PayrollSettingsService } from './payroll-settings.service.js';
import { PayrollService } from './payroll.service.js';
import { PayslipsController } from './payslips.controller.js';
import { PayslipsService } from './payslips.service.js';

// Payroll, phase 1 (owner's decisions, 16 October 2026): the settings, monthly runs worked out from the contracts and
// the month's inputs (packages/shared payroll.ts), the CEO's approval, the payroll register and the bank files; and the
// payslips, issued when HR marks a run paid. The official holidays (Payroll Setup, owner's request of 16 October 2026),
// which a run takes out of each shift's working days for the expected hours.
@Module({
  controllers: [PayrollSettingsController, HolidaysController, PayrollController, PayslipsController],
  providers: [PayrollSettingsService, HolidaysService, PayrollService, PayslipsService],
})
export class PayrollModule {}
