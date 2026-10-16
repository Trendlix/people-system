import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { attachment } from '../../templates/template-file.js';
import { XLSX_TYPE } from '../bank-files.js';
import { StatisticsQueryDto } from './statistics.dto.js';
import { PayrollStatisticsService } from './statistics.service.js';

// Payroll statistics (owner, 17 October 2026: "Reports (Statistics)" under Payroll): salary data, restricted like the
// payroll register, so HR, Finance and the CEO (an Admin or Super Admin only with one of those roles too).
// ?from=YYYY-MM&to=YYYY-MM, this calendar year unless sent.
@Controller('payroll/statistics')
export class PayrollStatisticsController {
  constructor(private readonly statistics: PayrollStatisticsService) {}

  /** { generatedAt, period, months, without, totals, byDepartment, yearToDate } (packages/shared payroll-statistics.ts). */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: StatisticsQueryDto) {
    return this.statistics.report(query);
  }

  /** The same as an Excel workbook: "Payroll statistics 2026-01 to 2026-12.xlsx". */
  @Roles('hr', 'finance', 'ceo')
  @Get('workbook')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: StatisticsQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.statistics.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
