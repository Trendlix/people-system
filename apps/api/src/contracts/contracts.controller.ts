import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, SetMetadata } from '@nestjs/common';
import { CurrentUser, DeletesRecords, FORBIDDEN_MESSAGE, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { CreateContractDto, ListContractsDto, SignContractDto, UpdateContractDto, WithinDto } from './contracts.dto.js';
import { ContractsService, ONLY_SUPER_ADMIN_UNSIGNS } from './contracts.service.js';

// Contracts under each employment, the company-wide list, and the alerts for HR and the CEO (contracts ending,
// probations ending). HR adds, changes and signs contracts; anyone who may see the employment reads them, the salary
// only HR, Finance and the CEO. A C-level person's (owner, 19 October 2026: "make C level Employees details not visible
// to HR") only for the CEO and a Super Admin: 404 for anyone else, and left out of the lists and alerts.
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @ConfidentialOf('employee')
  @Get('employees/:id/employments/:employmentId/contracts')
  list(@Param('id', ParseUUIDPipe) id: string, @Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.contracts.list(id, employmentId, user);
  }

  @ConfidentialOf('employee')
  @Roles('hr')
  @Post('employees/:id/employments/:employmentId/contracts')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Body() dto: CreateContractDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.contracts.create(id, employmentId, dto, user);
  }

  /**
   * Every contract in the company, for the Contracts page: HR, Finance and the CEO (an Admin or Super Admin only with
   * one of those roles too). Draft and active unless ?status= is sent; ?q=, ?form=, ?type= and ?endingWithin= filter.
   */
  @Roles('hr', 'ceo', 'finance')
  @Get('contracts')
  listAll(@Query() query: ListContractsDto, @CurrentUser() user: SessionUser) {
    return this.contracts.listAll(query, user);
  }

  /** Signed fixed-term contracts ending within `within` days (60 unless sent). */
  @Roles('hr', 'ceo')
  @Get('contracts/expiring')
  expiring(@Query() query: WithinDto, @CurrentUser() user: SessionUser) {
    return this.contracts.expiring(query.within ?? 60, user);
  }

  /**
   * The labour law's warnings for HR's dashboard (owner, 18 October 2026): fixed terms become open-ended (Art. 88(3)) and
   * casual work past six months (Art. 1(7)).
   */
  @Roles('hr', 'ceo')
  @Get('contracts/law-warnings')
  lawWarnings(@CurrentUser() user: SessionUser) {
    return this.contracts.lawWarnings(user);
  }

  @ConfidentialOf('contract')
  @Roles('hr')
  @Patch('contracts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto, @CurrentUser() user: SessionUser) {
    return this.contracts.update(id, dto, user);
  }

  @ConfidentialOf('contract')
  @DeletesRecords()
  @Delete('contracts/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.contracts.remove(id, user);
  }

  @ConfidentialOf('contract')
  @Roles('hr')
  @Post('contracts/:id/sign')
  @HttpCode(200)
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SignContractDto, @CurrentUser() user: SessionUser) {
    return this.contracts.sign(id, dto, user);
  }

  /** Undoes a signing recorded by mistake: the contract is a draft again. A Super Admin only. */
  @ConfidentialOf('contract')
  @Roles('super_admin')
  @SetMetadata(FORBIDDEN_MESSAGE, ONLY_SUPER_ADMIN_UNSIGNS)
  @Post('contracts/:id/unsign')
  @HttpCode(200)
  unsign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.contracts.unsign(id, user);
  }

  /** Current employments whose probation ends within `within` days (30 unless sent). */
  @Roles('hr', 'ceo')
  @Get('employments/probation-ending')
  probationEnding(@Query() query: WithinDto, @CurrentUser() user: SessionUser) {
    return this.contracts.probationEnding(query.within ?? 30, user);
  }
}
