import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateContractDto, ListContractsDto, SignContractDto, UpdateContractDto, WithinDto } from './contracts.dto.js';
import { ContractsService } from './contracts.service.js';

// Contracts under each employment, the company-wide list, and the alerts for HR and the CEO (contracts ending,
// probations ending). HR adds, changes and signs contracts; anyone who may see the employment reads them, the salary
// only HR, Finance and the CEO.
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('employees/:id/employments/:employmentId/contracts')
  list(@Param('id', ParseUUIDPipe) id: string, @Param('employmentId', ParseUUIDPipe) employmentId: string, @CurrentUser() user: SessionUser) {
    return this.contracts.list(id, employmentId, user);
  }

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
  expiring(@Query() query: WithinDto) {
    return this.contracts.expiring(query.within ?? 60);
  }

  @Roles('hr')
  @Patch('contracts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto, @CurrentUser() user: SessionUser) {
    return this.contracts.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete('contracts/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.contracts.remove(id, user);
  }

  @Roles('hr')
  @Post('contracts/:id/sign')
  @HttpCode(200)
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SignContractDto, @CurrentUser() user: SessionUser) {
    return this.contracts.sign(id, dto, user);
  }

  /** Current employments whose probation ends within `within` days (30 unless sent). */
  @Roles('hr', 'ceo')
  @Get('employments/probation-ending')
  probationEnding(@Query() query: WithinDto) {
    return this.contracts.probationEnding(query.within ?? 30);
  }
}
