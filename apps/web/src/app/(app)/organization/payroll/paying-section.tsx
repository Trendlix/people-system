import { canEditOrganisation } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { updatePayingSalaries } from './actions';
import { loadPayrollSettings } from './data';
import { PayingSalariesForm } from './paying-form';
import { NotLoaded, notSet, SettingRow, SetupSection } from './section';
import { dayOfMonth } from './settings';

// Payroll Setup, 4 Paying Salaries (owner's request, 16 October 2026): how the salaries are paid. CIB accounts through
// CIB's payroll system file, from the company's CIB account; every other bank through the ACH file (owner's decision,
// 16 October 2026). The payday, the day of the month the salaries are paid, in the month after the run's: Mark as paid
// starts from it. HR and Admin change these (PATCH /payroll/settings); Finance and the CEO read them.

const INTRO =
  'How the salaries are paid: CIB accounts through the CIB payroll file, from the company’s account below, and every other bank through the ACH file. Each employee’s own bank details are on their profile. The payday is the date a run is marked paid on, to start with.';

export async function PayingSalariesSection({ user }: { user: SessionUser }) {
  const settings = await loadPayrollSettings();

  return (
    <SetupSection id="paying-salaries" title="Paying Salaries" intro={INTRO}>
      {settings.kind !== 'ok' ? (
        <NotLoaded what="the payroll settings" loaded={settings} />
      ) : canEditOrganisation(user) ? (
        <PayingSalariesForm action={updatePayingSalaries} settings={settings.value} />
      ) : (
        <dl>
          <SettingRow label="CIB account the salaries are paid from">
            {settings.value.cibDebitAccount ? <span className="tabular-nums">{settings.value.cibDebitAccount}</span> : notSet}
          </SettingRow>
          <SettingRow label="Account name">{settings.value.cibDebitAccountName ?? notSet}</SettingRow>
          <SettingRow label="ACH purpose">{settings.value.achPurpose || notSet}</SettingRow>
          {settings.value.payday !== undefined && (
            <SettingRow label="Payday">
              {settings.value.payday ? (
                <>
                  On {dayOfMonth(settings.value.payday)} of the month after the one the salaries are for
                  <span className="text-muted"> · a day past a month&apos;s end is its last day</span>
                </>
              ) : (
                notSet
              )}
            </SettingRow>
          )}
        </dl>
      )}
    </SetupSection>
  );
}
