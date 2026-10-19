import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EmploymentType, PayBasis, PayrollInputs, PayrollResult, PayrollRules, PayrollStatus, PayrollTerms } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo } from '../common/date-only.js';
import { detectLogoType } from '../company/logo-type.js';
import { departmentName } from '../contracts/views.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { cairoDate } from '../offers/rules.js';
import { protectPdf } from '../pdf/pdf.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { writeZip } from '../templates/zip.js';
import { firstDay, monthName } from './months.js';
import { payslipContent, yearToDate, type PayslipLanguage, type PayslipSource, type YearToDateLine } from './payslip-content.js';
import { payslipPdf, type PayslipLogo } from './payslip-pdf.js';
import { STATUS_TEXT } from './status.js';
import { monthOf, runLawRates } from './views.js';

// Payslips (owner's decisions, 16 October 2026): drawn by the system from the approved run (payslip-content.ts,
// payslip-pdf.ts), protected like every filled document, and kept. HR marking a run paid issues the English payslip of
// everyone paid (not on hold); a missing one, and the Arabic one, are drawn the first time they are asked for. A kept
// payslip is never drawn again: the run is locked from the CEO's approval on. HR, Finance and the CEO download one, or
// all of a run's as a ZIP; every payslip drawn and every download is in the audit log, without amounts (the line is
// restricted data). Emailing them comes later. A C-level person's payslips (owner, 19 October 2026: "make C level
// Employees details not visible to HR") only for the CEO and a Super Admin: 404 for anyone else, and left out of the ZIP.

const LINE = 'payroll_line';
const RUN = 'payroll_run';

export const ON_HOLD = 'On hold this month: not paid, so there is no payslip.';

/** A payslip as the employee file lists it: one per month paid. */
export interface EmployeePayslip {
  lineId: string;
  runId: string;
  month: string;
  paidOn: string | null;
  net: number;
  transfer: number;
  onHold: boolean;
  /** When each language's payslip was drawn (ISO), null until it is. */
  issued: Record<PayslipLanguage, string | null>;
}

/** A kept payslip's file. */
export interface PayslipFile {
  fileName: string;
  data: Buffer;
}

/** What a line's payslip is drawn from, read in one go for any number of lines. */
const SOURCE_SELECT = {
  id: true,
  runId: true,
  employeeId: true,
  employeeCode: true,
  nameEn: true,
  department: true,
  jobTitle: true,
  employmentType: true,
  payBasis: true,
  terms: true,
  inputs: true,
  result: true,
  onHold: true,
  bankShort: true,
  accountNo: true,
  iban: true,
  run: { select: { month: true, status: true, paidOn: true, approvedAt: true, rules: true, lawRates: true } },
  employee: { select: { fullNameAr: true, insuranceNo: true } },
  employment: {
    select: {
      joinDate: true,
      jobTitle: { select: { titleEn: true, titleAr: true } },
      department: { select: { nameEn: true, nameAr: true, parent: { select: { nameEn: true, nameAr: true } } } },
    },
  },
  contract: { select: { allowances: { select: { nameEn: true, nameAr: true } } } },
} satisfies Prisma.PayrollLineSelect;

type SourceRow = Prisma.PayrollLineGetPayload<{ select: typeof SOURCE_SELECT }>;

/** "Payslip 2026-10 EMP-0007.pdf", "Payslip 2026-10 EMP-0007 (Arabic).pdf". */
export const payslipFileName = (month: string, employeeCode: string, language: PayslipLanguage) =>
  `Payslip ${month} ${employeeCode}${language === 'ar' ? ' (Arabic)' : ''}.pdf`;

/** The department in Arabic, its parts' Arabic names where they are set; null when it is no longer the line's. */
function departmentArabic(d: SourceRow['employment']['department'], onLine: string | null): string | null {
  if (!d || departmentName(d) !== onLine) return null;
  const ar = (x: { nameEn: string; nameAr: string | null }) => x.nameAr?.trim() || x.nameEn;
  return d.parent ? `${ar(d.parent)} › ${ar(d)}` : ar(d);
}

