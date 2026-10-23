import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { GENERAL_CV_EVENT_LABELS, GENERAL_CV_SOURCE_LABELS, GENERAL_CV_STATUS_LABELS, VACANCY_STATUS_LABELS, type GeneralCvView } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { RehireWarning } from '../../../offboarding/rehire-warning';
import { FromTheCv } from '../../cv-card';
import { loadGeneralCv, loadVacancies, recruitmentNotLoaded } from '../../data';
import { ActionButton, NotesForm } from '../../forms';
import { moveGeneralCv, saveGeneralCvNotes, setGeneralCvStatus } from '../../general-actions';
import { generalCvFileHref, GENERAL_STATUS_STYLE, movableVacancies, tabHref } from '../../general';
import { MoveForm } from '../../general-forms';
import { applicantHref } from '../../recruitment';
import { shownCode } from '@/lib/hidden';

// A general CV (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on
// randomly", "Both"): who sent it, the area they would like to work in, how it came (the careers page, or HR from email,
// WhatsApp, LinkedIn, in person or a referral), their consent (whose, when), the CV, HR's notes and its history. HR marks
// it reviewed, archives (and restores) it, or adds it to an open vacancy at Applied or Shortlisted: an application made
// from it, with the same reference. A warning when they worked here before (offboarding's rehire check).

export const metadata: Metadata = { title: 'General CV · People System' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

async function AddToVacancy({ c }: { c: GeneralCvView }) {
  const loaded = await loadVacancies({ status: 'active', q: '' });
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'vacancies')}</Empty>;
  const vacancies = movableVacancies(loaded.value).map((v) => ({
    id: v.id,
    label: `${v.title} (${v.number})${v.status === 'on_hold' ? ` · ${VACANCY_STATUS_LABELS.on_hold}` : ''}`,
  }));
  return <MoveForm action={moveGeneralCv.bind(null, c.id)} vacancies={vacancies} />;
}

