import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateContractDto, SignContractDto, UpdateContractDto, WithinDto } from './contracts.dto.js';
import { ContractsService } from './contracts.service.js';

// Contracts under each employment, and the alerts for HR and the CEO (contracts ending, probations ending). HR adds,
// changes and signs contracts; anyone who may see the employment reads them, the salary only HR, Finance and the CEO.
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

  @Roles('hr')
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
