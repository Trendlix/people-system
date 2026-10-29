import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { GENERAL_CV_EVENT_LABELS, GENERAL_CV_SOURCE_LABELS, GENERAL_CV_STATUS_LABELS, generalCvKey, type GeneralCvView } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { RehireWarning } from '../../../offboarding/rehire-warning';
import { FromTheCv } from '../../cv-card';
import { CvDialogHost, CvOpenButton } from '../../cv-dialog';
import { OpenPositions } from '../../cv-fit-ui';
import { loadGeneralCv, loadGeneralCvComments, loadVacancies, recruitmentNotLoaded } from '../../data';
import { ActionButton } from '../../forms';
import { moveGeneralCv, setGeneralCvStatus } from '../../general-actions';
import { generalCvFileHref, GENERAL_STATUS_STYLE, positionFacts, tabHref, vacancyChoices } from '../../general';
import { MoveForm } from '../../general-forms';
import { applicantHref } from '../../recruitment';
import { commentsOfRecord, kb, ownCv } from '../../screening';
import { ScreeningCommentsCard } from '../../screening-ui';
import { VerdictBadge } from '../../ui';
import { generalPortfolioHref, portfolioLinksOf } from '../../portfolio';
import { LinkedInMark, PortfolioSent } from '../../portfolio-chips';
import { shownCode } from '@/lib/hidden';

// A general CV (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on
// randomly", "Both"): who sent it, the area they would like to work in, how it came (the careers page, or HR from email,
// WhatsApp, LinkedIn, in person or a referral), their consent (whose, when), the CV, HR's notes and its history. HR marks
// it reviewed, archives (and restores) it, or adds it to an open vacancy at Applied or Shortlisted: an application made
// from it, with the same reference. A warning when they worked here before (offboarding's rehire check).
// Since 24 October 2026 (owner: "when opening a CV, open it in a popup window", "is there a way to add screening
// comments?"): the CV opens in the CV window (?cv=, with the candidate's other CVs before and after it), and the
// Screening Comments card replaces HR's notes (moved into the comments, "HR (earlier notes)"): this CV's comments (and
// the application made from it), with the general ones; the latest verdict beside its status.
// Since 25 October 2026 (owner: "should it be the positions?"; asked, "Position, grouped by team"): the position they would
// like and its team, Team once "Area of interest"; an older CV, sent for an area, has "—" for its position.

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
  return <MoveForm action={moveGeneralCv.bind(null, c.id)} vacancies={vacancyChoices(loaded.value)} />;
}

async function GeneralCv({ params }: { params: PageProps<'/recruitment/general-cvs/[id]'>['params'] }) {
  const { id } = await params;
  const [loaded, commentsLoaded] = await Promise.all([loadGeneralCv(id), loadGeneralCvComments(id)]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'general CV')}</Empty>;
  const c = loaded.value;
  // the screening comments and the CVs the window opens (24 October 2026); the page shows without them if they fail
  const comments = commentsLoaded.kind === 'ok' ? commentsLoaded.value : null;
  const commentsNotLoaded = commentsLoaded.kind === 'ok' ? '' : recruitmentNotLoaded(commentsLoaded, 'screening comments');
  const ownKey = generalCvKey(c.id);
  const cvs = comments?.cvs.length ? comments.cvs : ownCv('general_cv', { id: c.id, reference: c.number, title: 'General CV', sentAt: c.receivedAt }, c.cv);
  const consentBy = c.consentBy ? `recorded by ${c.consentBy.name ?? c.consentBy.email}` : 'given on the careers page';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={tabHref('general')}>General CVs</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.fullName}</h1>
          <span className={`badge ${GENERAL_STATUS_STYLE[c.status]}`}>{GENERAL_CV_STATUS_LABELS[c.status]}</span>
          {/* the latest screening verdict of this CV's comments (24 October 2026) */}
          <VerdictBadge verdict={c.verdict} />
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
            {/* "Fill in with LinkedIn" (25 October 2026): the email LinkedIn confirmed */}
            <LinkedInMark by={c.emailConfirmedBy} />
          </Fact>
          <Fact label="Mobile">
            <a href={`tel:${c.mobile.replace(/[^\d+]/g, '')}`}>{c.mobile}</a>
          </Fact>
          <Fact label="Position">{positionFacts(c).position}</Fact>
          <Fact label="Team">{positionFacts(c).team}</Fact>
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
          <Fact label="Notice period">{c.noticePeriod ?? '—'}</Fact>
          <Fact label="Expected salary, EGP a month">{c.expectedSalary === null ? '—' : c.expectedSalary.toLocaleString('en-US')}</Fact>
          <Fact label="Consent">
            {formatDate(c.consentAt)}, {consentBy}
            {c.consentNote && <span className="block text-xs text-muted">{c.consentNote}</span>}
          </Fact>
          <Fact label="CV">
            {c.cv ? (
              <span className="flex flex-wrap items-center gap-3">
                {/* in the CV window (24 October 2026: "when opening a CV, open it in a popup window"), a Word file too */}
                <CvOpenButton recordId={c.id}>Open</CvOpenButton>
                <a href={generalCvFileHref(c.id, true)} className="inline-flex min-h-9 items-center">
                  Download
                </a>
                <span className="text-muted">{kb(c.cv.sizeBytes)}</span>
              </span>
            ) : (
              'None'
            )}
          </Fact>
          {/* every link with its platform, and the PDF case study (owner, 25 October 2026: "Portfolio per position"), under
              the section title its position's form shows (26 October 2026: "Your case studies: link, link, PDF") */}
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Portfolio</dt>
            <dd className="mt-1 text-sm break-words">
              <PortfolioSent title={c.portfolioTitle} links={portfolioLinksOf(c)} file={c.portfolioFile} href={generalPortfolioHref(c.id)} downloadHref={generalPortfolioHref(c.id, true)} />
            </dd>
          </div>
        </dl>
      </section>

      {/* What the CV's text says (22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"). */}
      {c.cv && c.cvReading && (
        <Suspense fallback={<Loading />}>
          <FromTheCv reading={c.cvReading} subject={{ generalCvId: c.id }} />
        </Suspense>
      )}

      {/* the open vacancies its CV fits (owner, 25 October 2026: "and if it recomended to another position based on the CV"); moved: its application's */}
      {c.openPositions && (
        <OpenPositions positions={c.openPositions} record={c.movedTo ? { applicationId: c.movedTo.applicationId } : { generalCvId: c.id }} id="general-open-positions" level="h2" card />
      )}

      {/* HR's notes are screening comments now (24 October 2026), the earlier ones moved in as "HR (earlier notes)" */}
      <ScreeningCommentsCard data={comments} notLoaded={commentsNotLoaded} mode="record" comments={comments ? commentsOfRecord(comments, ownKey) : []} defaultTarget={ownKey} />

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
      {/* the CV window, opened by ?cv= (24 October 2026) */}
      <Suspense fallback={null}>
        <CvDialogHost cvs={cvs} data={comments} pageKey={ownKey} commentsNotLoaded={commentsNotLoaded} />
      </Suspense>
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
