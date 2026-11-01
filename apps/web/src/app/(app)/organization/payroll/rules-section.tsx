import Link from 'next/link';
import { canEditOrganisation } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { monthsLabel } from '../../employees/[id]/salary-history/salary-history';
import { SETUP_PATHS } from '../setup-pages';
import { rulesSummary } from '../../payroll/list';
import { updateYourRules } from './actions';
import { loadContractDefaults, loadPayrollSettings } from './data';
import { YourRulesForm } from './rules-form';
import { NotLoaded, SettingRow, SetupSection } from './section';

// Payroll Setup, 1 Your Rules (owner's request, 16 October 2026): the company's own rules for working out the pay,
// after its payroll sheet with the sheet's formula errors fixed, and the company defaults that change the sheet. The
// rules are the payroll settings (GET/PATCH /payroll/settings); the basic share of the gross new contracts start with
// and the Form 1 basic wage stay with the contract settings (GET/PATCH /contract-settings), where the contracts and
// the forms read them, and are edited only here: Organization → Contracts & Endings shows them with a link here. When a
// salary review is due, after how many months without a raise, is a payroll setting the Salary Raises report reads
// (owner's decision, 16 October 2026), and the most a month's installments may take of the wage, the Labour Law's limit
// (owner, 18 October 2026, after reading the law: "Block above 10%"), and the office's addresses a Zoho People check-in is
// read against, at the office or remote (owner, 19 October 2026: "13 and 17 al mahrouki is also in office"), and the
// office's point and radius a check-in on the system is read against (owner, 19 October 2026: "Check-in through the
// system (phone or web with the office location check, or a device) to replace Zoho"), until both moved to Attendance →
// Check-in Setup (owner, 20 October 2026: "Own page, several locations"): a line points there. HR and Admin change them;
// Finance and the CEO read them.

export async function YourRulesSection({ user }: { user: SessionUser }) {
  const [settings, defaults] = await Promise.all([loadPayrollSettings(), loadContractDefaults()]);
  const d = defaults.kind === 'ok' ? defaults.value : null;

  return (
    <SetupSection id="your-rules" title="Your Rules">
      {settings.kind !== 'ok' ? (
        <NotLoaded what="the payroll rules" loaded={settings} />
      ) : canEditOrganisation(user) ? (
        <YourRulesForm action={updateYourRules} rules={settings.value} defaults={d} canInsureEveryone={user.roles.includes('super_admin')} />
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {rulesSummary(settings.value).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {settings.value.salaryReviewMonths !== undefined && (
            <dl className="mt-4">
              <SettingRow label="Salary review due after">
                <span className="tabular-nums">{monthsLabel(settings.value.salaryReviewMonths)}</span>
              </SettingRow>
            </dl>
          )}
          {settings.value.installmentLimitPercent !== undefined && (
            <dl className="mt-4">
              <SettingRow label="Most a month's installments may take">
                <span className="tabular-nums">{settings.value.installmentLimitPercent}%</span>
              </SettingRow>
            </dl>
          )}
          <p className="mt-4 text-sm">
            Check-in locations are on <Link href={SETUP_PATHS.checkInSetup}>Check-in Setup</Link>.
          </p>
          {d && (d.basicPercentDefault !== undefined || d.insuranceBasicDefault !== undefined) && (
            <dl className="mt-4">
              {d.basicPercentDefault !== undefined && (
                <SettingRow label="Basic share of the gross for new contracts">
                  <span className="tabular-nums">{d.basicPercentDefault}%</span>
                </SettingRow>
              )}
              {d.insuranceBasicDefault !== undefined && (
                <SettingRow label="Basic wage on social insurance forms (default)">
                  <span className="tabular-nums">{formatEgp(d.insuranceBasicDefault)}</span>
                </SettingRow>
              )}
            </dl>
          )}
        </>
      )}
    </SetupSection>
  );
}
