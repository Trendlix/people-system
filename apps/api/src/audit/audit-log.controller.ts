import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { AuditQueryDto, SignInsQueryDto } from './audit-log.dto.js';
import { AuditLogService } from './audit-log.service.js';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): who changed what and
// when, for the Super Admin and the CEO only (HR, Finance and Admin get 403). ?from=&to= (days, Cairo), userId (who did
// it), action, entityType, entityId, employeeId (everything about one person), q (text in what changed), page and limit
// (50 a page, at most 100), or before=<entry id>; module and result (31 October 2026). A Super Admin viewing as someone gets what that user gets.
@Controller('audit')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  /** { entries, total, page, pageSize, pages, next }, newest first (audit-log.service.ts AuditPage). */
  @Roles('super_admin', 'ceo')
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: AuditQueryDto, @CurrentUser() user: SessionUser) {
    return this.auditLog.list(query, user);
  }

  /**
   * The Sign-ins tab (owner, 31 October 2026: "Every sign-in in its own tab"): { entries, total, page, pageSize, pages },
   * newest first; ?from=&to= (days, Cairo), outcome, q (the email, the address, the city or the browser), page, limit.
   */
  @Roles('super_admin', 'ceo')
  @Get('sign-ins')
  @Header('Cache-Control', 'private, no-store')
  signIns(@Query() query: SignInsQueryDto) {
    return this.auditLog.signIns(query);
  }

  /** The same sign-ins as an Excel workbook, newest first, up to 10,000: "Sign-ins 2026-10-31.xlsx". */
  @Roles('super_admin', 'ceo')
  @NotForDevelopers()
  @Get('sign-ins/export')
  @Header('Cache-Control', 'private, no-store')
  async signInsWorkbook(@Query() query: SignInsQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.auditLog.signInsWorkbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** What the filters offer: { users, actions, entityTypes, employees, modules, results, outcomes }. */
  @Roles('super_admin', 'ceo')
  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(@CurrentUser() user: SessionUser) {
    return this.auditLog.options(user);
  }

  /** The same entries as an Excel workbook, newest first, up to 10,000: "Audit log 2026-10-19.xlsx". */
  @Roles('super_admin', 'ceo')
  @NotForDevelopers()
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: AuditQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.auditLog.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
