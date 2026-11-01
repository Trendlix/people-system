import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { CONFIRM_FIELDS, CONFIRM_SECTION_LABELS, CONFIRM_SECTIONS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { ARABIC_FIELDS, bannerMessage, fieldNames, mustReview, pendingRequest, profileValue } from '../../confirmation';
import { confirmDetails } from '../../confirmation-actions';
import { loadEmployee } from '../../data';
import { EditHeading, FieldGrid, Loading, ProfileSection } from '../../ui';
import { ConfirmForm } from './confirm-form';

// The employee checks their own details and confirms them, accepting responsibility for them (owner's decision, 15
// October 2026): once, and again after every change. Nothing is edited here: what is wrong goes to HR as a change
// request. Only for the employee themself (the API checks this again); anyone else is sent to the profile.
// The first step after signing in while it waits (owner, 31 October 2026: "make the data review obligatory upon the
// signin for employees"): every other page sends them here (components/review-gate.tsx) until they confirm, or ask HR for
// a change, which lets them through while HR decides; so the page says why they are here. A new photo of themself goes to
// HR from here too (owner, the same day: "allow them to upload a new photo as a request and approved from the HR").

const changedNote = <span className="badge bg-warn-soft text-warn">Changed since you last confirmed</span>;

async function Confirm({ params }: { params: Promise<{ id: string }> }) {
  const p = await loadEmployee(params);
  if (!p.isSelf || !p.confirmation) redirect(`/employees/${p.id}`);
  const c = p.confirmation;
  const changed = new Set(c.changedFields);
  const pending = pendingRequest(p.changeRequests);
  const requestHref = `/employees/${p.id}/change-request`;
  // held here at sign-in: the rest of People waits for this
  const due = mustReview(c, p.changeRequests);
  const photoWaiting = p.photoRequests?.some((r) => r.status === 'pending');

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

      {due && (
        <section aria-labelledby="review-first" className="max-w-3xl space-y-1.5 rounded-lg border border-warn/20 bg-warn-soft px-4 py-3 text-sm text-warn">
          <h2 id="review-first" className="font-semibold">
            Review your details before you go on
          </h2>
          <p>{bannerMessage(c)}</p>
        </section>
      )}

      {c.upToDate && c.confirmedAt ? (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Confirmed on {formatDate(c.confirmedAt)}.
        </p>
      ) : !due && c.confirmedAt && c.changedFields.length > 0 ? (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Changed since you confirmed on {formatDate(c.confirmedAt)}: {fieldNames(c.changedFields)}.
        </p>
      ) : null}

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
            {requestLink}
          </div>
        ) : (
          <ConfirmForm action={confirmDetails.bind(null, p.id)}>{requestLink}</ConfirmForm>
        )}
      </div>

      <div className="card max-w-3xl space-y-3 p-6">
        <h2 className="font-semibold">Your Photo</h2>
        <Link href={`/employees/${p.id}/photo`} className={photoWaiting ? 'badge bg-warn-soft text-warn no-underline' : 'btn btn-secondary'}>
          {photoWaiting ? 'Your new photo is waiting for HR' : 'Send a new photo'}
        </Link>
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
