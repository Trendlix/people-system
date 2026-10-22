import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { APPLICATION_STAGE_LABELS, GOOD_MATCH_PERCENT, LABELS, QUESTION_KIND_LABELS, questionMaxPoints, sourceLine, type VacancyView } from '@trendlix/shared';
import { RichText } from '@/components/rich-text';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { originFrom } from '../../../offers/sending';
import { deleteVacancy, moveOnBoard, moveVacancy } from '../../actions';
import { PipelineBoard } from '../../board';
import { loadApplicants, loadBoard, loadVacancy, recruitmentNotLoaded } from '../../data';
import { ActionButton, CopyLink, ReasonButton } from '../../forms';
import { vacancyBulkHref } from '../../general';
import { boardHref, MY_HIRING_PATH } from '../../hiring';
import { applicantsHref, channelLinks, GOOD_CV_MATCH_PERCENT, readApplicantsQuery, STAGE_FILTERS, VACANCIES_PATH, vacancyEditHref, vacancyHref } from '../../recruitment';
import { ApplicantsTable, VacancyStatusBadge } from '../../ui';

// A vacancy (owner, 22 October 2026: "where will we include the ATS?"): where it stands and what can be done (HR sends it
// to the CEO, holds, reopens, closes it; the CEO approves it or sends it back with a reason), its position and internal
// salary range, the links to share on each channel while it is published, the careers page's text, its screening
// questions, and its applicants by stage (those filtered out by a must-have apart, a good match from 70%).
// Phase 2 (22 October 2026): the applicants as a list or as the pipeline board (?view=board); the vacancy's hiring manager
// sees it without the salary range, with its board from Shortlisted on.

export const metadata: Metadata = { title: 'Vacancy · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

const money = (n: number | null) => (n === null ? null : n.toLocaleString('en-US'));

function Moves({ v }: { v: VacancyView }) {
  const c = v.can;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {c.edit && (
        <Link href={vacancyEditHref(v.id)} className="btn btn-secondary no-underline">
          Edit
        </Link>
      )}
      {c.submit && <ActionButton action={moveVacancy.bind(null, v.id, 'submit')} label="Send to the CEO" pendingLabel="Sending…" kind="primary" />}
      {c.approve && <ActionButton action={moveVacancy.bind(null, v.id, 'approve')} label="Approve and publish" pendingLabel="Approving…" kind="primary" />}
      {c.sendBack && <ReasonButton action={moveVacancy.bind(null, v.id, 'send_back')} label="Send back" pendingLabel="Sending back…" reasonLabel="What should HR change?" required />}
      {c.hold && <ActionButton action={moveVacancy.bind(null, v.id, 'hold')} label="Put on hold" pendingLabel="Saving…" />}
      {c.reopen && <ActionButton action={moveVacancy.bind(null, v.id, 'reopen')} label="Open again" pendingLabel="Saving…" kind="primary" />}
      {c.close && <ReasonButton action={moveVacancy.bind(null, v.id, 'close')} label="Close" pendingLabel="Closing…" reasonLabel="Why it closes" required={false} kind="danger" />}
      {c.delete && <ActionButton action={deleteVacancy.bind(null, v.id)} label="Delete" pendingLabel="Deleting…" kind="danger" confirm={`Delete ${v.number}? Nobody has applied; this can't be undone.`} />}
    </div>
  );
}

