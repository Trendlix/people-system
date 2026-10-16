import { Global, Module } from '@nestjs/common';
import { LawRatesController } from './law-rates.controller.js';
import { LawRatesService } from './law-rates.service.js';

// The rates set by law, by year (owner's request, 16 October 2026): global, as payroll, contracts, offers, documents
// and the employees' Social Insurance tab all work with a year's rates.
@Global()
@Module({
  controllers: [LawRatesController],
  providers: [LawRatesService],
  exports: [LawRatesService],
})
export class LawRatesModule {}
