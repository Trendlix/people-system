import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateEmployeeDto, UpdateBankDto, UpdateEmployeeDto, UpdateIdentityDto } from './employee.dto.js';
import { EmployeesService } from './employees.service.js';

// Reading is open to every signed-in user, limited to the employees they may see (see access.ts).
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.employees.list(user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.get(id, user);
  }

  @Roles('hr', 'ceo')
  @Get(':id/identity')
  identity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.identity(id, user);
  }

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

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: SessionUser) {
    return this.employees.update(id, dto, user);
  }

  @Roles('hr')
  @Patch(':id/identity')
  updateIdentity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIdentityDto, @CurrentUser() user: SessionUser) {
    return this.employees.updateIdentity(id, dto, user);
  }

  @Roles('hr')
  @Patch(':id/bank')
  updateBank(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBankDto, @CurrentUser() user: SessionUser) {
    return this.employees.updateBank(id, dto, user);
  }

  @Roles('hr')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.employees.remove(id, user);
  }
}
