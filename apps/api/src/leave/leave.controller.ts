import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { LEAVE_DOCUMENTS_MAX } from '@trendlix/shared';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { DOCUMENT_UPLOAD, DocumentUploadFilter } from './documents.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import {
  CloseYearDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  HrCancelLeaveDto,
  LeaveAdjustmentDto,
  LeaveCalendarQueryDto,
  LeaveYearQueryDto,
  ListLeaveRequestsDto,
  RecordLeaveRequestDto,
  UpdateLeaveSettingsDto,
  UpdateLeaveTypeDto,
} from './leave.dto.js';
import { YearClosingService } from './year-closing.service.js';

// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"). Leave Setup: everyone signed in reads
// the types on and the annual leave's numbers; HR changes them; HR, the CEO and Admins read every type; only a Super
// Admin deletes one, one never asked for. The employee's own: their balances, their requests, a new one with its
// documents, and cancelling one. Deciding and seeing them: the request's direct manager and HR in turn, the CEO reading
// (checked by the service, which tells anyone else a request isn't there); HR records leave on an employee's behalf and
// cancels approved leave. An employee's leave: HR, the CEO, Finance, the employee and their manager; HR adjusts it. The
// calendar: each sees as far as they see requests. Year Closing: HR and the CEO see it, HR closes and reopens it.

@Controller('leave/types')
export class LeaveTypesController {
  constructor(private readonly types: LeaveTypesService) {}

  /** The types on, for anyone signed in; HR, the CEO and Admins every type, with how many requests each has. */
  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.types.list(user);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateLeaveTypeDto, @CurrentUser() user: SessionUser) {
    return this.types.create(dto, user);
  }

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeaveTypeDto, @CurrentUser() user: SessionUser) {
    return this.types.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.types.remove(id, user);
  }
}

@Controller('leave/settings')
export class LeaveSettingsController {
  constructor(private readonly types: LeaveTypesService) {}

  @Get()
  get() {
    return this.types.settings();
  }

  @Roles('hr')
  @Patch()
  update(@Body() dto: UpdateLeaveSettingsDto, @CurrentUser() user: SessionUser) {
    return this.types.updateSettings(dto, user);
  }
}

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/leave')
export class MyLeaveController {
  constructor(private readonly requests: LeaveRequestsService) {}

  /** ?year=: this year in Cairo unless sent. */
  @Get('balances')
  balances(@Query() query: LeaveYearQueryDto, @CurrentUser() user: SessionUser) {
    return this.requests.myBalances(query.year, user);
  }

  @Get('requests')
  mine(@CurrentUser() user: SessionUser) {
    return this.requests.mine(user);
  }

  /** A form: typeId, startDate, endDate, halfDay, reason, and up to LEAVE_DOCUMENTS_MAX files as `documents`. */
  @Post('requests')
  @UseFilters(DocumentUploadFilter)
  @UseInterceptors(FilesInterceptor('documents', LEAVE_DOCUMENTS_MAX + 1, DOCUMENT_UPLOAD))
  create(@Body() dto: CreateLeaveRequestDto, @UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: SessionUser) {
    return this.requests.create(dto, files, user);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.cancelMine(id, user);
  }
}

@Controller('leave/requests')
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}

  /** ?status=<a status, or waiting>&employeeId=&from=&to=: HR and the CEO everyone's; a manager those sent to them and their team's. */
  @Get()
  list(@Query() query: ListLeaveRequestsDto, @CurrentUser() user: SessionUser) {
    return this.requests.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  counts(@CurrentUser() user: SessionUser) {
    return this.requests.counts(user);
  }

  /** HR records leave on an employee's behalf, approved at once: a form as the employee's, with employeeId. */
  @Roles('hr')
  @Post()
  @UseFilters(DocumentUploadFilter)
  @UseInterceptors(FilesInterceptor('documents', LEAVE_DOCUMENTS_MAX + 1, DOCUMENT_UPLOAD))
  record(@Body() dto: RecordLeaveRequestDto, @UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: SessionUser) {
    return this.requests.record(dto, files, user);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.requests.one(id, user);
  }

  @Get(':id/documents/:documentId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async document(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.requests.document(id, documentId, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
  }

  /** { decision: approve | reject, comment? (required to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: SessionUser) {
    return this.requests.decide(id, dto, user);
  }

  /** HR cancels an approved request: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelLeaveDto, @CurrentUser() user: SessionUser) {
    return this.requests.hrCancel(id, dto, user);
  }
}

@Controller('leave/calendar')
export class LeaveCalendarController {
  constructor(private readonly requests: LeaveRequestsService) {}

  /** ?from=&to=&departmentId=: who is off, approved (and being decided, for HR). */
  @Get()
  calendar(@Query() query: LeaveCalendarQueryDto, @CurrentUser() user: SessionUser) {
    return this.requests.calendar(query, user);
  }
}

@Controller('leave/year-closing')
export class YearClosingController {
  constructor(private readonly closing: YearClosingService) {}

  @Roles('hr', 'ceo')
  @Get(':year')
  view(@Param('year', ParseIntPipe) year: number) {
    return this.closing.view(year);
  }

  /** { rows: { employeeId, carry, pay }[] }: every employee employed at the year's end. */
  @Roles('hr')
  @Post(':year')
  @HttpCode(200)
  close(@Param('year', ParseIntPipe) year: number, @Body() dto: CloseYearDto, @CurrentUser() user: SessionUser) {
    return this.closing.close(year, dto, user);
  }

  @Roles('hr')
  @Post(':year/reopen')
  @HttpCode(200)
  reopen(@Param('year', ParseIntPipe) year: number, @CurrentUser() user: SessionUser) {
    return this.closing.reopen(year, user);
  }
}

@Controller('employees/:id/leave')
export class EmployeeLeaveController {
  constructor(
    private readonly requests: LeaveRequestsService,
    private readonly balances: LeaveBalancesService,
  ) {}

  /** ?year=: the balances as the employee's own, with their requests that touch the year. */
  @Get()
  get(@Param('id', ParseUUIDPipe) id: string, @Query() query: LeaveYearQueryDto, @CurrentUser() user: SessionUser) {
    return this.requests.employeeLeave(id, query.year, user);
  }

  /** { year, days, reason }: answers the employee's leave for that year. */
  @Roles('hr')
  @Post('adjustments')
  async adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveAdjustmentDto, @CurrentUser() user: SessionUser) {
    await this.balances.adjust(id, dto, await this.requests.caller(user));
    return this.requests.employeeLeave(id, dto.year, user);
  }
}
