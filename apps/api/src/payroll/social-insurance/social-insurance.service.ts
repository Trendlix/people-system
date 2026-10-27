import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SI_REGISTER_STATUS_DEFAULT,
  siApplies,
  siChecked,
  siInsured,
  siMissingCounts,
  siMissingRow,
  siMonthRow,
  siMonthTotals,
  siOrder,
  siRatesOf,
  siRegisterRow,
  siStatusMatches,
  siTotals,
  type SiContributionsReport,
  type SiDepartmentFilter,
  type SiMissingReport,
  type SiRegisterReport,
  type SiReportView,
  type SiSource,
} from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { dayInCairo, toDateOnly, todayInCairo } from '../../common/date-only.js';
import { INSURANCE_BASIC_DEFAULT } from '../../contracts/contract-settings.service.js';
import { seesEmployeeFile, seesIdentity } from '../../employees/access.js';
import { maskTail } from '../../employees/checks.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LawRatesService } from '../law-rates/law-rates.service.js';
import { firstDay, lastDay } from '../months.js';
import type { SiContributionsQueryDto, SiDepartmentQueryDto, SiRegisterQueryDto } from './social-insurance.dto.js';
import {
  FORM_1,
  FORM_6,
  inPlace,
  latestPerPerson,
  leftOnOf,
  PRINT,
  SI_EMPLOYMENT,
  sourceOf,
  standingOf,
  type SiEmploymentRow,
} from './social-insurance-sources.js';
import { siWorkbook } from './social-insurance-workbook.js';

const ENTITY = 'social_insurance_report';

/** The employee file's part of a row (Forms 1 and 6 and the print), for those who see it. */
type FileData = NonNullable<SiSource['file']>;
const NO_FILE: FileData = { form1: [], form6: [], printReceivedOn: null };

/**
 * Forms 1 and 6 and the print: the employee file's, HR's and the CEO's (seesEmployeeFile); never a developer's, as the
 * Social Insurance tab shows them none of a person's social insurance (owner, 22 October 2026: "and the social insurance").
 */
