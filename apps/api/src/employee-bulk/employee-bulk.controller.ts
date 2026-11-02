import { Body, Controller, Get, Header, HttpCode, Post, Query, SetMetadata, StreamableFile } from '@nestjs/common';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { EmployeeBulkDto } from './employee-bulk.dto.js';
import { EmployeeBulkService } from './employee-bulk.service.js';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions"): a Super Admin's
// only (owner, 2 November 2026: "emplyees bulk actions for super admin only"), every action; each person's checked by
// its own service. The export of the chosen people: never a developer's (a file).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BULK_SUPER_ADMIN_ONLY = 'Bulk actions are for a Super Admin only.';

@Controller('employees')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, BULK_SUPER_ADMIN_ONLY)
export class EmployeeBulkController {
  constructor(private readonly bulk: EmployeeBulkService) {}

  /** { action, employeeIds, … }: the action for each; who it was done for, and who was skipped with why. */
  @Post('bulk')
  @HttpCode(200)
  run(@Body() dto: EmployeeBulkDto, @CurrentUser() user: SessionUser) {
    return this.bulk.run(dto, user);
  }

  /** ?ids=a,b,c: the chosen people's rows in an Excel file. */
  @NotForDevelopers()
  @Get('bulk/export.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query('ids') ids: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const list = [...new Set((ids ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))].slice(0, 500);
    const file = await this.bulk.export(list, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
