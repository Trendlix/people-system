import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

// Module 2 · Employees: the directory and the employee profile (personal details, national ID, contact, education,
// bank, employment).
@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
