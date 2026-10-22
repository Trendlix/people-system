import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { OffboardingReportsService } from './offboarding-reports.service.js';
import { OffboardingService } from './offboarding.service.js';
import {
  AddItemDto,
  ChecklistDto,
  CompleteCaseDto,
  DeclineInterviewDto,
  ExitInterviewDto,
  FormerQueryDto,
  ListCasesDto,
  MarkItemDto,
  OpenCaseDto,
  RehireCheckDto,
  RehireDto,
  TurnoverQueryDto,
} from './offboarding.dto.js';

// Offboarding (owner, 22 October 2026: the full module; packages/shared offboarding.ts). The cases: listed and read by
// HR, the CEO and a Super Admin, and by those who clear one of a case's items (a direct manager, an Admin, Finance, the
// Assets custodians: the service checks which); a C-level person's by the CEO and a Super Admin only (404 for anyone
// else). Opening by hand, completing, one-off items, the exit interview recorded by HR and rehire eligibility are for
// HR, the CEO and a Super Admin; the default checklist, Former Employees, the turnover and the rehire check too. The
// leaver's own exit interview is under /offboarding/my, for anyone signed in (the service finds their open case).

const MANAGERS = ['hr', 'ceo', 'super_admin'] as const;

@Controller('offboarding')
export class OffboardingController {
  constructor(
    private readonly offboarding: OffboardingService,
    private readonly reports: OffboardingReportsService,
  ) {}

  /** Open cases unless ?status= says otherwise (open, completed, cancelled, all). */
  @Get('cases')
  list(@Query() query: ListCasesDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.list(query.status, user);
  }

  @Roles(...MANAGERS)
  @Post('cases')
  open(@Body() dto: OpenCaseDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.openByHand(dto.employmentId, user);
  }

  @Get('cases/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.offboarding.get(id, user);
  }

  /** A person's latest case, for their profile: { case } (null without one). */
  @Roles(...MANAGERS)
  @Get('employees/:employeeId')
  async forEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return { case: await this.offboarding.forEmployee(employeeId, user) };
  }

  /** Clears an item, or puts it back to pending: its owner, or HR, the CEO, a Super Admin (the service checks). */
  @Patch('cases/:id/items/:itemId')
  mark(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: MarkItemDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.markItem(id, itemId, dto, user);
  }

  @Roles(...MANAGERS)
  @Post('cases/:id/items')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.addItem(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Post('cases/:id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteCaseDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.complete(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Put('cases/:id/rehire')
  rehire(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RehireDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.setRehire(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Put('cases/:id/exit-interview')
  recordInterview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExitInterviewDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.recordInterview(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Post('cases/:id/exit-interview/decline')
  @HttpCode(200)
  declineInterview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineInterviewDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.declineInterview(id, dto, user);
  }

  /** The caller's own exit interview while their case is open: null without one. */
  @Get('my/exit-interview')
  async mine(@CurrentUser() user: SessionUser) {
    return { interview: await this.offboarding.mine(user) };
  }

  @Put('my/exit-interview')
  async submitMine(@Body() dto: ExitInterviewDto, @CurrentUser() user: SessionUser) {
    return { interview: await this.offboarding.submitMine(dto, user) };
  }

  @Post('my/exit-interview/decline')
  @HttpCode(200)
  async declineMine(@Body() dto: DeclineInterviewDto, @CurrentUser() user: SessionUser) {
    return { interview: await this.offboarding.declineMine(dto, user) };
  }

  @Roles(...MANAGERS)
  @Get('checklist')
  checklist() {
    return this.offboarding.checklist();
  }

  @Roles(...MANAGERS)
  @Put('checklist')
  saveChecklist(@Body() dto: ChecklistDto, @CurrentUser() user: SessionUser) {
    return this.offboarding.saveChecklist(dto, user);
  }

  @Roles(...MANAGERS)
  @Get('former')
  former(@Query() query: FormerQueryDto, @CurrentUser() user: SessionUser) {
    return this.reports.former(query, user);
  }

  @Roles(...MANAGERS)
  @Get('turnover')
  turnover(@Query() query: TurnoverQueryDto, @CurrentUser() user: SessionUser) {
    return this.reports.turnover(query.year, user);
  }

  /** The year's turnover as an Excel workbook: "Turnover 2026.xlsx". */
  @Roles(...MANAGERS)
  @Get('turnover/export')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query() query: TurnoverQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.reports.turnoverWorkbook(query.year, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** The former employees an offer or a new employment may be for again: ?employeeId=, ?email=, ?nationalId=. */
  @Roles(...MANAGERS)
  @Get('rehire-check')
  rehireCheck(@Query() query: RehireCheckDto, @CurrentUser() user: SessionUser) {
    return this.reports.rehireCheck(query, user);
  }
}
