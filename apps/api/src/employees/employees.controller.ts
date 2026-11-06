import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from './confidential.guard.js';
import { CreateEmployeeDto, TestAccountDto, UpdateBankDto, UpdateEmployeeDto, UpdateIdentityDto } from './employee.dto.js';
import { EmployeesService } from './employees.service.js';

// Reading is open to every signed-in user, limited to the employees they may see (see access.ts). A C-level person
// (owner, 19 October 2026: "make C level Employees details not visible to HR") is their directory card only for anyone
// but the CEO, a Super Admin and themself: the profile is the card, and the routes below it answer 404 (ConfidentialOf).
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** Everyone the caller may see; `?tests=only`: the test accounts instead (HR and a Super Admin, 6 November 2026). */
  @Get()
  list(@Query('tests') tests: string | undefined, @CurrentUser() user: SessionUser) {
    return this.employees.list(user, tests === 'only');
  }

  /**
   * Makes a profile a test account, or a real one again (owner, 6 November 2026: an account for Google's and Apple's app
   * reviewers "without real data"): { testAccount }. HR and a Super Admin.
   */
  @Roles('hr', 'super_admin')
  @Patch(':id/test-account')
  setTestAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestAccountDto, @CurrentUser() user: SessionUser) {
    return this.employees.setTestAccount(id, dto.testAccount, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.get(id, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr', 'ceo')
  @Get(':id/identity')
  identity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.identity(id, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr', 'finance', 'ceo')
  @Get(':id/bank')
  bank(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.bank(id, user);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: SessionUser) {
    return this.employees.create(dto, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: SessionUser) {
    return this.employees.update(id, dto, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr')
  @Patch(':id/identity')
  updateIdentity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIdentityDto, @CurrentUser() user: SessionUser) {
    return this.employees.updateIdentity(id, dto, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr')
  @Patch(':id/bank')
  updateBank(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBankDto, @CurrentUser() user: SessionUser) {
    return this.employees.updateBank(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.remove(id, user);
  }
}
