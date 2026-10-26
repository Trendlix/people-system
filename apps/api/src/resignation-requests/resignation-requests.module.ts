import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { MyResignationController, ResignationRequestsController } from './resignation-requests.controller.js';
import { ResignationRequestsService } from './resignation-requests.service.js';

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"): sent from My Requests, recorded by HR as the ending the End employment form makes
// (ContractsModule's EndingsService, so the ending's own rules and steps are unchanged).
@Module({
  imports: [ContractsModule],
  controllers: [MyResignationController, ResignationRequestsController],
  providers: [ResignationRequestsService],
})
export class ResignationRequestsModule {}
