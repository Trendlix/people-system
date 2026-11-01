import { Body, Controller, Get, Header, HttpCode, Post, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { EmployeeBulkDto } from './employee-bulk.dto.js';
import { EmployeeBulkService } from './employee-bulk.service.js';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions"): HR, an Admin
// and the CEO, as the access hold; the employment's changes HR's only (the service says so); each person's checked by
// its own service. The export of the chosen people: never a developer's (a file).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('employees')
export class EmployeeBulkController {
  constructor(private readonly bulk: EmployeeBulkService) {}

  /** { action, employeeIds, … }: the action for each; who it was done for, and who was skipped with why. */
  @Roles('hr', 'admin', 'ceo')
  @Post('bulk')
  @HttpCode(200)
  run(@Body() dto: EmployeeBulkDto, @CurrentUser() user: SessionUser) {
    return this.bulk.run(dto, user);
  }

  /** ?ids=a,b,c: the chosen people's rows in an Excel file. */
  @Roles('hr', 'admin', 'ceo')
  @NotForDevelopers()
  @Get('bulk/export.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query('ids') ids: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const list = [...new Set((ids ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))].slice(0, 500);
    const file = await this.bulk.export(list, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
