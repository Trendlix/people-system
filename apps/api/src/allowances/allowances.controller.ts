import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateAllowanceTypeDto, UpdateAllowanceTypeDto } from './allowances.dto.js';
import { AllowancesService } from './allowances.service.js';

// The kinds of allowance: anyone signed in reads them (contracts and offers choose from them); HR or an Admin adds and
// changes them; only a Super Admin deletes one, and only one no contract or offer has.
@Controller('allowance-types')
export class AllowancesController {
  constructor(private readonly allowances: AllowancesService) {}

  @Get()
  list() {
    return this.allowances.list();
  }

  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateAllowanceTypeDto, @CurrentUser() user: SessionUser) {
    return this.allowances.create(dto, user.id);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAllowanceTypeDto, @CurrentUser() user: SessionUser) {
    return this.allowances.update(id, dto, user.id);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.allowances.remove(id, user);
  }
}
