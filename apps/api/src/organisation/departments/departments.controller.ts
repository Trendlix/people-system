import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { CreateDepartmentDto, UpdateDepartmentDto } from './department.dto.js';
import { DepartmentsService } from './departments.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list() {
    return this.departments.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.get(id);
  }

  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: SessionUser) {
    return this.departments.create(dto, user.id);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto, @CurrentUser() user: SessionUser) {
    return this.departments.update(id, dto, user.id);
  }

  @Roles('hr', 'admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.departments.remove(id, user.id);
  }
}
