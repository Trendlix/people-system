import Link from 'next/link';
import type { EmployeeProfile } from '@/lib/types';
import { formatEgp } from '../contracts/salary';
import { ProfileSection } from '../../ui';
import { accountHref, clientAccountsNote, periodText, showsClientAccounts, STANDING_LABELS, STANDING_TONES } from './client-accounts';
import { loadEmployeeClientAccounts } from './data';

// Client Accounts on the Employment tab's Details (owner, 25 October 2026: an accounts allowance per client account
// assigned): the person's accounts with their dates, and their amount a month for those who see salaries; for HR, the
// CEO, Finance and a Super Admin every one, current, to come and ended, each linking to the account on Clients → Client
// Accounts (where they are assigned and changed); for the person themself and their direct manager the current ones'
// names and dates alone, the amount being on the payslip. Nothing for anyone else (the API answers 404).

export async function ClientAccountsSection({ employee }: { employee: Pick<EmployeeProfile, 'id' | 'fullNameEn'> }) {
  const view = await loadEmployeeClientAccounts(employee.id);
  if (!view || !showsClientAccounts(view)) return null;
  const { assignments, seesAmounts, full } = view;
  return (
    <ProfileSection title="Client Accounts" note={clientAccountsNote(view)} restricted={seesAmounts}>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted">
          {employee.fullNameEn} is on no client account. HR assigns people to accounts under <Link href="/clients/accounts">Clients → Client Accounts</Link>.
        </p>
      ) : (
        <div className="space-y-2">
          <ul className="divide-y divide-line rounded-lg border border-line bg-white" aria-label={`${employee.fullNameEn}’s client accounts`}>
            {assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{full ? <Link href={accountHref(a.account.id)}>{a.account.nameEn}</Link> : a.account.nameEn}</span>
                    {a.account.code && <span className="text-xs text-muted">{a.account.code}</span>}
                    {full && <span className={`badge ${STANDING_TONES[a.standing]}`}>{STANDING_LABELS[a.standing]}</span>}
                  </p>
                  <p className="tabular-nums text-muted">{periodText(a)}</p>
                  {a.note && <p className="break-words text-muted">{a.note}</p>}
                </div>
                {seesAmounts && a.amount !== null && <p className="tabular-nums">{formatEgp(a.amount)} a month</p>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            {full
              ? 'Paid as the accounts allowance when the contract has it: each account’s amount for the days held in the month.'
              : 'The accounts allowance for these accounts shows on the payslip.'}
          </p>
        </div>
      )}
    </ProfileSection>
  );
}
