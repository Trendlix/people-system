import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { attachment } from '../templates/template-file.js';
import type { BankFileKind } from './bank.js';
import { XLSX_TYPE } from './bank-files.js';
import { AttendanceWaiverDto, CibFileQueryDto, CreatePayrollRunDto, PaidPayrollDto, ReturnPayrollDto, UpdatePayrollLinesDto, UpdatePayrollSettingsDto } from './payroll.dto.js';
import { PayrollSettingsService } from './payroll-settings.service.js';
import { PayrollService } from './payroll.service.js';

/** A spreadsheet to download. */
const xlsx = (file: { fileName: string; data: Buffer }) => new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });

// The payroll settings: HR, Finance, the CEO and Admin read them; HR and Admin change them (Organization → Payroll
// Setup: the rules, the bank files' details and the payday).
@Controller('payroll/settings')
export class PayrollSettingsController {
  constructor(private readonly settings: PayrollSettingsService) {}

  @Roles('hr', 'finance', 'ceo', 'admin')
  @Get()
  get() {
    return this.settings.get();
  }

  @Roles('hr', 'admin')
  @Patch()
  update(@Body() dto: UpdatePayrollSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }
}

// Monthly payroll runs (owner's decisions, 16 October 2026): HR, Finance and the CEO see them (salary data, like the
// contracts' salaries; an Admin or Super Admin only with one of those roles too). HR prepares a run and marks it paid;
// the CEO alone approves it or returns it. Each answer is the run, except the files and a deletion.
@Controller('payroll/runs')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Every run, newest month first. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list() {
    return this.payroll.list();
  }

  /** A month's run: { month: 'YYYY-MM' }, from 12 months back to next month. */
  @Roles('hr')
  @Post()
  create(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: SessionUser) {
    return this.payroll.create(dto, user);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.get(id);
  }

  /** A draft's people, contracts, insured wages and rules taken again; the inputs stay. */
  @Roles('hr')
  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.refresh(id, user);
  }

  /** A draft's changed lines: { lines: [{ id, inputs?, onHold?, comments? }] }. */
  @Roles('hr')
  @Patch(':id/lines')
  updateLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayrollLinesDto, @CurrentUser() user: SessionUser) {
    return this.payroll.updateLines(id, dto, user);
  }

  @Roles('hr')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.submit(id, user);
  }

  @Roles('ceo')
  @Post(':id/return')
  @HttpCode(200)
  returnToHr(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnPayrollDto, @CurrentUser() user: SessionUser) {
    return this.payroll.returnToHr(id, dto, user);
  }

  /**
   * { waived }: the CEO waives a line's attendance deduction while the run is with the CEO, or takes the waiver back
   * (owner, 17 October 2026: "if there is an attendance deduction, allow the CEO to wave the deduction by ticking a box").
   */
  @Roles('ceo')
  @Post(':id/lines/:lineId/attendance-waiver')
  @HttpCode(200)
  waiveAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: AttendanceWaiverDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.payroll.waiveAttendance(id, lineId, dto, user);
  }

  @Roles('ceo')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.approve(id, user);
  }

  @Roles('hr')
  @Post(':id/paid')
  @HttpCode(200)
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaidPayrollDto, @CurrentUser() user: SessionUser) {
    return this.payroll.markPaid(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.remove(id, user);
  }

  /** The payroll register (.xlsx), whatever the status. */
  @Roles('hr', 'finance', 'ceo')
  @Get(':id/files/register')
  @Header('Cache-Control', 'private, no-store')
  async register(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return xlsx(await this.payroll.register(id));
  }

  /** CIB's payroll system file, once approved; ?valueDate=YYYY-MM-DD, today unless sent. */
  @Roles('hr', 'finance', 'ceo')
  @Get(':id/files/cib')
  @Header('Cache-Control', 'private, no-store')
  async cib(@Param('id', ParseUUIDPipe) id: string, @Query() query: CibFileQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    return xlsx(await this.payroll.bankFile(id, 'cib' satisfies BankFileKind, query, user));
  }

  /** The ACH file, once approved. */
  @Roles('hr', 'finance', 'ceo')
  @Get(':id/files/ach')
  @Header('Cache-Control', 'private, no-store')
  async ach(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    return xlsx(await this.payroll.bankFile(id, 'ach', {}, user));
  }
}
