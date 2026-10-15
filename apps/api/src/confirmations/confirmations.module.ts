import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { ConfirmationsController } from './confirmations.controller.js';
import { ConfirmationsService } from './confirmations.service.js';

// The employee's own check of their details (owner's decision, 15 October 2026): confirmations, with the statement
// accepted, and change requests that HR or an Admin approves or rejects. Uses the employees module to make an approved
// change as HR's edit of the profile; the profile shows the confirmation and the requests (views.ts).
@Module({
  imports: [EmployeesModule],
  controllers: [ConfirmationsController],
  providers: [ConfirmationsService],
})
export class ConfirmationsModule {}
