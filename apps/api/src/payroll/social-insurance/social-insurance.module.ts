import { Module } from '@nestjs/common';
import { SocialInsuranceReportController } from './social-insurance.controller.js';
import { SocialInsuranceReportService } from './social-insurance.service.js';

// The Social Insurance report under Payroll → Reports (owner, 27 October 2026: "is there a report for the social
// insurance? to be filled from the social insurance tab"; he chose all three: the insured staff register, the monthly
// contributions and the missing data checklist), from each profile's Social Insurance tab rather than the payroll runs. A
// module of its own beside Payroll: Prisma, the audit log, the C-level rule and the rates set by law are global.
@Module({
  controllers: [SocialInsuranceReportController],
  providers: [SocialInsuranceReportService],
})
export class SocialInsuranceReportModule {}
