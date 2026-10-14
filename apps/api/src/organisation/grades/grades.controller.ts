import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { CreateGradeDto, UpdateGradeDto } from './grade.dto.js';
import { GradesService } from './grades.service.js';

@Controller('grades')
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get()
  list() {
    return this.grades.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.grades.get(id);
  }

  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateGradeDto, @CurrentUser() user: SessionUser) {
    return this.grades.create(dto, user.id);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGradeDto, @CurrentUser() user: SessionUser) {
    return this.grades.update(id, dto, user.id);
  }

  @Roles('hr', 'admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.grades.remove(id, user.id);
  }
}
