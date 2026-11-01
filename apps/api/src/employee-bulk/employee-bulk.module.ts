import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { EmployeeBulkController } from './employee-bulk.controller.js';
import { EmployeeBulkService } from './employee-bulk.service.js';

/** The Employees list's bulk actions and the chosen people's export (1 November 2026). */
@Module({ imports: [EmployeesModule], controllers: [EmployeeBulkController], providers: [EmployeeBulkService] })
export class EmployeeBulkModule {}
