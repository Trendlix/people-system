import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import {
  employeeBulkProblems,
  type EmployeeBulkPerson,
  type EmployeeBulkResult,
} from '@trendlix/shared';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { EmployeeAccessService } from '../employee-access/employee-access.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { UpdateEmploymentDto } from '../employees/employment.dto.js';
import { EmploymentsService } from '../employees/employments.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EmployeeBulkDto } from './employee-bulk.dto.js';

// Bulk actions on the Employees list (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"; chose Access, Work setup, Check-in rules, Export & message). Each person's is done with the same
// service as their own page's (the access hold and release, the employment's update), so the same checks, refusals and
// audit apply; one refused is skipped with why, the others still done. The C-level people hidden from the caller are
// skipped as not found. A Super Admin's only (owner, 2 November 2026: "emplyees bulk actions for super admin only"). A message goes to each one's bell
// and phone, and by email when asked (their work email, else the one they sign in with). The export is the chosen
// people's rows as the list shows them: no pay, no IDs.

const NOT_FOUND = 'Not found.';
const NO_EMPLOYMENT = 'No current employment.';

/** Why a person's action was refused, in its own words. */
function reasonOf(err: unknown): string {
  if (err instanceof HttpException) {
    const r = err.getResponse();
    const m = typeof r === 'string' ? r : (r as { message?: string | string[] }).message;
    return ([] as string[]).concat(m ?? err.message).join(' ');
  }
  return 'Something went wrong. Try again.';
}

