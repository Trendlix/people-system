import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, StreamableFile } from '@nestjs/common';
import { CurrentUser, DeletesRecords, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { attachment } from '../templates/template-file.js';
import { BankBatchesService } from './bank-batches.service.js';
import { XLSX_TYPE } from './bank-files.js';
import { AttendanceWaiverDto, KpiWaiverDto, CreatePayrollRunDto, MakeBankBatchDto, PaidPayrollDto, ReturnPayrollDto, UpdatePayrollLinesDto, UpdatePayrollSettingsDto } from './payroll.dto.js';
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
// the CEO alone approves it or returns it. Each answer is the run, except the files and a deletion. The C-level people's
// lines (owner, 19 October 2026: "make C level Employees details not visible to HR") only for the CEO and a Super Admin,
// left out of the run and its files for anyone else; the CEO fills their inputs.
@Controller('payroll/runs')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Every run, newest month first. */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.payroll.list(user);
  }

  /** A month's run: { month: 'YYYY-MM' }, from 12 months back to next month. */
  @Roles('hr')
  @Post()
  create(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: SessionUser) {
    return this.payroll.create(dto, user);
  }

  @Roles('hr', 'finance', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.get(id, user);
  }

  /** A draft's people, contracts, insured wages and rules taken again; the inputs stay. */
  @Roles('hr')
  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.refresh(id, user);
  }

  /** Refresh from attendance (19 October 2026): the lines filled from the month's attendance days again. */
  @Roles('hr', 'ceo')
  @Post(':id/attendance-refresh')
  @HttpCode(200)
  refreshAttendance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.payroll.refreshAttendance(id, user);
  }

  /**
   * A draft's changed lines: { lines: [{ id, inputs?, onHold?, comments? }] }. HR's, and the CEO's for the C-level people's
   * lines (owner, 19 October 2026: "the CEO fills their inputs"; checked by the service, line by line).
   */
  @Roles('hr', 'ceo')
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

  /**
   * { waived }: the CEO waives a line's KPI deduction while the run is with the CEO, or takes the waiver back (owner,
   * 1 November 2026: "make a button wave KPI deduction like the attendance one").
   */
  @Roles('ceo')
  @Post(':id/lines/:lineId/kpi-waiver')
  @HttpCode(200)
  waiveKpi(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: KpiWaiverDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.payroll.waiveKpi(id, lineId, dto, user);
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
  @NotForDevelopers()
  @Get(':id/files/register')
  @Header('Cache-Control', 'private, no-store')
  async register(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    return xlsx(await this.payroll.register(id, user));
  }
}

// Bank transfer batches (owner, 5 November 2026: "allow me to select a group of people for the transfer", "and to
// confirm each batch sent to be recorded"), once the CEO approved the run: whoever makes the bank files (HR, Finance,
// the CEO) makes a batch of the people ticked for one file, downloads its file, confirms it sent to the bank, or
// discards it until then. A batch is the run's lines it pays, without the C-level people for anyone they are hidden from.
@Controller('payroll/runs')
export class PayrollBankBatchesController {
  constructor(private readonly batches: BankBatchesService) {}

  /** A batch of the lines ticked for one file: { file: 'cib' | 'ach', lineIds, valueDate? } (the CIB file's, today unless sent). */
  @Roles('hr', 'finance', 'ceo')
  @Post(':id/bank-batches')
  make(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MakeBankBatchDto, @CurrentUser() user: SessionUser) {
    return this.batches.make(id, dto, user);
  }

  /** The batch's bank file (.xlsx). */
  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get(':id/bank-batches/:batchId/file')
  @Header('Cache-Control', 'private, no-store')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    return xlsx(await this.batches.file(id, batchId, user));
  }

  /** Confirms the batch was sent to the bank. */
  @Roles('hr', 'finance', 'ceo')
  @Post(':id/bank-batches/:batchId/sent')
  @HttpCode(200)
  sent(@Param('id', ParseUUIDPipe) id: string, @Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser() user: SessionUser) {
    return this.batches.sent(id, batchId, user);
  }

  /** Discards a batch not sent to the bank. */
  @Roles('hr', 'finance', 'ceo')
  @Delete(':id/bank-batches/:batchId')
  @HttpCode(204)
  discard(@Param('id', ParseUUIDPipe) id: string, @Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser() user: SessionUser) {
    return this.batches.discard(id, batchId, user);
  }
}
