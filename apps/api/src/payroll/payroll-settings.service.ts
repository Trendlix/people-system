import { BadRequestException, Injectable } from '@nestjs/common';
import { OFFICE_ADDRESS_DEFAULTS, officeAddressesProblems, type PayrollRules } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { PayrollSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdatePayrollSettingsDto } from './payroll.dto.js';

const ENTITY = 'payroll_settings';
const ID = 1;

/** The answer to the office's point sent here (20 October 2026: several check-in locations on their own page). */
export const OFFICE_POINT_MOVED =
  "The office's location is a check-in location now: add or change it on Attendance → Check-in Setup, where several can be kept.";

/** The settings as the API sends them: the rules a run copies, and the company's side of the bank files. */
export interface PayrollSettingsView extends Required<PayrollRules> {
  /** The company's CIB account the salaries are paid from (12 digits), and its name as CIB has it. */
  cibDebitAccount: string | null;
  cibDebitAccountName: string | null;
  /** The ACH file's TransactionPurpose. */
  achPurpose: string;
  /**
   * The day of the month salaries are paid, 1 to 31; null when not set. The date HR marks a run paid on, to start with:
   * that day of the month after the run's, or that month's last day when it is shorter.
   */
  payday: number | null;
  /**
   * Salary review due after this many months (owner's decision, 16 October 2026: the company-wide Salary Raises report):
   * the report lists current employees whose last raise, or their join date, is at least this long ago. 1 to 60.
   */
  salaryReviewMonths: number;
  /**
   * The most a month's installments of advances and loans may take, in percent of the wage (Labour Law 14/2025 Art.
   * 113; owner, 18 October 2026, after reading the law: "Block above 10%"): 1 to 10, the law's 10 to start with. A plan
   * or an installment past it is refused; the run's lines warn past it. Until then a warning at 1 to 100 (none: none).
   */
  installmentLimitPercent: number;
  /**
   * The office's addresses as Zoho People writes a check-in's location (owner, 19 October 2026: "13 and 17 al mahrouki
   * is also in office"): a day checked in at one of them is at the office, anywhere else remote (attendance-import.ts
   * placeOf). Al Doctor Al Mahrouqi Street 13, 15 and 17 and Trendlix to start with. Edited on Attendance → Check-in
   * Setup since 20 October 2026 (owner: "Own page, several locations"). The office's point and radius were sent here
   * too until then: they are check-in locations now (check-in-setup.service.ts), and no longer sent.
   */
  officeAddresses: string[];
}

/** The rules a run is worked out with, as the settings have them now: Pay overtime always says on or off. */
export const rulesOf = (s: PayrollSettings): Required<PayrollRules> => ({
  dayDivisor: s.dayDivisor,
  attendanceGracePercent: s.attendanceGracePercent.toNumber(),
  kpiGracePercent: s.kpiGracePercent.toNumber(),
  payOvertime: s.payOvertime,
  overtimeAbovePercent: s.overtimeAbovePercent.toNumber(),
  overtimeRate: s.overtimeRate.toNumber(),
  noShowDayMultiplier: s.noShowDayMultiplier.toNumber(),
});

const view = (s: PayrollSettings): PayrollSettingsView => ({
  ...rulesOf(s),
  cibDebitAccount: s.cibDebitAccount,
  cibDebitAccountName: s.cibDebitAccountName,
  achPurpose: s.achPurpose,
  payday: s.payday,
  salaryReviewMonths: s.salaryReviewMonths,
  installmentLimitPercent: s.installmentLimitPercent.toNumber(),
  officeAddresses: s.officeAddresses ?? [...OFFICE_ADDRESS_DEFAULTS],
});

// The payroll settings (owner's decisions, 16 October 2026): the sheet's rules to start with (a month of 30 days,
// attendance from 90% and a KPI average from 80% count as full, overtime above 110% at 1.5, a no-show day costs 2 days'
// pay), which each run copies when it is made or refreshed, and the company's CIB account the salaries are paid from.
// Overtime isn't paid from 16 October 2026 (owner: "No overtime for now", as attendance counts at most the shift's
// hours to work a day): Pay overtime is off, its percent and rate kept for when it is turned on.
// One row, id 1, added by the payroll migration and prisma/seed.ts. HR, Finance, the CEO and Admin read them; HR and
// Admin change them (Organization → Payroll Setup: the rules under Your Rules, the bank files and the payday, the day
// of the month salaries are paid, under Paying Salaries; owner's request, 16 October 2026). Your Rules also has when a
// salary review is due, after 12 months without a raise to start with (the Salary Raises report; owner's decision, 16
// October 2026), which no run copies, and the most a month's installments of advances and loans may take of the wage:
// a warning past 10% of the pay to start with (owner, 18 October 2026: "Warn when a month's installments pass __ % of
// the pay"), the law's limit since the owner read the Labour Law with us (owner, 18 October 2026, after reading the law:
// "Block above 10%"; Art. 113): 10 to start with, lower if set so, never higher. No run copies it either: plans past
// it are refused, and the run's lines warn with it as it is. Your Rules also has the office's addresses (owner, 19
// October 2026: attendance imported from Zoho People, a check-in at the office or remote), which no run copies either:
// an import reads the check-ins' places with them as they are. And the office's point and radius (owner, 19 October
// 2026: "Check-in through the system (phone or web with the office location check, or a device) to replace Zoho"): a
// check-in on the system within the radius is at the office, outside it remote; no run copies them either. Those moved
// to Attendance → Check-in Setup on 20 October 2026 (owner: "Own page, several locations"), several check-in locations:
// sent here they are refused, saying so; the addresses stay here, edited from that page.
@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The one row; created with the defaults if it is missing. */
  row(): Promise<PayrollSettings> {
    return this.prisma.payrollSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID } });
  }

  async get(): Promise<PayrollSettingsView> {
    return view(await this.row());
  }

  async update(dto: UpdatePayrollSettingsDto, user: SessionUser): Promise<PayrollSettingsView> {
    // the office's point and radius are check-in locations now (20 October 2026)
    if (dto.officeLatitude !== undefined || dto.officeLongitude !== undefined || dto.officeRadiusMetres !== undefined) {
      throw new BadRequestException([OFFICE_POINT_MOVED]);
    }
    const before = await this.row();
    // the office's addresses, each trimmed, the empty ones dropped (19 October 2026)
    const officeAddresses = dto.officeAddresses?.map((a) => a.trim()).filter(Boolean);
    if (officeAddresses) {
      const problems = officeAddressesProblems(officeAddresses);
      if (problems.length) throw new BadRequestException(problems);
    }
    const data = {
      dayDivisor: dto.dayDivisor,
      attendanceGracePercent: dto.attendanceGracePercent,
      kpiGracePercent: dto.kpiGracePercent,
      payOvertime: dto.payOvertime,
      overtimeAbovePercent: dto.overtimeAbovePercent,
      overtimeRate: dto.overtimeRate,
      noShowDayMultiplier: dto.noShowDayMultiplier,
      cibDebitAccount: dto.cibDebitAccount,
      cibDebitAccountName: dto.cibDebitAccountName,
      achPurpose: dto.achPurpose,
      payday: dto.payday,
      salaryReviewMonths: dto.salaryReviewMonths,
      installmentLimitPercent: dto.installmentLimitPercent,
      officeAddresses,
    };
    const after = await this.prisma.payrollSettings.update({ where: { id: ID }, data });
    const diff = changes(view(before) as unknown as Record<string, unknown>, data);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff });
    return view(after);
  }
}