@Injectable()
export class EmployeeBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EmployeeAccessService,
    private readonly employments: EmploymentsService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** The people chosen the caller may see, in the order chosen, with their current employment and account. */
  private async people(ids: readonly string[], user: SessionUser) {
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        fullNameEn: true,
        workEmail: true,
        account: { select: { id: true, email: true, isActive: true } },
        employments: { where: { endDate: null }, select: { id: true }, orderBy: { joinDate: 'desc' }, take: 1 },
      },
    });
    const byId = new Map(rows.filter((r) => !hidden.has(r.id)).map((r) => [r.id, r]));
    return ids.map((id) => ({ id, row: byId.get(id) ?? null }));
  }

  /** POST /employees/bulk: the action for each person chosen; who it was done for, and who was skipped with why. */
  async run(dto: EmployeeBulkDto, user: SessionUser): Promise<EmployeeBulkResult> {
    const problems = employeeBulkProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    // a Super Admin's only (owner, 2 November 2026), checked again here whatever route reaches it
    if (!isSuperAdmin(user)) throw new ForbiddenException('Bulk actions are for a Super Admin only.');
    const ids = [...new Set(dto.employeeIds)];
    const done: EmployeeBulkPerson[] = [];
    const skipped: EmployeeBulkResult['skipped'] = [];
    const mailReady = dto.action === 'message' && dto.email === true ? await this.mail.ready() : false;
    for (const { id, row } of await this.people(ids, user)) {
      if (!row) {
        skipped.push({ id, name: 'Unknown', reason: NOT_FOUND });
        continue;
      }
      const person = { id, name: row.fullNameEn };
      try {
        const skip = await this.one(dto, row, user, mailReady);
        if (skip) skipped.push({ ...person, reason: skip });
        else done.push(person);
      } catch (err) {
        skipped.push({ ...person, reason: reasonOf(err) });
      }
    }
    return { action: dto.action, done, skipped };
  }

  /** One person's action; a reason when skipped without an error. */
  private async one(
    dto: EmployeeBulkDto,
    p: { id: string; fullNameEn: string; workEmail: string | null; account: { id: string; email: string; isActive: boolean } | null; employments: { id: string }[] },
    user: SessionUser,
    mailReady: boolean,
  ): Promise<string | null> {
    switch (dto.action) {
      case 'hold':
        await this.access.hold(p.id, dto.reason, user);
        return null;
      case 'release':
        await this.access.release(p.id, user);
        return null;
      case 'message':
        return this.message(dto, p, user, mailReady);
      default: {
        const employment = p.employments[0];
        if (!employment) return NO_EMPLOYMENT;
        const change: UpdateEmploymentDto =
          dto.action === 'manager'
            ? { managerId: dto.managerId ?? null }
            : dto.action === 'department'
              ? { departmentId: dto.departmentId! }
              : dto.action === 'shift'
                ? { shiftId: dto.shiftId ?? null }
                : { checkInAnywhere: dto.on === true };
        await this.employments.update(p.id, employment.id, change, user, { answer: false });
        return null;
      }
    }
  }

  /** The message to their bell and phone, and by email when asked; audited for each. */
  private async message(
    dto: EmployeeBulkDto,
    p: { id: string; fullNameEn: string; workEmail: string | null; account: { id: string; email: string; isActive: boolean } | null },
    user: SessionUser,
    mailReady: boolean,
  ): Promise<string | null> {
    const title = (dto.title ?? '').trim();
    const body = (dto.body ?? '').trim();
    const account = p.account?.isActive ? p.account : null;
    const to = p.workEmail || p.account?.email || null;
    const emailing = dto.email === true && mailReady && !!to;
    if (!account && !emailing) return dto.email === true && !mailReady ? 'No account, and email isn’t set up.' : 'No account to send it to.';
    if (account) await this.notifications.notify([account.id], { kind: 'hr_message', title, body });
    if (emailing) await this.mail.send({ to: to!, replyTo: user.email, subject: title, text: body });
    await this.audit.record({ userId: user.id, action: 'send_message', entityType: 'employee', entityId: p.id, diff: { title, emailed: emailing } });
    return null;
  }

  /** GET /employees/export?ids=: the chosen people's rows, as the list shows them, in an Excel file. */
  async export(ids: readonly string[], user: SessionUser): Promise<{ data: Buffer; fileName: string }> {
    if (!isSuperAdmin(user)) throw new ForbiddenException('Bulk actions are for a Super Admin only.');
    if (!ids.length) throw new BadRequestException(['Choose at least one person.']);
    const hidden = await this.confidential.hiddenFrom(user);
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...ids], ...(hidden.length && { notIn: hidden }) } },
      orderBy: { fullNameEn: 'asc' },
      select: {
        employeeCode: true,
        fullNameEn: true,
        fullNameAr: true,
        workEmail: true,
        employments: {
          orderBy: { joinDate: 'desc' },
          take: 1,
          select: {
            employmentType: true,
            status: true,
            joinDate: true,
            endDate: true,
            workArrangement: true,
            department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
            jobTitle: { select: { titleEn: true } },
            grade: { select: { code: true, levelEn: true } },
            manager: { select: { fullNameEn: true } },
            shift: { select: { code: true } },
          },
        },
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    ws.columns = [
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Name', key: 'name', width: 32 },
      { header: 'Name (Arabic)', key: 'nameAr', width: 32 },
      { header: 'Work email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 24 },
      { header: 'Team', key: 'team', width: 22 },
      { header: 'Job title', key: 'jobTitle', width: 26 },
      { header: 'Grade', key: 'grade', width: 16 },
      { header: 'Manager', key: 'manager', width: 28 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Works from', key: 'arrangement', width: 12 },
      { header: 'Shift', key: 'shift', width: 18 },
      { header: 'Joined', key: 'joined', width: 12 },
      { header: 'Left', key: 'left', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
    for (const r of rows) {
      const e = r.employments[0];
      const dept = e?.department;
      ws.addRow({
        code: r.employeeCode,
        name: r.fullNameEn,
        nameAr: r.fullNameAr ?? '',
        email: r.workEmail ?? '',
        department: dept ? (dept.parent?.nameEn ?? dept.nameEn) : '',
        team: dept?.parent ? dept.nameEn : '',
        jobTitle: e?.jobTitle?.titleEn ?? '',
        grade: e?.grade ? `${e.grade.code} · ${e.grade.levelEn}` : '',
        manager: e?.manager?.fullNameEn ?? '',
        type: e?.employmentType ?? '',
        status: e?.status ?? '',
        arrangement: e?.workArrangement ?? '',
        shift: e?.shift?.code ?? '',
        joined: day(e?.joinDate),
        left: day(e?.endDate),
      });
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await this.audit.record({ userId: user.id, action: 'export_employees', entityType: 'employee', entityId: null, diff: { people: rows.length } });
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    return { data, fileName: `Employees ${new Date().toISOString().slice(0, 10)}.xlsx` };
  }
}
