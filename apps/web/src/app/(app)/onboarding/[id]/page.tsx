import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CLEARANCE_ITEM_STATUS_LABELS, CLEARANCE_OWNER_LABELS, ONBOARDING_STATUS_LABELS, type OnboardingView } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { AddItemForm, ItemActions } from '../../offboarding/forms';
import { ITEM_STYLE, progressText } from '../../offboarding/offboarding';
import { ActionButton } from '../../recruitment/forms';
import { applicantHref } from '../../recruitment/recruitment';
import { addOnboardingItem, completeOnboarding, markOnboardingItem } from '../actions';
import { loadOnboarding, onboardingNotLoaded } from '../data';
import { ONBOARDING_PATH, STATUS_STYLE } from '../onboarding';

// An onboarding checklist (owner, 22 October 2026, the ATS's Phase 2; the brief: "ID & documents, JD sign-off, KPI
// template assignment"): who joins and when, the application they were hired from, and the items: three ticked by the
// system (the contract signed, the job title's KPI template published, something handed over in custody), then HR's
// defaults and any one-off items, each cleared by its owner or by HR, the CEO or a Super Admin. Completed once every
// item is cleared. Those who only clear items see the checklist alone.

export const metadata: Metadata = { title: 'Onboarding · People System' };

const HINT: Record<string, string> = {
  contract: 'Done once their contract is signed, on the Employment tab.',
  kpi_template: 'Done once their job title’s KPI template is published, under KPIs → KPI Templates.',
  assets: 'Done once something is handed over to them on Assets → Custody.',
};

function Checklist({ c }: { c: OnboardingView }) {
  return (
    <ol className="divide-y divide-line-soft">
      {c.items.map((i) => (
        <li key={i.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{i.label}</p>
              <p className="text-xs text-muted">
                {CLEARANCE_OWNER_LABELS[i.owner]}
                {i.kind !== 'manual' && ' · ticked by the system'}
                {i.doneBy && ` · ${i.doneBy}`}
                {i.doneAt && `, ${formatDateTime(i.doneAt)}`}
              </p>
              {i.note && <p className="mt-1 text-sm">{i.note}</p>}
            </div>
            <span className={`badge ${ITEM_STYLE[i.status]}`}>{CLEARANCE_ITEM_STATUS_LABELS[i.status]}</span>
          </div>
          {i.kind !== 'manual' && c.status === 'open' && i.status === 'pending' && <p className="text-sm text-muted">{HINT[i.kind]}</p>}
          {i.canMark && <ItemActions action={markOnboardingItem.bind(null, c.id, i.id)} status={i.status} note={i.note} />}
        </li>
      ))}
    </ol>
  );
}

async function Onboarding({ params }: { params: PageProps<'/onboarding/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadOnboarding(id);
  if (loaded.kind !== 'ok') return <Empty>{onboardingNotLoaded(loaded, 'onboarding checklist')}</Empty>;
  const c = loaded.value;
  const pending = c.progress.total - c.progress.cleared;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {c.can.manage && <BackLink href={ONBOARDING_PATH}>Onboarding</BackLink>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.employee.fullNameEn}</h1>
          <span className={`badge ${STATUS_STYLE[c.status]}`}>{ONBOARDING_STATUS_LABELS[c.status]}</span>
        </div>
        <p className="text-sm text-muted">
          {[c.employee.employeeCode, c.jobTitle, c.department].filter(Boolean).join(' · ')} · joins {formatDate(c.joinDate)}
        </p>
        <p className="text-sm">
          <Link href={`/employees/${c.employee.id}`}>Open their profile</Link>
          {c.application && c.can.manage && (
            <>
              {' · '}
              <Link href={applicantHref(c.application.id)}>Hired from {c.application.number}</Link>
            </>
          )}
        </p>
      </div>
      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Checklist</h2>
          <p className="text-sm text-muted">{progressText(c.progress)}</p>
        </div>
        <Checklist c={c} />
        {c.can.addItem && <AddItemForm action={addOnboardingItem.bind(null, c.id)} />}
      </section>
      {c.can.complete && (
        <section className="card space-y-2 p-6">
          <h2 className="text-lg font-semibold">Complete</h2>
          {pending > 0 ? (
            <p className="text-sm text-muted">Every item must be done or not applicable first: {pending} still pending.</p>
          ) : (
            <ActionButton action={completeOnboarding.bind(null, c.id)} label="Complete onboarding" pendingLabel="Completing…" kind="primary" confirm="Complete this onboarding? Its items can’t change after." />
          )}
        </section>
      )}
      {c.status === 'completed' && (
        <p className="text-sm text-muted">
          Completed{c.completedAt ? ` ${formatDateTime(c.completedAt)}` : ''}
          {c.completedBy ? ` by ${c.completedBy}` : ''}.
        </p>
      )}
    </div>
  );
}

export default function OnboardingChecklistPage({ params }: PageProps<'/onboarding/[id]'>) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<Loading />}>
        <Onboarding params={params} />
      </Suspense>
    </div>
  );
}
