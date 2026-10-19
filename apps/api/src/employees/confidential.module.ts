import { Global, Module } from '@nestjs/common';
import { ConfidentialGuard } from './confidential.guard.js';
import { ConfidentialService } from './confidential.service.js';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): who is
// C-level and whom that hides from the caller, for every module, and the guard of the routes about one person's record.
@Global()
@Module({
  providers: [ConfidentialService, ConfidentialGuard],
  exports: [ConfidentialService, ConfidentialGuard],
})
export class ConfidentialModule {}
