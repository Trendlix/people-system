import { Injectable, NotFoundException } from '@nestjs/common';
import { insuredWageDate, payEvents, salarySummary, TEMPLATE_SLOTS, type PayEvent, type PayVersion } from '@trendlix/shared';
import { ALLOWANCE_ORDER } from '../allowances/rows.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo } from '../common/date-only.js';
import { seesEmployeeFile } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { monthOf } from '../payroll/views.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Newest first, the current employment (no end date) before all ended ones. */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

/** What the history reads of each employment: its versions with their pay, and the months it was paid. */
const EMPLOYMENT = {
  id: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  jobTitle: { select: { titleEn: true } },
  contracts: {
    orderBy: { version: 'asc' },
    include: {
      allowances: { orderBy: ALLOWANCE_ORDER, select: { nameEn: true, amount: true } },
      approvedBy: { select: { email: true } },
      newJobTitle: { select: { titleEn: true } },
      newGrade: { select: { code: true } },
    },
  },
  payrollLines: {
    where: { run: { status: 'paid' } },
    orderBy: { run: { month: 'asc' } },
    select: { id: true, runId: true, net: true, transfer: true, onHold: true, run: { select: { month: true, paidOn: true } }, payslips: { select: { language: true } } },
  },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

const SLOT_NAMES = new Map(TEMPLATE_SLOTS.map((s) => [s.key, s.name]));

/** A version as the shared history reads it; the approver by name where their sign-in is an employee's work email. */
function payVersion(c: EmploymentRow['contracts'][number], names: ReadonlyMap<string, string>): PayVersion {
  const startDate = fromDateOnly(c.startDate);
  const email = c.approvedBy?.email ?? null;
  return {
    id: c.id,
    number: c.number,
    version: c.version,
    kind: c.kind,
    status: c.status,
    approval: c.approval,
    returnedReason: c.returnedReason,
    startDate,
    endDate: fromDateOnly(c.endDate),
    payBasis: c.payBasis,
    grossSalary: c.grossSalary.toNumber(),
    hourlyRate: c.hourlyRate?.toNumber() ?? null,
    allowances: c.allowances.map((a) => ({ nameEn: a.nameEn, amount: a.amount.toNumber() })),
    raiseReason: c.raiseReason,
    newJobTitle: c.newJobTitle?.titleEn ?? null,
    newGrade: c.newGrade?.code ?? null,
    approvedBy: email && (names.get(email.toLowerCase()) ?? email),
    approvedAt: c.approvedAt?.toISOString() ?? null,
    signedOn: fromDateOnly(c.signedOn),
    insuredWageFrom: c.approval === null ? null : insuredWageDate(startDate, fromDateOnly(c.form2From)),
  };
}

// The salary history (owner, 16 October 2026: "think about tracking the salary raises through the employment period
// too"): for each employment, current first, its pay events from its contract versions (packages/shared
// salary-history.ts), the summary as of today, each event's generated documents (for HR and the CEO, who see the
// employee file's documents), and the pay actually received: each paid payroll month's net and transfer, with which
// payslips are drawn. HR, Finance and the CEO, as salaries. A company-wide report reads the same: payEvents and
// salarySummary over the versions, or this endpoint per employee.
@Injectable()
export class SalaryHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async history(employeeId: string, user: SessionUser) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    const employments = await this.prisma.employment.findMany({ where: { employeeId }, orderBy: NEWEST_FIRST, select: EMPLOYMENT });
    const emails = [...new Set(employments.flatMap((e) => e.contracts.map((c) => c.approvedBy?.email.toLowerCase()).filter((x): x is string => !!x)))];
    const [people, documents] = await Promise.all([
      emails.length ? this.prisma.employee.findMany({ where: { workEmail: { in: emails } }, select: { workEmail: true, fullNameEn: true } }) : [],
      seesEmployeeFile(user)
        ? this.prisma.generatedDocument.findMany({
            where: { employeeId, contractId: { not: null } },
            orderBy: { generatedAt: 'desc' },
            select: { id: true, contractId: true, slotKey: true, status: true, fileName: true, generatedAt: true },
          })
        : null,
    ]);
    const names = new Map(people.map((p) => [p.workEmail!, p.fullNameEn]));
    const today = todayInCairo();

    return {
      employments: employments.map((e) => {
        const events = payEvents(e.contracts.map((c) => payVersion(c, names)));
        return {
          employmentId: e.id,
          employmentType: e.employmentType,
          joinDate: fromDateOnly(e.joinDate),
          endDate: fromDateOnly(e.endDate),
          current: e.endDate === null,
          jobTitle: e.jobTitle?.titleEn ?? null,
          summary: salarySummary(events, today),
          events: events.map((ev: PayEvent) => ({
            ...ev,
            // the documents generated for the version (null: not the caller's to see)
            documents:
              documents &&
              documents
                .filter((d) => d.contractId === ev.contractId)
                .map((d) => ({ id: d.id, slotKey: d.slotKey, name: SLOT_NAMES.get(d.slotKey) ?? d.slotKey, status: d.status, fileName: d.fileName, generatedAt: d.generatedAt })),
          })),
          // the pay actually received, month by month (oldest first)
          paid: e.payrollLines.map((l) => ({
            month: monthOf(l.run),
            lineId: l.id,
            runId: l.runId,
            paidOn: fromDateOnly(l.run.paidOn),
            net: l.net.toNumber(),
            transfer: l.transfer.toNumber(),
            onHold: l.onHold,
            payslips: { en: l.payslips.some((p) => p.language === 'en'), ar: l.payslips.some((p) => p.language === 'ar') },
          })),
        };
      }),
    };
  }
}
