import { Global, Module } from '@nestjs/common';
import { OffboardingReportsService } from './offboarding-reports.service.js';
import { OffboardingSchedulerService } from './offboarding-scheduler.service.js';
import { OffboardingController } from './offboarding.controller.js';
import { OffboardingService } from './offboarding.service.js';

// Offboarding (owner, 22 October 2026: the full module: "Former Employees tab, clearance checklist (assets returned,
// laptop, access), exit interview, rehire eligibility, turnover numbers"). Global, so the endings (contracts) and End
// employment (employees) open, cancel and bring a case up to date without wiring this module into theirs.
@Global()
@Module({
  controllers: [OffboardingController],
  providers: [OffboardingService, OffboardingReportsService, OffboardingSchedulerService],
  exports: [OffboardingService, OffboardingSchedulerService],
})
export class OffboardingModule {}
