import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import {
  AdjustmentChoicesQueryDto,
  AdjustmentsQueryDto,
  AdvancesQueryDto,
  ChangeInstallmentDto,
  ChangeRecurringDeductionDto,
  CreateAdjustmentDto,
  CreateAdvanceDto,
  CreateRecurringDeductionDto,
  InstallmentLimitQueryDto,
  MoveAdjustmentsDto,
  PostponeInstallmentDto,
  RecurringDeductionsQueryDto,
  SettleAdvanceDto,
  StopRecurringDeductionDto,
  UpdateAdjustmentDto,
  UpdateAdvanceDto,
  UpdateRecurringDeductionDto,
} from './adjustments.dto.js';
import { AdjustmentsService } from './adjustments.service.js';
import { AdvancesService } from './advances.service.js';
import { DeductionPlansService } from './deduction-plans.service.js';
import { InstallmentsService } from './installments.service.js';
import { RecurringDeductionsService } from './recurring.service.js';

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
// and the CEO see them; HR records them, changes an open one and marks one settled with a note. Their installments
// (owner, 18 October 2026): made at once when HR records one with { installments: { count, firstMonth } }; HR moves one
// to a later month or changes one's amount; the plan form warns past Payroll Setup's share of the pay (limit). Each
// answer is the advance or loan, with its installments.
@Controller('payroll/advances')
export class AdvancesController {
  constructor(
    private readonly advances: AdvancesService,
    private readonly installments: InstallmentsService,
  ) {}

  /** ?employeeId=&status=open|settled, each optional: the open ones first. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list(@Query() query: AdvancesQueryDto) {
    return this.advances.list(query);
  }

  /** ?employeeId=: { gross, percent, byMonth }, for the plan form's share of pay warning. Before :id. */
  @Roles('hr', 'finance', 'ceo')
  @Get('limit')
  limit(@Query() query: InstallmentLimitQueryDto) {
    return this.installments.limit(query.employeeId);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.advances.get(id);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.installments.create(dto, user);
  }

  /** { month }: that installment and every later pending one move a month on. */
  @Roles('hr')
  @Post(':id/installments/postpone')
  @HttpCode(200)
  postpone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostponeInstallmentDto, @CurrentUser() user: SessionUser) {
    return this.installments.postpone(id, dto, user);
  }

  /** { month, amount }: that installment's amount; the later pending ones share what is left. */
  @Roles('hr')
  @Post(':id/installments/change')
  @HttpCode(200)
  change(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeInstallmentDto, @CurrentUser() user: SessionUser) {
    return this.installments.change(id, dto, user);
  }

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.advances.update(id, dto, user);
  }

  /** { how?: final_settlement | waived | paid_back (the default), note }: a note required but deducted from the final settlement. */
  @Roles('hr')
  @Post(':id/settle')
  @HttpCode(200)
  settle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleAdvanceDto, @CurrentUser() user: SessionUser) {
    return this.installments.settle(id, dto, user);
  }
}

// Recurring deductions (owner, 18 October 2026, e.g. a medical subscription's share): salary data, so HR, Finance and
// the CEO see them; HR sets one up, changes its amount from a month on (answering the new one), stops it, renames it or
// changes its last month. Each answer is the recurring deduction, or the list.
@Controller('payroll/recurring-deductions')
export class RecurringDeductionsController {
  constructor(private readonly recurring: RecurringDeductionsService) {}

  /** ?employeeId=&status=running|ended, each optional: running lists those still to come too. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list(@Query() query: RecurringDeductionsQueryDto) {
    return this.recurring.list(query);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.get(id);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateRecurringDeductionDto, @CurrentUser() user: SessionUser) {
    return this.recurring.create(dto, user);
  }

  /** { amount, fromMonth }: this one stops then, a new one starts then; answers the new one. */
  @Roles('hr')
  @Post(':id/change')
  @HttpCode(200)
  change(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRecurringDeductionDto, @CurrentUser() user: SessionUser) {
    return this.recurring.change(id, dto, user);
  }

  /** { fromMonth, note? }: the first month no longer deducted. */
  @Roles('hr')
  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StopRecurringDeductionDto, @CurrentUser() user: SessionUser) {
    return this.recurring.stop(id, dto, user);
  }

  /** { name?, endMonth? }. */
  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurringDeductionDto, @CurrentUser() user: SessionUser) {
    return this.recurring.update(id, dto, user);
  }
}

// The employee's own loans and deductions (owner, 18 October 2026): on their profile's Salary sub-tab. HR, Finance and
// the CEO, and the employee themself (checked by the service).
@Controller('employees')
export class DeductionPlansController {
  constructor(private readonly plans: DeductionPlansService) {}

  @Get(':id/deduction-plans')
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.plans.forEmployee(id, user);
  }
}
