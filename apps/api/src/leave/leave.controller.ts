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
  Put,
  Query,
  StreamableFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { LEAVE_DOCUMENTS_MAX } from '@trendlix/shared';
import { CurrentUser, DeletesRecords, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { DOCUMENT_UPLOAD, DocumentUploadFilter } from './documents.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveCoverageService } from './leave-coverage.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import {
  ChangeCoverDto,
  CloseYearDto,
  CoverageQueryDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  EditLeaveRequestDto,
  HrCancelLeaveDto,
  LeaveAdjustmentDto,
  LeaveCalendarQueryDto,
  LeaveYearQueryDto,
  ListLeaveRequestsDto,
  RecordLeaveRequestDto,
  StaffingLimitDto,
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
// calendar: each sees as far as they see requests. Year Closing: HR and the CEO see it, HR closes and reopens it. A
// C-level person's leave (owner, 19 October 2026: "make C level Employees details not visible to HR"): HR's stage is the
// CEO's, and HR and their manager now don't see it nor their balances (checked by the services; 404 below). Coverage
// (owner, 25 October 2026: "Warn and need HR", "Required over 2 days", "To a stand-in", "Names, no leave types"): the new
// request's as the employee types it, a request's for those who see it, what the caller covers, the employee changing
// their cover; and the teams' staffing limits, read by the staff, set by HR and a Super Admin.

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
  constructor(
    private readonly requests: LeaveRequestsService,
    private readonly coverage: LeaveCoverageService,
  ) {}

  /** ?from=&to=&typeId=&halfDay=: who of their team is off on the days, the limit, the cover and the stand-in, as typed. */
  @Get('coverage')
  formCoverage(@Query() query: CoverageQueryDto, @CurrentUser() user: SessionUser) {
    return this.coverage.formCoverage(query, user);
  }

  /** The colleagues' leave the caller covers, current or to come. */
  @Get('covering')
  covering(@CurrentUser() user: SessionUser) {
    return this.coverage.covering(user);
  }

  /** { coverId, handoverNote }: the employee changes the colleague who covers their request, or the note. */
  @Post('requests/:id/cover')
  @HttpCode(200)
  changeCover(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeCoverDto, @CurrentUser() user: SessionUser) {
    return this.requests.changeCover(id, dto, user);
  }

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
  constructor(
    private readonly requests: LeaveRequestsService,
    private readonly coverage: LeaveCoverageService,
  ) {}

  /** ?status=<a status, or waiting>&employeeId=&typeId=&from=&to=: HR and the CEO everyone's; a manager those sent to them and their team's. */
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

  /** Who else of its employee's team is off on its days: names to its employee, "leave" to an approver, types to HR and the CEO. */
  @Get(':id/coverage')
  requestCoverage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.coverage.requestCoverage(id, user);
  }

  @NotForDevelopers()
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

  /**
   * A Super Admin edits a leave in any status (owner, 26 October 2026): any of { typeId, startDate, endDate, halfDay,
   * reason, coverId } and a note. 403 for anyone else, and for a Super Admin viewing as someone.
   */
  @Patch(':id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditLeaveRequestDto, @CurrentUser() user: SessionUser) {
    return this.requests.edit(id, dto, user);
  }

  /** HR cancels an approved request: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelLeaveDto, @CurrentUser() user: SessionUser) {
    return this.requests.hrCancel(id, dto, user);
  }
}

/** The teams' staffing limits for annual leave (Organization → Leave → Staffing): the staff read them, HR and a Super Admin set them. */
@Controller('leave/staffing')
export class LeaveStaffingController {
  constructor(private readonly coverage: LeaveCoverageService) {}

  @Roles('hr', 'ceo', 'finance', 'admin')
  @Get()
  list() {
    return this.coverage.staffing();
  }

  /** { maxOff, minAtWorkPercent }: a team's (or a department's without teams); both empty removes it. */
  @Roles('hr', 'super_admin')
  @Put(':departmentId')
  set(@Param('departmentId', ParseUUIDPipe) departmentId: string, @Body() dto: StaffingLimitDto, @CurrentUser() user: SessionUser) {
    return this.coverage.setStaffing(departmentId, dto, user);
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
  view(@Param('year', ParseIntPipe) year: number, @CurrentUser() user: SessionUser) {
    return this.closing.view(year, user);
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
  @ConfidentialOf('employee')
  @Get()
  get(@Param('id', ParseUUIDPipe) id: string, @Query() query: LeaveYearQueryDto, @CurrentUser() user: SessionUser) {
    return this.requests.employeeLeave(id, query.year, user);
  }

  /** { year, days, reason }: answers the employee's leave for that year. */
  @ConfidentialOf('employee')
  @Roles('hr')
  @Post('adjustments')
  async adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveAdjustmentDto, @CurrentUser() user: SessionUser) {
    await this.balances.adjust(id, dto, await this.requests.caller(user));
    return this.requests.employeeLeave(id, dto.year, user);
  }
}