@Injectable()
export class PayslipsService {
  private readonly logger = new Logger(PayslipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /**
   * Issues the English payslip of every line paid (not on hold) of a run just marked paid. Never fails: a payslip that
   * can't be drawn is logged, and drawn when it is first downloaded. Returns how many were drawn.
   */
  async issueRun(runId: string, user: SessionUser): Promise<number> {
    let drawn = 0;
    try {
      const lines = await this.prisma.payrollLine.findMany({
        where: { runId, onHold: false, payslips: { none: { language: 'en' } } },
        select: SOURCE_SELECT,
        orderBy: { employeeCode: 'asc' },
      });
      const sources = await this.sources(lines);
      for (const line of lines) {
        try {
          await this.draw(line, sources.get(line.id)!, 'en', user);
          drawn++;
        } catch (err) {
          this.logger.error(`The payslip of ${line.employeeCode} for ${monthOf(line.run)} could not be drawn: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`The payslips of payroll run ${runId} could not be drawn: ${(err as Error).message}`);
    }
    return drawn;
  }

  /** A line's payslip in a language: the kept one, or drawn and kept the first time it is asked for. */
  async lineFile(lineId: string, language: PayslipLanguage, user: SessionUser): Promise<PayslipFile> {
    const line = await this.prisma.payrollLine.findUnique({ where: { id: lineId }, select: SOURCE_SELECT });
    if (!line || (await this.confidential.isHidden(user, line.employeeId))) throw new NotFoundException('Payroll line not found.');
    this.assertPaid(line.run);
    if (line.onHold) throw new ConflictException(ON_HOLD);
    const file = (await this.kept(line.id, language)) ?? (await this.draw(line, (await this.sources([line])).get(line.id)!, language, user));
    await this.audit.record({
      userId: user.id,
      action: 'payslip_file',
      entityType: LINE,
      entityId: line.id,
      diff: { runId: line.runId, month: monthOf(line.run), employeeCode: line.employeeCode, language },
    });
    return file;
  }

  /** The English payslips of everyone paid in a run, as a ZIP; any missing drawn first. */
  async runZip(runId: string, user: SessionUser): Promise<PayslipFile> {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true, month: true, status: true } });
    if (!run) throw new NotFoundException('Payroll not found.');
    this.assertPaid(run);
    const month = monthOf(run);
    const lines = await this.prisma.payrollLine.findMany({
      // without the C-level people's for anyone but the CEO and a Super Admin, who download the ZIP complete
      where: { runId, onHold: false, ...(await this.confidential.ownedWhere(user)) },
      select: { id: true, employeeCode: true, payslips: { where: { language: 'en' }, select: { fileName: true, data: true } } },
      orderBy: { employeeCode: 'asc' },
    });
    if (!lines.length) throw new ConflictException(`Everyone on the ${monthName(month)} payroll is on hold, so there are no payslips.`);

    const missing = lines.filter((l) => !l.payslips.length).map((l) => l.id);
    const drawn = new Map<string, PayslipFile>();
    if (missing.length) {
      const rows = await this.prisma.payrollLine.findMany({ where: { id: { in: missing } }, select: SOURCE_SELECT });
      const sources = await this.sources(rows);
      for (const row of rows) drawn.set(row.id, await this.draw(row, sources.get(row.id)!, 'en', user));
    }
    const files = lines.map((l) => {
      const file = l.payslips[0] ? { fileName: l.payslips[0].fileName, data: Buffer.from(l.payslips[0].data) } : drawn.get(l.id)!;
      // the PDFs are compressed already
      return { name: file.fileName, data: file.data, store: true };
    });
    await this.audit.record({
      userId: user.id,
      action: 'payslip_file',
      entityType: RUN,
      entityId: run.id,
      diff: { month, file: 'zip', language: 'en', employees: lines.map((l) => l.employeeCode) },
    });
    return { fileName: `Payslips ${month}.zip`, data: writeZip(files) };
  }

  /** The employee's months paid (runs marked paid), newest first, with which payslips are drawn. */
  async employeePayslips(employeeId: string, user: SessionUser): Promise<EmployeePayslip[]> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee || (await this.confidential.isHidden(user, employeeId))) throw new NotFoundException('Employee not found.');
    const lines = await this.prisma.payrollLine.findMany({
      where: { employeeId, run: { status: 'paid' } },
      select: {
        id: true,
        runId: true,
        onHold: true,
        net: true,
        transfer: true,
        run: { select: { month: true, paidOn: true } },
        payslips: { select: { language: true, generatedAt: true } },
      },
      orderBy: { run: { month: 'desc' } },
    });
    return lines.map((l) => {
      const issued = (language: PayslipLanguage) => l.payslips.find((p) => p.language === language)?.generatedAt.toISOString() ?? null;
      return {
        lineId: l.id,
        runId: l.runId,
        month: monthOf(l.run),
        paidOn: fromDateOnly(l.run.paidOn),
        net: l.net.toNumber(),
        transfer: l.transfer.toNumber(),
        onHold: l.onHold,
        issued: { en: issued('en'), ar: issued('ar') },
      };
    });
  }

  // ---------- helpers ----------

  private assertPaid(run: { month: Date; status: string }) {
    if (run.status !== 'paid') {
      throw new ConflictException(`The ${monthName(monthOf(run))} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: payslips are issued once it is marked paid.`);
    }
  }

  private async kept(lineId: string, language: PayslipLanguage): Promise<PayslipFile | null> {
    const row = await this.prisma.payslip.findUnique({ where: { lineId_language: { lineId, language } }, select: { fileName: true, data: true } });
    return row && { fileName: row.fileName, data: Buffer.from(row.data) };
  }

  /**
   * Draws a line's payslip, protects it and keeps it. Two asking at once: the first one kept stays (a payslip is never
   * drawn again), and is the one returned.
   */
  private async draw(line: SourceRow, source: { payslip: Omit<PayslipSource, 'issuedOn'>; logo: PayslipLogo | null }, language: PayslipLanguage, user: SessionUser): Promise<PayslipFile> {
    const month = monthOf(line.run);
    const content = payslipContent({ ...source.payslip, issuedOn: todayInCairo() }, language);
    const pdf = await payslipPdf(content, source.logo, {
      title: `Payslip ${monthName(month)} · ${line.employeeCode}`,
      author: source.payslip.company.nameEn,
    });
    const data = await protectPdf(pdf);
    const fileName = payslipFileName(month, line.employeeCode, language);
    const { count } = await this.prisma.payslip.createMany({
      data: [{ lineId: line.id, language, fileName, data: new Uint8Array(data), sizeBytes: data.length, generatedById: user.id }],
      skipDuplicates: true,
    });
    if (!count) return (await this.kept(line.id, language))!;
    await this.audit.record({
      userId: user.id,
      action: 'issue_payslip',
      entityType: LINE,
      entityId: line.id,
      diff: { runId: line.runId, month, employeeCode: line.employeeCode, language, fileName },
    });
    return { fileName, data };
  }

  /**
   * What each line's payslip is drawn from: the line as approved; the profile's Arabic name, insurance number and join
   * date; the job title and department in Arabic while they are still the line's; the contract's allowances' Arabic
   * names; the company; and the year to date from the employee's lines in the runs the CEO approved.
   */
  private async sources(lines: readonly SourceRow[]): Promise<Map<string, { payslip: Omit<PayslipSource, 'issuedOn'>; logo: PayslipLogo | null }>> {
    const out = new Map<string, { payslip: Omit<PayslipSource, 'issuedOn'>; logo: PayslipLogo | null }>();
    if (!lines.length) return out;
    const months = lines.map((l) => monthOf(l.run)).sort();
    const [company, history] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true, city: true, taxRegNo: true, logo: true } }),
      this.prisma.payrollLine.findMany({
        where: {
          employeeId: { in: [...new Set(lines.map((l) => l.employeeId))] },
          run: { status: { in: ['approved', 'paid'] }, month: { gte: new Date(`${months[0].slice(0, 4)}-01-01T00:00:00Z`), lte: new Date(`${firstDay(months[months.length - 1])}T00:00:00Z`) } },
        },
        select: { employeeId: true, onHold: true, earned: true, allowances: true, monthlyTax: true, employeeInsurance: true, net: true, run: { select: { month: true, status: true } } },
      }),
    ]);
    const logoBytes = company?.logo ? Buffer.from(company.logo) : null;
    const logoType = logoBytes && detectLogoType(logoBytes);
    const logo = logoBytes && logoType ? { data: logoBytes, type: logoType } : null;
    const byEmployee = new Map<string, YearToDateLine[]>();
    for (const h of history) {
      const list = byEmployee.get(h.employeeId) ?? [];
      list.push({
        month: monthOf(h.run),
        status: h.run.status,
        onHold: h.onHold,
        earned: h.earned.toNumber(),
        allowances: h.allowances.toNumber(),
        monthlyTax: h.monthlyTax.toNumber(),
        employeeInsurance: h.employeeInsurance.toNumber(),
        net: h.net.toNumber(),
      });
      byEmployee.set(h.employeeId, list);
    }

    for (const l of lines) {
      const month = monthOf(l.run);
      const title = l.employment.jobTitle;
      out.set(l.id, {
        logo,
        payslip: {
          run: {
            month,
            paidOn: fromDateOnly(l.run.paidOn),
            approvedOn: l.run.approvedAt ? cairoDate(l.run.approvedAt) : null,
            rules: l.run.rules as unknown as PayrollRules,
            lawRates: runLawRates(l.run),
          },
          line: {
            employeeCode: l.employeeCode,
            nameEn: l.nameEn,
            department: l.department,
            jobTitle: l.jobTitle,
            employmentType: l.employmentType as EmploymentType,
            payBasis: l.payBasis as PayBasis,
            terms: l.terms as unknown as PayrollTerms,
            inputs: l.inputs as unknown as PayrollInputs,
            result: l.result as unknown as PayrollResult,
            bankShort: l.bankShort,
            accountNo: l.accountNo,
            iban: l.iban,
          },
          employee: {
            nameAr: l.employee.fullNameAr,
            insuranceNo: l.employee.insuranceNo,
            joinDate: fromDateOnly(l.employment.joinDate),
            jobTitleAr: title && title.titleEn === l.jobTitle ? title.titleAr : null,
            departmentAr: departmentArabic(l.employment.department, l.department),
          },
          allowancesAr: Object.fromEntries(l.contract.allowances.map((a) => [a.nameEn, a.nameAr])),
          company: { nameEn: company?.nameEn ?? '', city: company?.city ?? null, taxRegNo: company?.taxRegNo ?? null },
          yearToDate: yearToDate(byEmployee.get(l.employeeId) ?? [], month),
        },
      });
    }
    return out;
  }
}
