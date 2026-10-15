import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { EndingRulesService } from './ending-rules.service.js';
import { EndingsController } from './endings.controller.js';
import { EndingsService } from './endings.service.js';
import { ContractSettingsController, EndingRulesController } from './settings.controller.js';

// Module 3 · Contracts, phase 1 (owner's decisions, 15 October 2026, checked against Labour Law 14/2025): contract
// versions under each employment, their defaults, the ways an employment can end and their notice, and endings
// approved by HR, then the CEO. Uses the employees module for who may see an employment and for ending one.
@Module({
  imports: [EmployeesModule],
  controllers: [ContractSettingsController, EndingRulesController, ContractsController, EndingsController],
  providers: [ContractSettingsService, EndingRulesService, ContractsService, EndingsService],
})
export class ContractsModule {}
