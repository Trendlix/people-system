import { Global, Module } from '@nestjs/common';
import { AccessLinksService } from './access-links.service.js';
import { EmployeeAccessSchedulerService } from './employee-access-scheduler.service.js';
import { AccessLinksController, EmployeeAccessController } from './employee-access.controller.js';
import { EmployeeAccessService } from './employee-access.service.js';

// Every active employee gets access (owner, 22 October 2026): the accounts, their set-password links and the sweep.
@Global()
@Module({
  controllers: [EmployeeAccessController, AccessLinksController],
  providers: [EmployeeAccessService, AccessLinksService, EmployeeAccessSchedulerService],
  exports: [EmployeeAccessService, EmployeeAccessSchedulerService],
})
export class EmployeeAccessModule {}
