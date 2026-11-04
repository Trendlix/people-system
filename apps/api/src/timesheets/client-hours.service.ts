import { Injectable } from '@nestjs/common';
import {
  clientHoursGroups,
  clientHoursTotal,
  NO_CLIENT_LABEL,
  type ClientHoursLine,
  type ClientHoursReport,
  type ClientHoursStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { clientHoursFileName, clientHoursWorkbook } from './client-hours-workbook.js';
import type { ClientHoursQueryDto } from './client-hours.dto.js';

// Client hours (owner, 4 November 2026: "Full salary, hours tracked": the hours of those on timesheets kept for the
// clients; the client reports left to do after the timesheets; packages/shared timesheets.ts): a month's hours logged on
// timesheets (each line by its day, whatever week it is in), by client account and by person, the approved ones apart
// from those waiting for approval (a week not sent, or rejected, counts nothing). HR, the CEO, Finance and a Super Admin,
// who read the client accounts. A C-level person's hours only for those who see them, the others told how many aren't
// shown. As an Excel workbook too (the summary and every line), each download in the audit log.

const ENTITY = 'client_hours_report';
const COUNTED: ClientHoursStatus[] = ['approved', 'submitted'];

/** The month's first and last day. */
function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, '0')}` };
}

const hoursOf = (d: { toNumber(): number } | number) => (typeof d === 'number' ? d : d.toNumber());

@Injectable()
export class ClientHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
    private readonly audit: AuditService,
  ) {}

  /** The month's lines of the weeks sent or approved, but the C-level people hidden from the caller (counted apart). */
  async lines(month: string, user: SessionUser): Promise<{ lines: ClientHoursLine[]; hiddenPeople: number }> {
    const { first, last } = monthRange(month);
    const hidden = await this.confidential.hiddenFrom(user);
    const rows = await this.prisma.timesheetEntry.findMany({
      where: { date: { gte: toDateOnly(first), lte: toDateOnly(last) }, week: { status: { in: COUNTED } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        date: true,
        task: true,
        hours: true,
        note: true,
        clientAccount: { select: { id: true, nameEn: true, code: true } },
        week: { select: { status: true, employee: { select: { id: true, fullNameEn: true, employeeCode: true } } } },
      },
    });
    const hiddenSet = new Set(hidden);
    const left = new Set<string>();
    const lines: ClientHoursLine[] = [];
    for (const r of rows) {
      const e = r.week.employee;
      if (hiddenSet.has(e.id)) {
        left.add(e.id);
        continue;
      }
      lines.push({
        date: fromDateOnly(r.date),
        employee: { id: e.id, fullNameEn: e.fullNameEn, employeeCode: e.employeeCode },
        client: r.clientAccount && { id: r.clientAccount.id, name: r.clientAccount.nameEn, code: r.clientAccount.code },
        task: r.task,
        hours: hoursOf(r.hours),
        note: r.note,
        status: r.week.status as ClientHoursStatus,
      });
    }
    return { lines, hiddenPeople: left.size };
  }

  async report(query: ClientHoursQueryDto, user: SessionUser): Promise<ClientHoursReport> {
    const month = query.month ?? todayInCairo().slice(0, 7);
    const { lines, hiddenPeople } = await this.lines(month, user);
    return { month, generatedAt: new Date().toISOString(), groups: clientHoursGroups(lines), total: clientHoursTotal(lines), hiddenPeople };
  }

  /** The report and its lines as an Excel workbook, named with its month; the download is in the audit log. */
  async workbook(query: ClientHoursQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const month = query.month ?? todayInCairo().slice(0, 7);
    const { lines, hiddenPeople } = await this.lines(month, user);
    const report: ClientHoursReport = { month, generatedAt: new Date().toISOString(), groups: clientHoursGroups(lines), total: clientHoursTotal(lines), hiddenPeople };
    const data = await clientHoursWorkbook(report, lines);
    await this.audit.record({
      userId: user.id,
      action: 'client_hours_file',
      entityType: ENTITY,
      diff: { month, lines: lines.length, clients: report.groups.map((g) => g.client?.name ?? NO_CLIENT_LABEL) },
    });
    return { fileName: clientHoursFileName(month), data };
  }
}
