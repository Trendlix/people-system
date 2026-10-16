import { Module } from '@nestjs/common';
import { PayrollController, PayrollSettingsController } from './payroll.controller.js';
import { PayrollSettingsService } from './payroll-settings.service.js';
import { PayrollService } from './payroll.service.js';

// Payroll, phase 1 (owner's decisions, 16 October 2026): the settings, monthly runs worked out from the contracts and
// the month's inputs (packages/shared payroll.ts), the CEO's approval, the payroll register and the bank files.
@Module({
  controllers: [PayrollSettingsController, PayrollController],
  providers: [PayrollSettingsService, PayrollService],
})
export class PayrollModule {}