async function GeneralCv({ params }: { params: PageProps<'/recruitment/general-cvs/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadGeneralCv(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'general CV')}</Empty>;
  const c = loaded.value;
  const consentBy = c.consentBy ? `recorded by ${c.consentBy.name ?? c.consentBy.email}` : 'given on the careers page';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={tabHref('general')}>General CVs</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.fullName}</h1>
          <span className={`badge ${GENERAL_STATUS_STYLE[c.status]}`}>{GENERAL_CV_STATUS_LABELS[c.status]}</span>
        </div>
        <p className="text-sm text-muted">
          {shownCode(c.number) && `${c.number} · `}
          received {formatDateTime(c.receivedAt)} · {GENERAL_CV_SOURCE_LABELS[c.source]}
          {c.referrer ? `, referred by ${c.referrer}` : ''}
          {c.addedBy ? ` · added by ${c.addedBy.name ?? c.addedBy.email}` : ''}
        </p>
      </div>

      <RehireWarning email={c.email} />

      {c.movedTo && (
        <div role="note" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Added to <span className="font-semibold">{c.movedTo.vacancyTitle}</span>:{' '}
          <Link href={applicantHref(c.movedTo.applicationId)} className="font-semibold">
            open the application{shownCode(c.movedTo.reference) && ` (${c.movedTo.reference})`}
          </Link>
        </div>
      )}

      {(c.can.review || c.can.archive || c.can.restore) && (
        <div className="flex flex-wrap items-start gap-2">
          {c.can.review && <ActionButton action={setGeneralCvStatus.bind(null, c.id, 'review')} label="Mark as reviewed" pendingLabel="Saving…" kind="primary" />}
          {c.can.restore && <ActionButton action={setGeneralCvStatus.bind(null, c.id, 'restore')} label="Restore" pendingLabel="Restoring…" kind="primary" />}
          {c.can.archive && <ActionButton action={setGeneralCvStatus.bind(null, c.id, 'archive')} label="Archive" pendingLabel="Archiving…" confirm={`Archive ${shownCode(c.number) ?? 'this CV'}? It can be restored.`} />}
        </div>
      )}

      {c.can.move && (
        <section aria-labelledby="general-move" className="card space-y-3 p-6">
          <h2 id="general-move" className="text-lg font-semibold">
            Add to a Vacancy
          </h2>
          <Suspense fallback={<Loading />}>
            <AddToVacancy c={c} />
          </Suspense>
        </section>
      )}

      <section aria-labelledby="general-details" className="card space-y-4 p-6">
        <h2 id="general-details" className="text-lg font-semibold">
          Details
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Email">
            <a href={`mailto:${c.email}`}>{c.email}</a>
          </Fact>
          <Fact label="Mobile">
            <a href={`tel:${c.mobile.replace(/[^\d+]/g, '')}`}>{c.mobile}</a>
          </Fact>
          <Fact label="Area of interest">{c.area}</Fact>
          <Fact label="Experience">{c.yearsExperience === null ? '—' : `${c.yearsExperience} years`}</Fact>
          <Fact label="LinkedIn">
            {c.linkedin ? (
              <a href={c.linkedin} target="_blank" rel="noopener noreferrer nofollow">
                Open profile
              </a>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Portfolio">
            {c.portfolio ? (
              <a href={c.portfolio} target="_blank" rel="noopener noreferrer nofollow">
                Open portfolio
              </a>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Notice period">{c.noticePeriod ?? '—'}</Fact>
          <Fact label="Expected salary, EGP a month">{c.expectedSalary === null ? '—' : c.expectedSalary.toLocaleString('en-US')}</Fact>
          <Fact label="Consent">
            {formatDate(c.consentAt)}, {consentBy}
            {c.consentNote && <span className="block text-xs text-muted">{c.consentNote}</span>}
          </Fact>
          <Fact label="CV">
            {c.cv ? (
              <span className="flex flex-wrap gap-3">
                {c.cv.mimeType === 'application/pdf' && (
                  <a href={generalCvFileHref(c.id)} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                )}
                <a href={generalCvFileHref(c.id, true)}>Download</a>
                <span className="text-muted">{Math.max(1, Math.round(c.cv.sizeBytes / 1024))} KB</span>
              </span>
            ) : (
              'None'
            )}
          </Fact>
        </dl>
      </section>

      {/* What the CV's text says (22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"). */}
      {c.cv && c.cvReading && (
        <Suspense fallback={<Loading />}>
          <FromTheCv reading={c.cvReading} subject={{ generalCvId: c.id }} />
        </Suspense>
      )}

      {c.can.editNotes ? (
        <section aria-labelledby="general-notes" className="card space-y-2 p-6">
          <h2 id="general-notes" className="text-lg font-semibold">
            Notes
          </h2>
          <NotesForm action={saveGeneralCvNotes.bind(null, c.id)} notes={c.notes} />
        </section>
      ) : (
        c.notes && (
          <section aria-labelledby="general-notes" className="card space-y-2 p-6">
            <h2 id="general-notes" className="text-lg font-semibold">
              Notes
            </h2>
            <p className="text-sm whitespace-pre-line">{c.notes}</p>
          </section>
        )
      )}

      <section aria-labelledby="general-history" className="card space-y-2 p-6">
        <h2 id="general-history" className="text-lg font-semibold">
          History
        </h2>
        <ol className="space-y-2 text-sm">
          {c.history.map((h, i) => (
            <li key={i}>
              <span className="font-semibold">{GENERAL_CV_EVENT_LABELS[h.event] ?? h.event}</span>
              {h.note && <span> · {h.note}</span>}
              <span className="block text-xs text-muted">
                {formatDateTime(h.at)}
                {h.by ? ` · ${h.by.name ?? h.by.email}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function GeneralCvPage({ params }: PageProps<'/recruitment/general-cvs/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <GeneralCv params={params} />
      </Suspense>
    </div>
  );
}
