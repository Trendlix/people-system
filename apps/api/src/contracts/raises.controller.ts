import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { RaiseRequestsService } from './raise-requests.service.js';
import {
  ApproveRaiseDto,
  ApproveRaiseRequestDto,
  CreateRaiseDto,
  CreateRaiseRequestDto,
  ListRaiseRequestsDto,
  RaiseCommentDto,
  RaiseForm2Dto,
  SendRaiseDto,
  UpdateRaiseDto,
} from './raises.dto.js';
import { RaisesService } from './raises.service.js';
import { SalaryHistoryService } from './salary-history.service.js';

// Pay raises during a contract, the salary history and raise requests (owner's decisions, 16 October 2026). HR enters
// a raise and sends it; the CEO alone decides it, and a renewal with new pay the same way (a raise's id is its contract
// version's: it is signed and deleted as a contract); HR records Form 2. Anyone may ask for a raise who is the employee,
// their direct manager or HR (checked by the service). Since 17 October 2026 ("Approve - Approve with another raise
// amount or percentge - Reject, and add a comment"): HR approves a request (as suggested or with another raise, which
// prepares the raise and sends it to the CEO) or rejects it, and the CEO approves a raise (as it reached them or with
// another raise), rejects it or returns it to HR, each with a comment. Each answer is the raise (its contract version)
// or the request, as the caller may see it. A C-level person's (owner, 19 October 2026: "make C level Employees details
// not visible to HR") only for the CEO, a Super Admin and themself: 404 for anyone else, left out of the lists; their
// request's HR step is the CEO's (or HR's with Super Admin).
@Controller()
export class RaisesController {
  constructor(
    private readonly raises: RaisesService,
    private readonly requests: RaiseRequestsService,
    private readonly history: SalaryHistoryService,
  ) {}

  @ConfidentialOf('employee')
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

  @ConfidentialOf('contract')
  @Roles('hr')
  @Patch('raises/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRaiseDto, @CurrentUser() user: SessionUser) {
    return this.raises.update(id, dto, user);
  }

  /** { comment? }: a note to the CEO, e.g. on a raise the CEO returned. */
  @ConfidentialOf('contract')
  @Roles('hr')
  @Post('raises/:id/send')
  @HttpCode(200)
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendRaiseDto, @CurrentUser() user: SessionUser) {
    return this.raises.send(id, dto, user);
  }

  /**
   * The CEO only (owner's decision, 16 October 2026: "HR, then the CEO"): { comment } approves it as it reached them;
   * with { increaseAmount } or { increasePercent } too, with another raise over the pay before it.
   */
  @ConfidentialOf('contract')
  @Roles('ceo')
  @Post('raises/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveRaiseDto, @CurrentUser() user: SessionUser) {
    return this.raises.approve(id, dto, user);
  }

  /** { comment } (or { reason }): HR alone sees it. */
  @ConfidentialOf('contract')
  @Roles('ceo')
  @Post('raises/:id/return')
  @HttpCode(200)
  returnToHr(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseCommentDto, @CurrentUser() user: SessionUser) {
    return this.raises.returnToHr(id, dto, user);
  }

  /** The CEO rejects it, { comment } (or { reason }): the draft goes; the request it came from is declined. Answers 204. */
  @ConfidentialOf('contract')
  @Roles('ceo')
  @Post('raises/:id/decline')
  @HttpCode(204)
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseCommentDto, @CurrentUser() user: SessionUser) {
    return this.raises.decline(id, dto, user);
  }

  /** Form 2 filed: { form2From: 'YYYY-MM-01' } (null: none filed after all). */
  @ConfidentialOf('contract')
  @Roles('hr')
  @Patch('raises/:id/form2')
  form2(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseForm2Dto, @CurrentUser() user: SessionUser) {
    return this.raises.form2(id, dto, user);
  }

  /** The salary history of each of the employee's employments: HR, Finance and the CEO, as salaries. */
  @ConfidentialOf('employee')
  @Roles('hr', 'finance', 'ceo')
  @Get('employees/:id/salary-history')
  salaryHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.history.history(id, user);
  }

  // ---------- raise requests ----------

  /** By the employee themself, their direct manager or HR (checked by the service). */
  @ConfidentialOf('employee')
  @Post('employees/:id/raise-requests')
  request(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRaiseRequestDto, @CurrentUser() user: SessionUser) {
    return this.requests.create(id, dto, user);
  }

  /** The employee's requests as the caller may see them, and whether the caller may ask for one now. */
  @ConfidentialOf('employee')
  @Get('employees/:id/raise-requests')
  employeeRequests(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.forEmployee(id, user);
  }

  /** The Raise Requests page: every request, of a status unless all. */
  @Roles('hr', 'ceo', 'finance')
  @Get('raise-requests')
  list(@Query() query: ListRaiseRequestsDto, @CurrentUser() user: SessionUser) {
    return this.requests.list(query.status, user);
  }

  /**
   * HR approves a request as suggested or with another raise, with a comment, the way and the effective date: the raise
   * is prepared from it and sent to the CEO. Answers the request, with its log. A C-level person's request: the CEO
   * takes HR's step (owner, 19 October 2026), or HR with Super Admin; never one's own (checked by the service).
   */
  @ConfidentialOf('raiseRequest')
  @Roles('hr', 'ceo')
  @Post('raise-requests/:id/approve')
  @HttpCode(200)
  async approveRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveRaiseRequestDto, @CurrentUser() user: SessionUser) {
    await this.requests.assertDecidesHrStep(id, user);
    await this.raises.approveRequest(id, dto, user);
    return this.requests.one(id, user);
  }

  /** HR rejects a request, { comment } (or { reason }); a C-level person's, the CEO (or HR with Super Admin). */
  @ConfidentialOf('raiseRequest')
  @Roles('hr', 'ceo')
  @Post('raise-requests/:id/decline')
  @HttpCode(200)
  declineRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RaiseCommentDto, @CurrentUser() user: SessionUser) {
    return this.requests.decline(id, dto, user);
  }
}
