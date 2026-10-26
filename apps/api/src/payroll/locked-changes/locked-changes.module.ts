import { Global, Module } from '@nestjs/common';
import { PayrollLockedChangesController } from './locked-changes.controller.js';
import { PayrollLockedChangesService } from './locked-changes.service.js';

// Leave and attendance changes in a month whose payroll has moved on (owner's brief, 27 October 2026: allowed, never
// silent). Global, as the leave, permission, work from home and official duty services flag their changes with it,
// Unsettled lists them, and the payroll's refresh and the leave sync of a draft clear them.
@Global()
@Module({
  controllers: [PayrollLockedChangesController],
  providers: [PayrollLockedChangesService],
  exports: [PayrollLockedChangesService],
})
export class PayrollLockedChangesModule {}
