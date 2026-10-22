import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { ONBOARDING_STATUSES, type OnboardingStatus } from '@trendlix/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { OFFBOARDING_MANAGERS } from '../offboarding/offboarding-access.js';
import type { SessionUser } from '../auth/session-user.js';
import { AddItemDto, ChecklistDto, MarkItemDto } from '../offboarding/offboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';

// Onboarding (owner, 22 October 2026, the ATS's Phase 2; packages/shared onboarding.ts). The service checks who may do
// what: HR, the CEO and a Super Admin handle the checklists (a C-level person's only the CEO and a Super Admin); an item's
// owner opens a checklist with an item of theirs and marks it.

const MANAGERS = [...OFFBOARDING_MANAGERS];

class ListOnboardingDto {
  @IsOptional() @IsIn([...ONBOARDING_STATUSES, 'all'], { message: 'Choose open, completed or all.' })
  status?: OnboardingStatus | 'all';
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** ?status= open (the default), completed or all. */
  @Roles(...MANAGERS)
  @Get()
  list(@Query() query: ListOnboardingDto, @CurrentUser() user: SessionUser) {
    return this.onboarding.list(query.status, user);
  }

  /** HR's default items. */
  @Roles(...MANAGERS)
  @Get('checklist')
  checklist() {
    return this.onboarding.checklist();
  }

  @Roles(...MANAGERS)
  @Put('checklist')
  saveChecklist(@Body() dto: ChecklistDto, @CurrentUser() user: SessionUser) {
    return this.onboarding.saveChecklist(dto, user);
  }

  /** A person's latest checklist ({ checklist: null } without one), for their profile. */
  @Roles(...MANAGERS)
  @Get('employees/:employeeId')
  async forEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return { checklist: await this.onboarding.forEmployee(employeeId, user) };
  }

  /** Opens a checklist by hand for a current employment without one. */
  @Roles(...MANAGERS)
  @Post('employments/:employmentId')
  open(@Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.onboarding.openByHand(employmentId, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.onboarding.get(id, user);
  }

  @Patch(':id/items/:itemId')
  mark(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: MarkItemDto, @CurrentUser() user: SessionUser) {
    return this.onboarding.markItem(id, itemId, dto, user);
  }

  @Roles(...MANAGERS)
  @Post(':id/items')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemDto, @CurrentUser() user: SessionUser) {
    return this.onboarding.addItem(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.onboarding.complete(id, user);
  }
}
