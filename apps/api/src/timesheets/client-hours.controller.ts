import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { READS_ACCOUNTS } from '../client-accounts/client-accounts.service.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { ClientHoursQueryDto } from './client-hours.dto.js';
import { ClientHoursService } from './client-hours.service.js';

// Client hours (owner, 4 November 2026: "Full salary, hours tracked"; packages/shared timesheets.ts): a month's hours
// logged on timesheets by client account and person, for HR, the CEO, Finance and a Super Admin (who read the client
// accounts), and the same as an Excel workbook (never for a developer).
@Controller('reports')
export class ClientHoursController {
  constructor(private readonly clientHours: ClientHoursService) {}

  /** ?month=YYYY-MM: { month, generatedAt, groups, total, hiddenPeople } (packages/shared timesheets.ts). */
  @Roles(...READS_ACCOUNTS)
  @Get('client-hours')
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: ClientHoursQueryDto, @CurrentUser() user: SessionUser) {
    return this.clientHours.report(query, user);
  }

  /** The same as an Excel workbook: "Client hours 2026-11.xlsx", with every line. Never for a developer. */
  @Roles(...READS_ACCOUNTS)
  @NotForDevelopers()
  @Get('client-hours.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: ClientHoursQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.clientHours.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
