import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { FEEDBACK_CRITERIA, FEEDBACK_CRITERION_LABELS, INTERVIEW_KIND_LABELS, INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, RECOMMENDATION_LABELS, type CandidateView } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { mergeWithCode, undoMerge } from '../../candidate-actions';
import { MergeWithForm } from '../../candidate-forms';
import { CandidateApplicationsTable, CandidateGeneralCvsTable, EmployeeCard, MatchesCard } from '../../candidate-ui';
import { candidateHref, CANDIDATES_PATH, timelineByDay } from '../../candidates';
import { loadCandidate, recruitmentNotLoaded } from '../../data';
import { ActionButton } from '../../forms';
import { generalCvFileHref } from '../../general';
import { interviewWhen } from '../../hiring';
import { applicantCvHref, applicantHref, readsRecruitment, WHO_SEES } from '../../recruitment';

// A candidate's profile (owner, 22 October 2026: "how to make like a profile for each candidate to store history and
// prevent duplication? even if the same candidate applied for 2 jobs"; "Email or mobile"; "Link and show rehire"; "HR
// decides from suggested match"): every email and mobile they used, every CV they sent, their applications (the job,
// the date, the stage or outcome, the rejection's reason, the CV match), general CVs, interviews and scorecards, offers,
// the employee they are, the possible duplicates and suggested matches, and a timeline of everything by date. HR merges
// another candidate into it ("Merge with…", or a match confirmed); a Super Admin undoes a merge. HR, the CEO and a
// Super Admin only.

