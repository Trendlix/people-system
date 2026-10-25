import { Module } from '@nestjs/common';
import { ClientAccountsController } from './client-accounts.controller.js';
import { ClientAccountsService } from './client-accounts.service.js';

// Clients → Client Accounts (owner, 25 October 2026): the client accounts, their size tiers and the people assigned to
// them, paid as the accounts allowance by payroll (payroll roster.ts reads the assignments itself). Clients will hold
// Projects and Timesheets later.
@Module({
  controllers: [ClientAccountsController],
  providers: [ClientAccountsService],
  exports: [ClientAccountsService],
})
export class ClientAccountsModule {}
