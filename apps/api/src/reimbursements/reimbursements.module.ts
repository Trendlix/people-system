import { Module } from '@nestjs/common';
import { MyReimbursementsController, ReimbursementsController, ReimbursementTypesController } from './reimbursements.controller.js';
import { ReimbursementTypesService } from './reimbursement-types.service.js';
import { ReimbursementsService } from './reimbursements.service.js';

// Reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
// conditions", "in the setup i need to enter for it a cap"): the types HR sets up with their conditions, and the claims
// employees send, decided by their direct manager, HR and Finance in turn, Finance's approval adding them to the next
// payroll (the payroll adjustments module, global, takes them from there).
@Module({
  controllers: [ReimbursementTypesController, MyReimbursementsController, ReimbursementsController],
  providers: [ReimbursementTypesService, ReimbursementsService],
})
export class ReimbursementsModule {}
