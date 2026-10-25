import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import {
  CreateAssignmentDto,
  CreateClientAccountDto,
  CreateTierDto,
  EndClientAccountDto,
  UpdateAssignmentDto,
  UpdateClientAccountDto,
  UpdateTierDto,
} from './client-accounts.dto.js';
import { ClientAccountsService, EDITS_ACCOUNTS, READS_ACCOUNTS } from './client-accounts.service.js';

// Clients → Client Accounts (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with
// it?"): HR, the CEO, Finance (read only) and a Super Admin read the accounts and their people; HR and the CEO add,
// change and end them and their assignments and set the size tiers; only a Super Admin deletes (an assignment or a size
// made by mistake). The amounts are null for anyone who doesn't see salaries (the service). A person's own accounts are
// read from their profile (employees/:employeeId/client-accounts).
@Controller()
export class ClientAccountsController {
  constructor(private readonly accounts: ClientAccountsService) {}

  @Roles(...READS_ACCOUNTS)
  @Get('client-accounts')
  list(@CurrentUser() user: SessionUser) {
    return this.accounts.list(user);
  }

  // the size tiers before :id, so "tiers" is never read as an account
  @Roles(...READS_ACCOUNTS)
  @Get('client-accounts/tiers')
  tiers(@CurrentUser() user: SessionUser) {
    return this.accounts.tiers(user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Post('client-accounts/tiers')
  createTier(@Body() dto: CreateTierDto, @CurrentUser() user: SessionUser) {
    return this.accounts.createTier(dto, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Patch('client-accounts/tiers/:id')
  updateTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTierDto, @CurrentUser() user: SessionUser) {
    return this.accounts.updateTier(id, dto, user);
  }

  @DeletesRecords()
  @Delete('client-accounts/tiers/:id')
  @HttpCode(204)
  removeTier(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.accounts.removeTier(id, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Patch('client-accounts/assignments/:id')
  updateAssignment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssignmentDto, @CurrentUser() user: SessionUser) {
    return this.accounts.updateAssignment(id, dto, user);
  }

  @DeletesRecords()
  @Delete('client-accounts/assignments/:id')
  @HttpCode(204)
  removeAssignment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.accounts.removeAssignment(id, user);
  }

  @Roles(...READS_ACCOUNTS)
  @Get('client-accounts/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.accounts.get(id, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Post('client-accounts')
  create(@Body() dto: CreateClientAccountDto, @CurrentUser() user: SessionUser) {
    return this.accounts.create(dto, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Patch('client-accounts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientAccountDto, @CurrentUser() user: SessionUser) {
    return this.accounts.update(id, dto, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Post('client-accounts/:id/end')
  @HttpCode(200)
  end(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndClientAccountDto, @CurrentUser() user: SessionUser) {
    return this.accounts.end(id, dto, user);
  }

  @Roles(...EDITS_ACCOUNTS)
  @Post('client-accounts/:id/assignments')
  addAssignment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAssignmentDto, @CurrentUser() user: SessionUser) {
    return this.accounts.addAssignment(id, dto, user);
  }

  /** A person's client accounts on their profile: the 404 of a C-level person hidden from the caller first. */
  @ConfidentialOf('employee', 'employeeId')
  @Get('employees/:employeeId/client-accounts')
  forEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.accounts.forEmployee(employeeId, user);
  }
}