async function Applicants({ v, searchParams }: { v: VacancyView; searchParams: PageProps<'/recruitment/vacancies/[id]'>['searchParams'] }) {
  const q = readApplicantsQuery(await searchParams);
  const loaded = await loadApplicants({ ...q, vacancyId: v.id });
  const base = vacancyHref(v.id);
  const total = Object.values(v.stageCounts).reduce((a, b) => a + b, 0);
  return (
    <section aria-labelledby="vacancy-applicants" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vacancy-applicants" className="text-lg font-semibold">
          Applicants
        </h2>
        {v.viewer === 'manages' && (v.status === 'open' || v.status === 'on_hold') && (
          <Link href={vacancyBulkHref(v.id)} className="btn btn-secondary no-underline">
            Bulk upload CVs
          </Link>
        )}
      </div>
      <nav aria-label="Applicants by stage" className="flex flex-wrap gap-2">
        <Link href={applicantsHref(base, { ...q, stage: '', filtered: 'hide' })} className={`${chip} ${!q.stage && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
          All ({total - v.filteredOut})
        </Link>
        {STAGE_FILTERS.map((s) => (
          <Link key={s} href={applicantsHref(base, { ...q, stage: s, filtered: 'hide' })} className={`${chip} ${q.stage === s && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
            {APPLICATION_STAGE_LABELS[s]} ({v.stageCounts[s]})
          </Link>
        ))}
        <Link href={applicantsHref(base, { ...q, stage: '', filtered: 'only' })} className={`${chip} ${q.filtered === 'only' ? ACTIVE : IDLE}`}>
          Filtered out ({v.filteredOut})
        </Link>
        <Link
          href={applicantsHref(base, { ...q, minMatch: q.minMatch === null ? GOOD_MATCH_PERCENT : null })}
          className={`${chip} ${q.minMatch !== null ? ACTIVE : IDLE}`}
          aria-pressed={q.minMatch !== null}
        >
          Match ≥ {GOOD_MATCH_PERCENT}%
        </Link>
        {/* the key skills found in the CV (22 October 2026: "make the OCR egine reads the CV and analyse it") */}
        <Link
          href={applicantsHref(base, { ...q, minCvMatch: q.minCvMatch === null ? GOOD_CV_MATCH_PERCENT : null })}
          className={`${chip} ${q.minCvMatch !== null ? ACTIVE : IDLE}`}
          aria-pressed={q.minCvMatch !== null}
        >
          CV match ≥ {GOOD_CV_MATCH_PERCENT}%
        </Link>
        <Link href={applicantsHref(base, { ...q, sort: q.sort === 'cv' ? '' : 'cv' })} className={`${chip} ${q.sort === 'cv' ? ACTIVE : IDLE}`} aria-pressed={q.sort === 'cv'}>
          Best CV match first
        </Link>
      </nav>
      {/* where they came from (owner, 22 October 2026: "what came out of the posted jobs"): each count lists them */}
      {sourceLine(v.sourceCounts ?? {}).length > 0 && (
        <p className="text-sm text-muted">
          By source:{' '}
          {sourceLine(v.sourceCounts ?? {}).map((s, i) => (
            <span key={s.source}>
              {i > 0 && ' · '}
              <Link href={applicantsHref(base, { source: s.source, filtered: 'all' })} className="whitespace-nowrap">
                {s.label} {s.count}
              </Link>
            </span>
          ))}
        </p>
      )}
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'applicants')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{total ? 'Nobody here.' : 'Nobody has applied yet.'}</div>
      ) : (
        <ApplicantsTable rows={loaded.value} withVacancy={false} />
      )}
    </section>
  );
}

/** The pipeline board (Phase 2): HR moves cards on it, the CEO and the hiring manager read it. */
async function Board({ v }: { v: VacancyView }) {
  const loaded = await loadBoard(v.id);
  return (
    <section aria-labelledby="vacancy-board" className="space-y-3">
      <h2 id="vacancy-board" className="text-lg font-semibold">
        Pipeline
      </h2>
      {loaded.kind !== 'ok' ? <Empty>{recruitmentNotLoaded(loaded, 'board')}</Empty> : <PipelineBoard board={loaded.value} move={moveOnBoard} />}
    </section>
  );
}

