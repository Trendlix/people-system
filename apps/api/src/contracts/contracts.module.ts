import { Module } from '@nestjs/common';
import { AllowancesModule } from '../allowances/allowances.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { EndingRulesService } from './ending-rules.service.js';
import { EndingsController } from './endings.controller.js';
import { EndingsService } from './endings.service.js';
import { HiringController } from './hiring.controller.js';
import { HiringService } from './hiring.service.js';
import { RaiseRequestsService } from './raise-requests.service.js';
import { RaisesController } from './raises.controller.js';
import { RaisesService } from './raises.service.js';
import { SalaryHistoryService } from './salary-history.service.js';
import { ContractSettingsController, EndingRulesController } from './settings.controller.js';

// Module 3 · Contracts, phase 1 (owner's decisions, 15 October 2026, checked against Labour Law 14/2025): contract
// versions under each employment, their defaults, the ways an employment can end and their notice, and endings
// approved by HR, then the CEO; and hiring in one form, the employment with its first contract (owner's decision, 16
// October 2026); pay raises during a contract, renewals with new pay, raise requests and the salary history (owner's
// decisions, 16 October 2026). Uses the employees module for who may see an employment, for adding and ending one, and
// the allowances module for a contract's allowances.
@Module({
  imports: [EmployeesModule, AllowancesModule],
  controllers: [ContractSettingsController, EndingRulesController, ContractsController, EndingsController, HiringController, RaisesController],
  providers: [ContractSettingsService, EndingRulesService, ContractsService, EndingsService, HiringService, RaisesService, RaiseRequestsService, SalaryHistoryService],
})
export class ContractsModule {}
