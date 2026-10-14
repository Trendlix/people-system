import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto.js';
import { JobTitlesService } from './job-titles.service.js';

@Controller('job-titles')
export class JobTitlesController {
  constructor(private readonly jobTitles: JobTitlesService) {}

  @Get()
  list(@Query('departmentId', new ParseUUIDPipe({ optional: true })) departmentId?: string) {
    return this.jobTitles.list(departmentId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobTitles.get(id);
  }

  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateJobTitleDto, @CurrentUser() user: SessionUser) {
    return this.jobTitles.create(dto, user.id);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobTitleDto, @CurrentUser() user: SessionUser) {
    return this.jobTitles.update(id, dto, user.id);
  }

  @Roles('hr', 'admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.jobTitles.remove(id, user.id);
  }
}
