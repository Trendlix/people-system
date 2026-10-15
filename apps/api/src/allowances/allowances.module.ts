import { Module } from '@nestjs/common';
import { AllowancesController } from './allowances.controller.js';
import { AllowancesService } from './allowances.service.js';

// The kinds of allowance (Organization → Allowances): HR sets them up; contracts and job offers use them. Exports the
// service, whose snapshot() gives a contract's or an offer's allowances their kinds' names and treatment to store.
@Module({
  controllers: [AllowancesController],
  providers: [AllowancesService],
  exports: [AllowancesService],
})
export class AllowancesModule {}
