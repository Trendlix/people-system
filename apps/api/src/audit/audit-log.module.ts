import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';

// The Audit Log page's API (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): reads what
// AuditService (the global AuditModule) writes. ConfidentialService comes from the global ConfidentialModule.
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
