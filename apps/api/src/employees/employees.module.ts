import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { EmploymentsController } from './employments.controller.js';
import { EmploymentsService } from './employments.service.js';

// Module 2 · Employees: the directory, the profile (personal details, national ID, contact, education, bank) kept for
// good, and each period of employment on its own (hiring, changes, the end), so history stays.
@Module({
  controllers: [EmployeesController, EmploymentsController],
  providers: [EmployeesService, EmploymentsService],
})
export class EmployeesModule {}