async function Vacancy({ params, searchParams }: PageProps<'/recruitment/vacancies/[id]'>) {
  const { id } = await params;
  const loaded = await loadVacancy(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'vacancy')}</Empty>;
  const v = loaded.value;
  const hiringManager = v.viewer === 'hiring_manager';
  const view = hiringManager || (await searchParams).view === 'board' ? 'board' : 'list';
  const published = v.status === 'open' || v.status === 'on_hold';
  const origin = published ? originFrom(await headers()) : '';
  const range = v.salaryMin !== null || v.salaryMax !== null ? [money(v.salaryMin), money(v.salaryMax)].filter(Boolean).join(' – ') : null;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={hiringManager ? MY_HIRING_PATH : VACANCIES_PATH}>{hiringManager ? 'My Hiring' : 'Vacancies'}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{v.title}</h1>
          <VacancyStatusBadge status={v.status} />
          {v.confidential && <span className="badge bg-canvas text-muted">C-level</span>}
        </div>
        <p className="text-sm text-muted">
          {v.number} · {v.jobTitle.titleEn}
          {v.department ? ` · ${v.department.nameEn}` : ''}
        </p>
      </div>

      {v.sentBackReason && (
        <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">Sent back by the CEO{v.decidedAt ? ` on ${formatDate(v.decidedAt)}` : ''}</p>
          <p>{v.sentBackReason}</p>
        </div>
      )}
      {v.status === 'pending' && <p className="text-sm text-muted">Waiting for the CEO since {v.submittedAt ? formatDateTime(v.submittedAt) : '—'}: it shows on the careers page once approved.</p>}
      {v.status === 'closed' && v.closeReason && <p className="text-sm text-muted">Closed: {v.closeReason}</p>}

      <Moves v={v} />

      <section aria-labelledby="vacancy-position" className="card space-y-4 p-6">
        <h2 id="vacancy-position" className="text-lg font-semibold">
          Position
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Employment type">{LABELS.employmentType[v.employmentType]}</Fact>
          <Fact label="Where">{LABELS.workArrangement[v.workArrangement]}</Fact>
          <Fact label="Headcount">
            {v.hired} hired of {v.headcount}
          </Fact>
          <Fact label="Hiring manager">{v.hiringManager?.name ?? '—'}</Fact>
          <Fact label="Grade">{v.grade ? `${v.grade.code} · ${v.grade.levelEn}` : '—'}</Fact>
          <Fact label="Shift">{v.shift?.code ?? '—'}</Fact>
          <Fact label="Contract length">{v.durationMonths ? `${v.durationMonths} months` : '—'}</Fact>
          <Fact label="Closing date">{v.closingDate ? formatDate(v.closingDate) : '—'}</Fact>
          {!hiringManager && <Fact label="Salary range, EGP a month">{range ?? '—'}</Fact>}
          <Fact label="Published">{v.publishedAt ? formatDate(v.publishedAt) : 'Not yet'}</Fact>
          <Fact label="Drafted by">{v.createdBy?.name ?? v.createdBy?.email ?? '—'}</Fact>
          <Fact label="Approved by">{v.status !== 'draft' && v.status !== 'pending' && v.decidedBy ? (v.decidedBy.name ?? v.decidedBy.email) : '—'}</Fact>
        </dl>
        {!hiringManager && <p className="text-xs text-muted">The salary range is for HR, the CEO and a Super Admin only: never on the careers page.</p>}
      </section>

      {published && origin && (
        <section aria-labelledby="vacancy-links" className="card space-y-2 p-6">
          <h2 id="vacancy-links" className="text-lg font-semibold">
            Apply Links
          </h2>
          <p className="text-sm text-muted">The same job page on each channel: applications say which link they came by.</p>
          <ul>
            {channelLinks(origin, v.slug).map((l) => (
              <CopyLink key={l.source} source={l.source} href={l.href} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="vacancy-text" className="card space-y-4 p-6">
        <h2 id="vacancy-text" className="text-lg font-semibold">
          On the Careers Page
        </h2>
        {[
          ['About the role', v.about],
          ['Responsibilities', v.responsibilities],
          ['Requirements', v.requirements],
        ].map(([label, html]) =>
          html ? (
            <div key={label} className="space-y-1">
              <h3 className="text-sm font-semibold">{label}</h3>
              <RichText html={html} />
            </div>
          ) : null,
        )}
        {!v.about && !v.responsibilities && !v.requirements && <p className="text-sm text-muted">No text yet.</p>}
      </section>

      <section aria-labelledby="vacancy-questions" className="card space-y-3 p-6">
        <h2 id="vacancy-questions" className="text-lg font-semibold">
          Screening Questions
        </h2>
        {v.questions.length === 0 ? (
          <p className="text-sm text-muted">None: applicants send their details and CV only.</p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {v.questions.map((q) => (
              <li key={q.key}>
                <span className="font-semibold">{q.text}</span>
                <span className="block text-muted">
                  {QUESTION_KIND_LABELS[q.kind]}
                  {q.required ? ', required' : ', optional'}
                  {q.knockout ? ', must-have' : ''}
                  {questionMaxPoints(q) ? ` · up to ${questionMaxPoints(q)} points` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* looked for in each CV (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only") */}
      <section aria-labelledby="vacancy-key-skills" className="card space-y-3 p-6">
        <h2 id="vacancy-key-skills" className="text-lg font-semibold">
          Key Skills
        </h2>
        {v.keySkills.length === 0 ? (
          <p className="text-sm text-muted">None yet. List them on the vacancy&apos;s form to see which each CV names, and its CV match.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {v.keySkills.map((s) => (
                <li key={s} className="badge bg-canvas text-ink">
                  {s}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Looked for in each applicant&apos;s CV; the CV match % is how many it names. It never filters anyone out.</p>
          </>
        )}
      </section>

      {!hiringManager && (
        <nav aria-label="Show the applicants as" className="flex flex-wrap gap-2">
          <Link href={vacancyHref(v.id)} className={`${chip} ${view === 'list' ? ACTIVE : IDLE}`} aria-current={view === 'list' ? 'page' : undefined}>
            List
          </Link>
          <Link href={boardHref(v.id)} className={`${chip} ${view === 'board' ? ACTIVE : IDLE}`} aria-current={view === 'board' ? 'page' : undefined}>
            Board
          </Link>
        </nav>
      )}
      <Suspense fallback={<Loading />}>{view === 'board' ? <Board v={v} /> : <Applicants v={v} searchParams={searchParams} />}</Suspense>
    </div>
  );
}

export default function VacancyPage(props: PageProps<'/recruitment/vacancies/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <Vacancy {...props} />
      </Suspense>
    </div>
  );
}
