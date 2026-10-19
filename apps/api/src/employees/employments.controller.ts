import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from './confidential.guard.js';
import { CreateEmploymentDto, EndEmploymentDto, UpdateEmploymentDto } from './employment.dto.js';
import { EmploymentsService } from './employments.service.js';

// An employee's employments (hiring, changes, the end) under their profile. Each answer is the updated profile. Not a
// C-level person's for anyone who may not see them (owner, 19 October 2026): 404, as their profile is their card.
@Controller('employees/:id/employments')
export class EmploymentsController {
  constructor(private readonly employments: EmploymentsService) {}

  @ConfidentialOf('employee')
  @Roles('hr')
  @Post()
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEmploymentDto, @CurrentUser() user: SessionUser) {
    return this.employments.create(id, dto, user);
  }

  @ConfidentialOf('employee')
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

  @ConfidentialOf('employee')
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

  /** Someone on probation passes it: the status becomes Active (owner's decisions, 15 October 2026). */
  @ConfidentialOf('employee')
  @Roles('hr')
  @Post(':employmentId/confirm-probation')
  @HttpCode(200)
  confirmProbation(@Param('id', ParseUUIDPipe) id: string, @Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.employments.confirmProbation(id, employmentId, user);
  }

  @ConfidentialOf('employee')
  @DeletesRecords()
  @Delete(':employmentId')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.employments.remove(id, employmentId, user);
  }
}