export const metadata: Metadata = { title: 'Candidate · People System' };

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Contacts({ c }: { c: CandidateView }) {
  return (
    <section aria-labelledby="candidate-contacts" className="card space-y-4 p-6">
      <h2 id="candidate-contacts" className="text-lg font-semibold">
        Contact Details
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Emails</p>
          {c.emailContacts.length === 0 && <p className="text-sm text-muted">None kept</p>}
          <ul className="space-y-1 text-sm">
            {c.emailContacts.map((e) => (
              <li key={e.email} className="break-words">
                <a href={`mailto:${e.email}`}>{e.email}</a>
                <span className="block text-xs text-muted">
                  Last used {formatDate(e.lastSeenAt)}
                  {e.firstSeenAt !== e.lastSeenAt ? ` · first ${formatDate(e.firstSeenAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Mobiles</p>
          {c.mobileContacts.length === 0 && <p className="text-sm text-muted">None kept</p>}
          <ul className="space-y-1 text-sm">
            {c.mobileContacts.map((m) => (
              <li key={m.mobile}>
                <a href={`tel:${m.mobile.replace(/[^\d+]/g, '')}`}>{m.mobile}</a>
                <span className="block text-xs text-muted">
                  Last used {formatDate(m.lastSeenAt)}
                  {m.firstSeenAt !== m.lastSeenAt ? ` · first ${formatDate(m.firstSeenAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {(c.linkedin || c.portfolio) && (
        <p className="flex flex-wrap gap-4 text-sm">
          {c.linkedin && (
            <a href={c.linkedin} target="_blank" rel="noopener noreferrer nofollow">
              LinkedIn profile
            </a>
          )}
          {c.portfolio && (
            <a href={c.portfolio} target="_blank" rel="noopener noreferrer nofollow">
              Portfolio
            </a>
          )}
        </p>
      )}
    </section>
  );
}

function Cvs({ c }: { c: CandidateView }) {
  if (!c.cvs.length) return null;
  return (
    <section aria-labelledby="candidate-cvs" className="card space-y-2 p-6">
      <h2 id="candidate-cvs" className="text-lg font-semibold">
        CVs
      </h2>
      <ul className="space-y-2 text-sm">
        {c.cvs.map((cv) => {
          const open = cv.kind === 'application' ? applicantCvHref(cv.id) : generalCvFileHref(cv.id);
          const download = cv.kind === 'application' ? applicantCvHref(cv.id, true) : generalCvFileHref(cv.id, true);
          return (
            <li key={`${cv.kind}-${cv.id}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-2 last:border-b-0 last:pb-0">
              <span className="min-w-0">
                <span className="font-semibold break-words">{cv.cvFileName}</span>
                <span className="block text-xs text-muted">
                  {cv.title} · {cv.reference} · sent {formatDate(cv.sentAt)} · {kb(cv.sizeBytes)}
                </span>
              </span>
              <span className="flex gap-3">
                {cv.mimeType === 'application/pdf' && (
                  <a href={open} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                )}
                <a href={download}>Download</a>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Interviews({ c }: { c: CandidateView }) {
  if (!c.interviews.length) return null;
  return (
    <section aria-labelledby="candidate-interviews" className="card space-y-3 p-6">
      <h2 id="candidate-interviews" className="text-lg font-semibold">
        Interviews and Feedback
      </h2>
      <ul className="space-y-4">
        {c.interviews.map((i) => (
          <li key={i.id} className="space-y-1 border-b border-line-soft pb-3 last:border-b-0 last:pb-0">
            <p className="font-semibold">
              {interviewWhen(i.startsAt, i.minutes)} · {INTERVIEW_KIND_LABELS[i.kind]} · {INTERVIEW_STATUS_LABELS[i.status]}
            </p>
            <p className="text-sm">
              <Link href={applicantHref(i.application.id)}>{i.vacancyTitle}</Link>
              <span className="text-muted"> · with {i.interviewers.map((x) => x.name).join(', ')}</span>
            </p>
            {i.feedback.map((f) => (
              <div key={f.id} className="text-sm">
                <p>
                  <span className="font-semibold">{f.interviewer.name}</span> · {RECOMMENDATION_LABELS[f.recommendation]}
                </p>
                <p className="text-xs text-muted">{FEEDBACK_CRITERIA.map((k) => `${FEEDBACK_CRITERION_LABELS[k]} ${f.ratings[k]}/5`).join(' · ')}</p>
                {f.notes && <p className="whitespace-pre-line">{f.notes}</p>}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Offers({ c }: { c: CandidateView }) {
  if (!c.offers.length) return null;
  return (
    <section aria-labelledby="candidate-offers" className="card space-y-2 p-6">
      <h2 id="candidate-offers" className="text-lg font-semibold">
        Job Offers
      </h2>
      <ul className="space-y-1 text-sm">
        {c.offers.map((o) => (
          <li key={o.id}>
            <Link href={`/offers/${o.id}`}>{o.number}</Link>
            <span className="text-muted">
              {' '}
              · {OFFER_STATUS_LABELS[o.status as keyof typeof OFFER_STATUS_LABELS] ?? o.status}
              {o.vacancyTitle ? ` · ${o.vacancyTitle}` : ''} · {formatDate(o.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Merges({ c }: { c: CandidateView }) {
  if (!c.merges.length) return null;
  return (
    <section aria-labelledby="candidate-merges" className="card space-y-2 p-6">
      <h2 id="candidate-merges" className="text-lg font-semibold">
        Merged Into This Profile
      </h2>
      <ul className="space-y-3 text-sm">
        {c.merges.map((m) => (
          <li key={m.id} className="flex flex-wrap items-start justify-between gap-2">
            <span>
              <Link href={candidateHref(m.merged.id)}>{m.merged.code}</Link> · {formatDateTime(m.at)}
              {m.by ? ` · by ${m.by}` : ''}
              <span className="block text-xs text-muted">
                {m.moved.applications} {m.moved.applications === 1 ? 'application' : 'applications'}, {m.moved.generalCvs} general {m.moved.generalCvs === 1 ? 'CV' : 'CVs'}, {m.moved.contacts}{' '}
                {m.moved.contacts === 1 ? 'contact' : 'contacts'} moved
                {m.undoneAt ? ` · undone ${formatDateTime(m.undoneAt)}` : ''}
              </span>
            </span>
            {m.canUndo && <ActionButton action={undoMerge.bind(null, m.id)} label="Undo merge" pendingLabel="Undoing…" confirm={`Undo the merge of ${m.merged.code}? What moved goes back to it.`} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ c }: { c: CandidateView }) {
  if (!c.timeline.length) return null;
  return (
    <section aria-labelledby="candidate-timeline" className="card space-y-3 p-6">
      <h2 id="candidate-timeline" className="text-lg font-semibold">
        Timeline
      </h2>
      <ol className="space-y-3">
        {timelineByDay(c.timeline).map((d) => (
          <li key={d.day}>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{formatDate(d.day)}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {d.items.map((t, i) => (
                <li key={`${t.at}-${i}`}>
                  {t.href ? <Link href={t.href}>{t.text}</Link> : t.text}
                  <span className="text-xs text-muted"> · {formatDateTime(t.at)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function Candidate({ params }: { params: PageProps<'/recruitment/candidates/[id]'>['params'] }) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  if (!UUID.test(id)) return <Empty>Candidate not found.</Empty>;
  const loaded = await loadCandidate(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'candidate')}</Empty>;
  const c = loaded.value;
  // merged into another: that one is the profile now
  if (c.mergedInto) redirect(candidateHref(c.mergedInto.id));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={CANDIDATES_PATH}>Candidates</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.fullName}</h1>
          <span className="badge bg-canvas text-ink">{c.code}</span>
          {c.employee && <span className="badge bg-warn-soft text-warn">{c.employee.restricted ? 'Employee record' : c.employee.state === 'former' ? 'Former employee' : 'Employee'}</span>}
        </div>
        <p className="text-sm text-muted">
          {c.applications.length} {c.applications.length === 1 ? 'application' : 'applications'}
          {c.generalCvs.length ? ` · ${c.generalCvs.length} general ${c.generalCvs.length === 1 ? 'CV' : 'CVs'}` : ''}
          {c.lastAppliedAt ? ` · last applied ${formatDate(c.lastAppliedAt)}` : ''}
        </p>
      </div>

      {c.can.merge && <MergeWithForm action={mergeWithCode.bind(null, c.id)} code={c.code} />}

      {c.employee && <EmployeeCard link={c.employee} />}

      <MatchesCard matches={c.matches} selfId={c.id} manages={c.can.merge} />

      <Contacts c={c} />

      {c.applications.length > 0 && (
        <section aria-labelledby="candidate-applications" className="card overflow-hidden">
          <h2 id="candidate-applications" className="px-6 pt-5 text-lg font-semibold">
            Applications
          </h2>
          <CandidateApplicationsTable rows={c.applications} />
        </section>
      )}

      {c.generalCvs.length > 0 && (
        <section aria-labelledby="candidate-general" className="card overflow-hidden">
          <h2 id="candidate-general" className="px-6 pt-5 text-lg font-semibold">
            General CVs
          </h2>
          <CandidateGeneralCvsTable rows={c.generalCvs} />
        </section>
      )}

      <Cvs c={c} />
      <Interviews c={c} />
      <Offers c={c} />
      <Merges c={c} />
      <Timeline c={c} />
    </div>
  );
}

export default function CandidatePage({ params }: PageProps<'/recruitment/candidates/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <Candidate params={params} />
      </Suspense>
    </div>
  );
}
