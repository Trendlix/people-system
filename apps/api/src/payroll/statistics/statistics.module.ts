import { Module } from '@nestjs/common';
import { PayrollStatisticsController } from './statistics.controller.js';
import { PayrollStatisticsService } from './statistics.service.js';

// Payroll statistics (owner, 17 October 2026: "Reports (Statistics)" under Payroll): what the approved runs paid and
// cost, by month, department and team, and this year to date, with an Excel workbook of them.
@Module({
  controllers: [PayrollStatisticsController],
  providers: [PayrollStatisticsService],
})
export class PayrollStatisticsModule {}
