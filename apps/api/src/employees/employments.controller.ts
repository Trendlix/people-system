import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateEmploymentDto, EndEmploymentDto, UpdateEmploymentDto } from './employment.dto.js';
import { EmploymentsService } from './employments.service.js';

// An employee's employments (hiring, changes, the end) under their profile. Each answer is the updated profile.
@Controller('employees/:id/employments')
export class EmploymentsController {
  constructor(private readonly employments: EmploymentsService) {}

  @Roles('hr')
  @Post()
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEmploymentDto, @CurrentUser() user: SessionUser) {
    return this.employments.create(id, dto, user);
  }

  @Roles('hr')
  @Patch(':employmentId')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Body() dto: UpdateEmploymentDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.employments.update(id, employmentId, dto, user);
  }

  @Roles('hr')
  @Post(':employmentId/end')
  @HttpCode(200)
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Body() dto: EndEmploymentDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.employments.end(id, employmentId, dto, user);
  }

  @Roles('hr', 'admin')
  @Delete(':employmentId')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.employments.remove(id, employmentId, user);
  }
}
