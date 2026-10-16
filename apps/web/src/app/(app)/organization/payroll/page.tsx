import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { PayrollSettingsView } from '@/lib/types';
import { rulesSummary } from '../../payroll/list';
import { Empty, Loading } from '../ui';
import { updatePayrollSettings } from './actions';
import { PayrollSettingsForm } from './settings-form';
import { seesPayrollSettings } from './settings';

// The payroll settings (owner's decisions, 16 October 2026): the rules runs are worked out with, after the owner's
// payroll sheet with its formula errors fixed, and what the bank files need (the company's CIB account the salaries are
// paid from, its name as CIB has it, the ACH file's purpose). HR, Finance, the CEO and Admin see them; HR and Admin
// change them (the API checks this again). A run keeps the rules it was made or last refreshed with.

type Loaded = { kind: 'ok'; settings: PayrollSettingsView } | { kind: 'unavailable' } | { kind: 'failed'; message: string };

/** GET /payroll/settings; an API from before payroll answers 404, "not available yet". */
async function loadSettings(): Promise<Loaded> {
  try {
    const res = await apiFetch('/payroll/settings');
    if (res.status === 401) redirect('/login');
    if (res.status === 404) return { kind: 'unavailable' };
    if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
    return { kind: 'ok', settings: (await res.json()) as PayrollSettingsView };
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[16rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const notSet = <span className="text-muted">Not set</span>;

async function PayrollSettings() {
  const user = await getCurrentUser();
  if (!seesPayrollSettings(user)) return <Empty>Only HR, Finance, the CEO and Admin can see the payroll settings.</Empty>;
  const loaded = await loadSettings();
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server does not have payroll yet.</Empty>;
  if (loaded.kind === 'failed') return <Empty>The payroll settings could not be loaded. {loaded.message}</Empty>;
  const s = loaded.settings;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        How each month&apos;s <Link href="/payroll">payroll</Link> is worked out, following the company&apos;s payroll sheet, and what the bank files need. A
        run keeps the rules it was made with until it is refreshed, so a change here applies to runs made or refreshed afterwards.
      </p>
      <section className="card p-6">
        <h2 className="font-semibold">Payroll Settings</h2>
        {canEditOrganisation(user) ? (
          <div className="mt-4">
            <PayrollSettingsForm action={updatePayrollSettings} settings={s} />
          </div>
        ) : (
          <>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {rulesSummary(s).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <h3 className="mt-6 font-semibold">Bank Files</h3>
            <dl className="mt-2">
              <Row label="CIB account the salaries are paid from">{s.cibDebitAccount ? <span className="tabular-nums">{s.cibDebitAccount}</span> : notSet}</Row>
              <Row label="Account name">{s.cibDebitAccountName ?? notSet}</Row>
              <Row label="ACH purpose">{s.achPurpose || notSet}</Row>
            </dl>
          </>
        )}
      </section>
    </div>
  );
}

export default function PayrollSettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PayrollSettings />
    </Suspense>
  );
}
