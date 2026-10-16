import { CONTRACT_FORM_LABELS, END_REASON_LABELS, ENDING_RULES } from '@trendlix/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { ContractSettings, EndingRule } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { seesPayrollSettings } from '../payroll/settings';
import { Empty, Loading } from '../ui';
import { updateContractSettings } from './actions';
import { ContractDefaultsForm } from './defaults-form';
import { INITIATOR_LABELS, monthsLabel, noticeLabel } from './labels';

// What a new contract starts with, and the ways an employment can end (owner's decisions of 15 October 2026, checked
// against Labour Law 14/2025). Everyone signed in can see them; HR and Admin change them (the API checks this again).
// The basic share of the gross a new contract starts with and the basic wage social insurance forms print by default
// change the payroll sheet, so they are changed on Payroll Setup (owner's request, 16 October 2026); they are shown
// here, with the way there.

/** The rules in the order the shared list gives them (probation first); any the list doesn't know go last. */
function inOrder(rules: EndingRule[]): EndingRule[] {
  const place = (r: EndingRule) => {
    const i = (ENDING_RULES as readonly string[]).indexOf(r.key);
    return i === -1 ? ENDING_RULES.length : i;
  };
  return [...rules].sort((a, b) => place(a) - place(b));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

async function ContractsAndEndings() {
  const [user, settings, rules] = await Promise.all([
    getCurrentUser(),
    apiGet<ContractSettings>('/contract-settings'),
    apiGet<EndingRule[]>('/ending-rules'),
  ]);
  const canEdit = canEditOrganisation(user);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        How contracts start and how an employment can end, following the company&apos;s decisions and Labour Law 14/2025. A
        signed contract keeps the rules it was signed under, so a change here applies to contracts signed afterwards.
      </p>

      <section className="card p-6">
        <h2 className="font-semibold">Contract Defaults</h2>
        <p className="mt-1 text-sm text-muted">What every new contract starts with.</p>
        {canEdit ? (
          <ContractDefaultsForm action={updateContractSettings} settings={settings} />
        ) : (
          <dl className="mt-3">
            <Row label="Contract">
              {CONTRACT_FORM_LABELS.fixed}, {monthsLabel(settings.durationMonths)}
            </Row>
            <Row label="Probation">
              {monthsLabel(settings.probationMonths, 'No probation')}
              <span className="text-muted"> · the law allows it once per employer, up to 3 months (Art. 90)</span>
            </Row>
          </dl>
        )}
        {(settings.basicPercentDefault !== undefined || settings.insuranceBasicDefault !== undefined) && (
          <>
            <dl className={canEdit ? 'mt-6 border-t border-line-soft pt-3' : ''}>
              {settings.basicPercentDefault !== undefined && (
                <Row label="Basic share of the gross">
                  <span className="tabular-nums">{settings.basicPercentDefault}%</span>
                  <span className="text-muted"> · the rest is the variable part, which follows the KPIs</span>
                </Row>
              )}
              {settings.insuranceBasicDefault !== undefined && (
                <Row label="Basic wage on social insurance forms (default)">
                  <span className="tabular-nums">{formatEgp(settings.insuranceBasicDefault)}</span>
                  <span className="text-muted"> · for an employee without a basic wage of their own</span>
                </Row>
              )}
            </dl>
            <p className="mt-2 text-sm text-muted">
              These change the payroll sheet, so they are set with the payroll rules
              {seesPayrollSettings(user) ? (
                <>
                  : <Link href="/organization/payroll#your-rules">Payroll Setup → Your Rules</Link>.
                </>
              ) : (
                ', on Payroll Setup.'
              )}
            </p>
          </>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Ending Rules</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The ways an employment can end, and the notice each needs. Pay in lieu: the notice can be paid instead of worked.
          HR can choose only the offered rules when recording an ending; HR approves it, then the CEO.
        </p>
        {rules.length === 0 ? (
          <div className="mt-4">
            <Empty>No ending rules yet.</Empty>
          </div>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Started By</th>
                  <th>Notice</th>
                  <th>
                    Pay in Lieu<span className="sr-only">: notice can be paid instead of worked</span>
                  </th>
                  <th>Ends As</th>
                  <th>Legal Source</th>
                  <th>Offered</th>
                  {canEdit && (
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {inOrder(rules).map((r) => (
                  <tr key={r.key} className={r.active ? undefined : 'text-muted'}>
                    <td className="min-w-48 font-medium">{r.label}</td>
                    <td className="whitespace-nowrap">{INITIATOR_LABELS[r.initiator] ?? r.initiator}</td>
                    <td className="whitespace-nowrap">{noticeLabel(r.noticeAmount, r.noticeUnit)}</td>
                    <td>{r.noticeAmount > 0 ? (r.payInLieu ? 'Yes' : 'No') : <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap">{END_REASON_LABELS[r.endReason] ?? r.endReason}</td>
                    <td className="min-w-44 text-xs text-muted">{r.source}</td>
                    <td>
                      {r.active ? <span className="badge bg-ok-soft text-ok">Offered</span> : <span className="badge bg-line-soft text-muted">Not offered</span>}
                    </td>
                    {canEdit && (
                      <td className="text-right">
                        <Link href={`/organization/contracts/rules/${r.key}`}>
                          Edit<span className="sr-only"> {r.label}</span>
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ContractsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ContractsAndEndings />
    </Suspense>
  );
}
