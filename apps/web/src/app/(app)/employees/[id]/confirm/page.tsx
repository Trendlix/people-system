import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { CONFIRM_FIELDS, CONFIRM_SECTION_LABELS, CONFIRM_SECTIONS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { ARABIC_FIELDS, fieldNames, pendingRequest, profileValue } from '../../confirmation';
import { confirmDetails } from '../../confirmation-actions';
import { loadEmployee } from '../../data';
import { EditHeading, FieldGrid, Loading, ProfileSection } from '../../ui';
import { ConfirmForm } from './confirm-form';

// The employee checks their own details and confirms them, accepting responsibility for them (owner's decision, 15
// October 2026): once, and again after every change. Nothing is edited here: what is wrong goes to HR as a change
// request. Only for the employee themself (the API checks this again); anyone else is sent to the profile.

const changedNote = <span className="badge bg-warn-soft text-warn">Changed since you last confirmed</span>;

async function Confirm({ params }: { params: Promise<{ id: string }> }) {
  const p = await loadEmployee(params);
  if (!p.isSelf || !p.confirmation) redirect(`/employees/${p.id}`);
  const c = p.confirmation;
  const changed = new Set(c.changedFields);
  const pending = pendingRequest(p.changeRequests);
  const requestHref = `/employees/${p.id}/change-request`;

  const requestLink = pending ? (
    <p className="text-sm">
      Your change request of {formatDate(pending.requestedAt)} is waiting for HR. <Link href={requestHref}>See your request</Link>
    </p>
  ) : (
    <Link href={requestHref} className="btn btn-secondary">
      Request a change
    </Link>
  );

  return (
    <>
      <EditHeading profile={p} title="Confirm Your Details" />

      {c.upToDate && c.confirmedAt ? (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          You confirmed your details on {formatDate(c.confirmedAt)}. Nothing has changed since.
        </p>
      ) : c.confirmedAt && c.changedFields.length > 0 ? (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Changed since you confirmed on {formatDate(c.confirmedAt)}: {fieldNames(c.changedFields)}. Check them below, then confirm again.
        </p>
      ) : null}

      <p className="max-w-3xl text-sm text-muted">
        These are the details HR keeps on your profile. Check each one. If they are all correct, accept the statement at the end and confirm
        them. If anything is wrong or missing, request a change: HR checks it, and your profile is updated once HR approves it.
      </p>

      <div className="max-w-5xl space-y-8">
        {CONFIRM_SECTIONS.map((section) => (
          <ProfileSection key={section} title={CONFIRM_SECTION_LABELS[section]}>
            <FieldGrid
              fields={CONFIRM_FIELDS.filter((f) => f.section === section).map((f) => ({
                key: f.key,
                label: f.label,
                value: profileValue(p, f.key),
                ar: ARABIC_FIELDS.has(f.key),
                note: changed.has(f.key) ? changedNote : undefined,
              }))}
            />
          </ProfileSection>
        ))}
      </div>

      <div className="max-w-3xl">
        {c.upToDate ? (
          <div className="card space-y-3 p-6">
            <h2 className="font-semibold">Something Wrong?</h2>
            <p className="text-sm text-muted">If any detail is wrong or out of date, ask HR to change it.</p>
            {requestLink}
          </div>
        ) : (
          <ConfirmForm action={confirmDetails.bind(null, p.id)}>{requestLink}</ConfirmForm>
        )}
      </div>
    </>
  );
}

export default function ConfirmPage({ params }: PageProps<'/employees/[id]/confirm'>) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <Confirm params={params} />
      </Suspense>
    </div>
  );
}
