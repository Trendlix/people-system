import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { RaiseRequestsService } from './raise-requests.service.js';
import { CreateRaiseDto, CreateRaiseRequestDto, ListRaiseRequestsDto, RaiseForm2Dto, RaiseReasonDto, UpdateRaiseDto } from './raises.dto.js';
import { RaisesService } from './raises.service.js';
import { SalaryHistoryService } from './salary-history.service.js';

// Pay raises during a contract, the salary history and raise requests (owner's decisions, 16 October 2026). HR enters
// a raise (also from a request) and sends it; the CEO alone approves, returns or declines it, and a renewal with new pay
// the same way (a raise's id is its contract version's: it is signed and deleted as a contract); HR records Form 2.
// Anyone may ask for a raise who is the employee, their direct manager or HR (checked by the service); HR declines a
// request. Each answer is the raise (its contract version) or the request, as the caller may see it.
@Controller()
export class RaisesController {
  constructor(
    private readonly raises: RaisesService,
    private readonly requests: RaiseRequestsService,
    private readonly history: SalaryHistoryService,
  ) {}

  @Roles('hr')
  @Post('employees/:id/employments/:employmentId/raises')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Body() dto: CreateRaiseDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.raises.create(id, employmentId, dto, user);
  }

  /** The changes of pay waiting for the CEO, for Approvals: the CEO decides, HR follows them. */
  @Roles('hr', 'ceo')
  @Get('raises/pending')
  pending(@CurrentUser() user: SessionUser) {
    return this.raises.pending(user);
  }

  @Roles('hr')
  @Patch('raises/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRaiseDto, @CurrentUser() user: SessionUser) {
    return this.raises.update(id, dto, user);
  }

  @Roles('hr')
  @Post('raises/:id/send')
  @HttpCode(200)
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.raises.send(id, user);
  }

  /** The CEO only (owner's decision, 16 October 2026: "HR, then the CEO"). */
  @Roles('ceo')
  @Post('raises/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.raises.approve(id, user);
  }

  @Roles('ceo')
  @Post('raises/:id/return')
  @HttpCode(200)
  returnToHr(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseReasonDto, @CurrentUser() user: SessionUser) {
    return this.raises.returnToHr(id, dto, user);
  }

  /** The draft goes; the request it came from is declined. Answers 204. */
  @Roles('ceo')
  @Post('raises/:id/decline')
  @HttpCode(204)
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseReasonDto, @CurrentUser() user: SessionUser) {
    return this.raises.decline(id, dto, user);
  }

  /** Form 2 filed: { form2From: 'YYYY-MM-01' } (null: none filed after all). */
  @Roles('hr')
  @Patch('raises/:id/form2')
  form2(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseForm2Dto, @CurrentUser() user: SessionUser) {
    return this.raises.form2(id, dto, user);
  }

  /** The salary history of each of the employee's employments: HR, Finance and the CEO, as salaries. */
  @Roles('hr', 'finance', 'ceo')
  @Get('employees/:id/salary-history')
  salaryHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.history.history(id, user);
  }

  // ---------- raise requests ----------

  /** By the employee themself, their direct manager or HR (checked by the service). */
  @Post('employees/:id/raise-requests')
  request(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRaiseRequestDto, @CurrentUser() user: SessionUser) {
    return this.requests.create(id, dto, user);
  }

  /** The employee's requests as the caller may see them, and whether the caller may ask for one now. */
  @Get('employees/:id/raise-requests')
  employeeRequests(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.forEmployee(id, user);
  }

  /** The Raise Requests page: every request, of a status unless all. */
  @Roles('hr', 'ceo', 'finance')
  @Get('raise-requests')
  list(@Query() query: ListRaiseRequestsDto) {
    return this.requests.list(query.status);
  }

  @Roles('hr')
  @Post('raise-requests/:id/decline')
  @HttpCode(200)
  declineRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseReasonDto, @CurrentUser() user: SessionUser) {
    return this.requests.decline(id, dto, user);
  }
}
