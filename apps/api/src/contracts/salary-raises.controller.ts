import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { SalaryRaisesQueryDto } from './raises.dto.js';
import { SalaryRaisesService } from './salary-raises.service.js';

// The Salary Raises report (owner's decision, 16 October 2026): salary data, so HR, Finance and the CEO only, as the
// Salary History (an Admin or Super Admin only with one of those roles too). ?from=YYYY-MM&to=YYYY-MM, this calendar
// year unless sent.
@Controller('reports')
export class SalaryRaisesController {
  constructor(private readonly salaryRaises: SalaryRaisesService) {}

  /** { generatedAt, period, reviewMonths, raises, totals, byDepartment, dueForReview, confidentialExcluded } (packages/shared salary-raises.ts). */
  @Roles('hr', 'finance', 'ceo')
  @Get('salary-raises')
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: SalaryRaisesQueryDto, @CurrentUser() user: SessionUser) {
    return this.salaryRaises.report(query, user);
  }

  /** The same as an Excel workbook: "Salary raises 2026-01 to 2026-12.xlsx". */
  @Roles('hr', 'finance', 'ceo')
  @Get('salary-raises.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: SalaryRaisesQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.salaryRaises.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
