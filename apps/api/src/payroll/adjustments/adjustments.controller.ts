import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import {
  AdjustmentChoicesQueryDto,
  AdjustmentsQueryDto,
  AdvancesQueryDto,
  CreateAdjustmentDto,
  CreateAdvanceDto,
  MoveAdjustmentsDto,
  SettleAdvanceDto,
  UpdateAdjustmentDto,
  UpdateAdvanceDto,
} from './adjustments.dto.js';
import { AdjustmentsService } from './adjustments.service.js';
import { AdvancesService } from './advances.service.js';

// Additions / Deductions (owner, 17 October 2026): salary data, so HR, Finance and the CEO see them, like the payroll
// lines (an Admin or Super Admin only with one of those roles too); HR enters, changes and cancels them. Each answer is
// the addition or deduction, or the list.
@Controller('payroll/adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  /** ?month=YYYY-MM&employeeId=&kind=addition|deduction&type=&status=pending|applied|cancelled, each optional. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list(@Query() query: AdjustmentsQueryDto) {
    return this.adjustments.list(query);
  }

  /** ?month=YYYY-MM: the month's run and whether it is locked, who is employed in it, their open advances and loans. */
  @Roles('hr', 'finance', 'ceo')
  @Get('choices')
  choices(@Query() query: AdjustmentChoicesQueryDto) {
    return this.adjustments.choices(query);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.adjustments.get(id);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateAdjustmentDto, @CurrentUser() user: SessionUser) {
    return this.adjustments.create(dto, user);
  }

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdjustmentDto, @CurrentUser() user: SessionUser) {
    return this.adjustments.update(id, dto, user);
  }

  /** { ids, month }: pending ones moved to another month, those left on a month approved without them to a later one. */
  @Roles('hr')
  @Post('move')
  @HttpCode(200)
  move(@Body() dto: MoveAdjustmentsDto, @CurrentUser() user: SessionUser) {
    return this.adjustments.move(dto, user);
  }

  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.adjustments.cancel(id, user);
  }
}

// Advances and loans (owner, 17 October 2026: on Unsettled "advances and loans (still being recovered)"): HR, Finance
// and the CEO see them; HR records them, changes an open one and marks one settled with a note.
@Controller('payroll/advances')
export class AdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  /** ?employeeId=&status=open|settled, each optional: the open ones first. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list(@Query() query: AdvancesQueryDto) {
    return this.advances.list(query);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.advances.get(id);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.advances.create(dto, user);
  }

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.advances.update(id, dto, user);
  }

  @Roles('hr')
  @Post(':id/settle')
  @HttpCode(200)
  settle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.advances.settle(id, dto, user);
  }
}
