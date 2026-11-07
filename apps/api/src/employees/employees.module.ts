import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { EmploymentsController } from './employments.controller.js';
import { EmploymentsService } from './employments.service.js';
import { MissingDetailsController } from './missing-details.controller.js';
import { MissingDetailsService } from './missing-details.service.js';
import { SampleAccountService } from './sample-account.service.js';

// Module 2 · Employees: the directory, the profile (personal details, national ID, contact, education, bank) kept for
// good, and each period of employment on its own (hiring, changes, the end), so history stays. The contracts module
// uses both services: who may see an employment, and ending one. The Missing Details report's controller comes first,
// so its /employees/missing routes are matched before a profile's /employees/:id.
@Module({
  controllers: [MissingDetailsController, EmployeesController, EmploymentsController],
  providers: [EmployeesService, EmploymentsService, MissingDetailsService, SampleAccountService],
  exports: [EmployeesService, EmploymentsService],
})
export class EmployeesModule {}