const seesFile = (user: SessionUser) => seesEmployeeFile(user) && !user.developer;

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; asked which, he chose all three: "Insured staff register", "Monthly contributions" and "Missing
// data checklist"; packages/shared social-insurance-report.ts), under Payroll → Reports. Every figure is what HR keeps on
// each profile's Social Insurance tab, worked out as the tab works it out, never a payroll run's.
// - The register: the people registered with social insurance in an employment under the labour law, as of today, with
//   this year's rates; filtered by department or team and status (current employees unless asked, leavers on request).
// - The monthly contributions: for a month (this month in Cairo unless asked), those registered whose employment touches
//   it (its end as payroll takes it), the whole month's shares on that year's rates, joiners and leavers marked, the totals.
// - The missing data: the current full-time employees and the registered part-timers who miss something on the tab.
// Salary data, so the register and the contributions are for HR, Finance and the CEO, as the Payroll vs Social Insurance
// report; the missing data names the employee file's forms and print, so it is HR's and the CEO's, as Missing Details. The
// national ID only for HR and the CEO, masked on the screen and in full in their workbook; Forms 1 and 6 and the print
// only for HR and the CEO, never a developer. Without the C-level people for anyone but the CEO and a Super Admin (owner, 19 October 2026:
// "make C level Employees details not visible to HR"): `confidentialExcluded` says how many are left out. A developer
// gets the figures masked (the interceptor) and never a workbook. Every workbook downloaded is in the audit log, with its
// view, its filters and whose rows it has.
@Injectable()
export class SocialInsuranceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly lawRates: LawRatesService,
  ) {}

  register(query: SiRegisterQueryDto, user: SessionUser): Promise<SiRegisterReport> {
    return this.registerFor(query, user, false);
  }

  /** The register; `fullIds`: the national ID in full (a workbook for HR or the CEO), else masked as the profile masks it. */
  private async registerFor(query: SiRegisterQueryDto, user: SessionUser, fullIds: boolean): Promise<SiRegisterReport> {
    const today = todayInCairo();
    const status = query.status ?? SI_REGISTER_STATUS_DEFAULT;
    const [department, employments, law, settings, hidden] = await Promise.all([
      this.department(query.departmentId),
      this.prisma.employment.findMany({ select: SI_EMPLOYMENT }),
      this.lawRates.forYear(Number(today.slice(0, 4))),
      this.prisma.contractSettings.findUnique({ where: { id: 1 }, select: { insuranceBasicDefault: true } }),
      this.hidden(user),
    ]);
    // each person once: their current employment, else their latest; then the filters
    const chosen = latestPerPerson(employments).filter((e) => inPlace(e, query.departmentId) && siStatusMatches(status, standingOf(e)));
    const insured = chosen.filter((e) => siInsured(e.employmentType, e.employee.socialInsured));
    const visible = insured.filter((e) => !hidden.has(e.employeeId));
    const identity = seesIdentity(user);
    const file = seesFile(user) ? await this.fileOf(visible) : null;
    const shown = (id: string | null) => (identity ? (fullIds ? id : maskTail(id)) : null);
    const basicDefault = settings?.insuranceBasicDefault.toNumber() ?? INSURANCE_BASIC_DEFAULT;
    const rows = visible.map((e) => siRegisterRow(sourceOf(e, { today }, shown, file && (file.get(e.id) ?? NO_FILE)), law, basicDefault)).sort(siOrder);
    return {
      view: 'register',
      generatedAt: new Date().toISOString(),
      today,
      filters: { department, status },
      rates: siRatesOf(law),
      insuranceBasicDefault: basicDefault,
      seesIdentity: identity,
      seesFile: file !== null,
      rows,
      totals: siTotals(rows),
      notRegistered: chosen.filter((e) => !hidden.has(e.employeeId) && siApplies(e.employmentType) && !e.employee.socialInsured).length,
      confidentialExcluded: insured.length - visible.length,
    };
  }

  /** A month's contributions: those registered whose employment touches the month, the whole month's shares and the totals. */
  async contributions(query: SiContributionsQueryDto, user: SessionUser): Promise<SiContributionsReport> {
    const month = query.month ?? todayInCairo().slice(0, 7);
    const from = firstDay(month);
    const to = lastDay(month);
    const [department, employments, law, settings, hidden] = await Promise.all([
      this.department(query.departmentId),
      this.prisma.employment.findMany({
        where: { joinDate: { lte: toDateOnly(to) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(from) } }] },
        select: SI_EMPLOYMENT,
      }),
      this.lawRates.forYear(Number(month.slice(0, 4))),
      this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { insureEveryone: true } }),
      this.hidden(user),
    ]);
    // employed in the month to its end as payroll takes it (an approved ending's last working day); a person hired again
    // in the month once, on the later employment, as payroll pays them
    const touching = employments.filter((e) => {
      const end = leftOnOf(e);
      return end === null || end >= from;
    });
    const placed = laterPerPerson(touching).filter((e) => inPlace(e, query.departmentId));
    const insured = placed.filter((e) => siInsured(e.employmentType, e.employee.socialInsured));
    const visible = insured.filter((e) => !hidden.has(e.employeeId));
    const rows = visible.map((e) => siMonthRow(sourceOf(e, { month }, () => null, null), law)).sort(siOrder);
    return {
      view: 'contributions',
      generatedAt: new Date().toISOString(),
      month,
      filters: { department },
      rates: siRatesOf(law),
      // the switch's default (on) when the settings were never saved
      insureEveryone: settings?.insureEveryone ?? true,
      rows,
      totals: siMonthTotals(rows, month),
      notRegistered: placed.filter((e) => !hidden.has(e.employeeId) && siApplies(e.employmentType) && !e.employee.socialInsured).length,
      confidentialExcluded: insured.length - visible.length,
    };
  }

  /** Who misses something on their Social Insurance tab: the current full-time employees and the registered part-timers. */
  async missing(query: SiDepartmentQueryDto, user: SessionUser): Promise<SiMissingReport> {
    const today = todayInCairo();
    const [department, employments, hidden] = await Promise.all([
      this.department(query.departmentId),
      this.prisma.employment.findMany({ where: { endDate: null }, select: SI_EMPLOYMENT }),
      this.hidden(user),
    ]);
    const checked = latestPerPerson(employments).filter((e) => inPlace(e, query.departmentId) && siChecked(e.employmentType, e.employee.socialInsured));
    const visible = checked.filter((e) => !hidden.has(e.employeeId));
    // the forms and the print are the employee file's: HR's and the CEO's, as this view is
    const file = seesFile(user) ? await this.fileOf(visible) : null;
    const all = visible.map((e) => siMissingRow(sourceOf(e, { today }, () => null, file && (file.get(e.id) ?? NO_FILE))));
    return {
      view: 'missing',
      generatedAt: new Date().toISOString(),
      today,
      filters: { department },
      rows: all.filter((r) => r.missing.length > 0).sort(siOrder),
      checked: all.length,
      byItem: siMissingCounts(all),
      confidentialExcluded: checked.length - visible.length,
    };
  }

  /**
   * A view as an Excel workbook, named with its day or month; the download is in the audit log with its view, filters and
   * whose rows it has (and, for the register, whether it has the national IDs in full). Without the C-level people, as the view.
   */
  async workbook(view: 'register', query: SiRegisterQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }>;
  async workbook(view: 'contributions', query: SiContributionsQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }>;
  async workbook(view: 'missing', query: SiDepartmentQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }>;
  async workbook(view: SiReportView, query: SiRegisterQueryDto & SiContributionsQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = view === 'register' ? await this.registerFor(query, user, true) : view === 'contributions' ? await this.contributions(query, user) : await this.missing(query, user);
    const file = await siWorkbook(report);
    await this.audit.record({
      userId: user.id,
      action: 'social_insurance_report_file',
      entityType: ENTITY,
      diff: {
        view,
        ...(report.view === 'register' && { status: report.filters.status, nationalIds: report.seesIdentity }),
        ...(report.view === 'contributions' && { month: report.month }),
        department: report.filters.department?.nameEn ?? null,
        employees: report.rows.map((r) => r.employee.employeeCode),
      },
    });
    return file;
  }

  /** The department or team asked, as the views name it back; null for everyone, 400 for one that isn't there. */
  private async department(id: string | undefined): Promise<SiDepartmentFilter | null> {
    if (!id) return null;
    const d = await this.prisma.department.findUnique({ where: { id }, select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } });
    if (!d) throw new BadRequestException('Choose the department or team from the list.');
    return d;
  }

  /** The C-level people hidden from the caller. */
  private async hidden(user: SessionUser): Promise<Set<string>> {
    return new Set(await this.confidential.hiddenFrom(user));
  }

  /** Each employment's Forms 1 and 6 (every document's status) and its person's latest print, by employment. */
  private async fileOf(rows: readonly SiEmploymentRow[]): Promise<Map<string, FileData>> {
    if (!rows.length) return new Map();
    const [documents, prints] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where: { employmentId: { in: rows.map((r) => r.id) }, slotKey: { in: [FORM_1, FORM_6] } },
        select: { employmentId: true, slotKey: true, status: true },
      }),
      this.prisma.paperworkItem.findMany({
        where: { employeeId: { in: rows.map((r) => r.employeeId) }, kind: PRINT },
        select: { employeeId: true, uploadedAt: true },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);
    const printOn = new Map<string, string>();
    for (const p of prints) if (!printOn.has(p.employeeId)) printOn.set(p.employeeId, dayInCairo(p.uploadedAt));
    return new Map(
      rows.map((r) => {
        const own = documents.filter((d) => d.employmentId === r.id);
        return [
          r.id,
          {
            form1: own.filter((d) => d.slotKey === FORM_1).map((d) => d.status),
            form6: own.filter((d) => d.slotKey === FORM_6).map((d) => d.status),
            printReceivedOn: printOn.get(r.employeeId) ?? null,
          },
        ];
      }),
    );
  }
}

/** Each person's later employment of those touching a month (left and hired again in it: the later, as payroll pays them). */
function laterPerPerson(rows: readonly SiEmploymentRow[]): SiEmploymentRow[] {
  const chosen = new Map<string, SiEmploymentRow>();
  for (const e of rows) {
    const had = chosen.get(e.employeeId);
    if (!had || e.joinDate > had.joinDate) chosen.set(e.employeeId, e);
  }
  return [...chosen.values()];
}
