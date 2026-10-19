import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { HireDto } from './hiring.dto.js';
import { HiringService } from './hiring.service.js';

// Hiring in one form (owner's decision, 16 October 2026): the employment and its first contract, drafted, in one request.
@Controller('employees/:id/hire')
export class HiringController {
  constructor(private readonly hiring: HiringService) {}

  /** HR hires someone whose profile exists, the first time or again after they left. Answers the updated profile. */
  @ConfidentialOf('employee')
  @Roles('hr')
  @Post()
  hire(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HireDto, @CurrentUser() user: SessionUser) {
    return this.hiring.hire(id, dto, user);
  }
}
