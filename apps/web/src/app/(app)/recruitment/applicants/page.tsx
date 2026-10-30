import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  APPLICATION_SOURCE_LABELS,
  APPLICATION_SOURCES,
  APPLICATION_STAGE_LABELS,
  GENERAL_CV_SOURCE_LABELS,
  GENERAL_CV_SOURCES,
  GENERAL_CV_STATUS_LABELS,
  GENERAL_CV_STATUSES,
  GOOD_MATCH_PERCENT,
  OTHER_POSITION,
  positionGroups,
  sourceLine,
  type ApplicantsSummary,
  type GeneralCvListItem,
} from '@trendlix/shared';
import { PositionOptions } from '@/components/position-options';
import { Select } from '@/components/select';
import { formatDate, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadApplicants, loadApplicantsSummary, loadCvPositionsOrNone, loadGeneralCvs, recruitmentNotLoaded, type Loaded } from '../data';
import { ActionButton } from '../forms';
import { setGeneralCvStatus } from '../general-actions';
import {
  filtering,
  GENERAL_BULK_PATH,
  generalFiltering,
  GENERAL_STATUS_STYLE,
  generalCvHref,
  generalHref,
  groupApplicants,
  NEW_GENERAL_CV_PATH,
  positionCell,
  readGeneralQuery,
  readTab,
  sourceFilterHref,
  stageCountsText,
  tabHref,
  type ApplicantsTab,
  type GeneralQuery,
} from '../general';
import { APPLICANTS_PATH, applicantsHref, columnSortText, GOOD_CV_MATCH_PERCENT, managesRecruitment, readApplicantsQuery, readsRecruitment, STAGE_FILTERS, vacancyHref, WHO_SEES } from '../recruitment';
import { ApplicantsTable, ExperienceCell, HiringStepSelect, LatestRoleCell, MinYearsSelect, SkillSelect, VacancyStatusBadge, VerdictBadge, VerdictSelect } from '../ui';
import { joinShown, shownCode } from '@/lib/hidden';

// All applicants (owner, 22 October 2026: "where will we include the ATS?"): across the vacancies, best match first, by
// stage, source, a good match (70% and over), experience, or a search on names, email, mobile and reference; those
// filtered out by a must-have apart.
// Two tabs (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on randomly",
// "Both"): Posted jobs, the applicants grouped by vacancy (open, on hold, closed, filled), each with its counts by stage
// and by source, every source's count a link to its applicants; and General CVs, those sent without a posted job (the
// careers page's "Send us your CV", and those HR added from email, WhatsApp, LinkedIn, in person or a referral).
// The Experience column falls back to the CV's estimate, with a Min. experience filter, a Skill filter and a Latest
// role column on both tabs (owner, 24 October 2026: "why isn't the experience pulled off the CV?"; "CV years in list +
// more rules"); the Posted jobs sort by experience too.
// The latest screening verdict's badge on both tabs, with a Verdict filter (owner, 24 October 2026: "Yes: Good fit / Maybe
// / Not a fit").
// General CVs by position (owner, 25 October 2026, on the "Area" filter: "what do you mean by area here?", "should it be
// the positions?"; asked, "Position, grouped by team"): a Position column with its team under it, and Position and Team
// filters, Team once "Area"; an older CV, sent for an area, shows its area.
// A Best open position column (owner, 25 October 2026: "and if it recomended to another position based on the CV"): the
// open vacancy each general CV fits best (50% or more, by the CV fit), sortable best first.

export const metadata: Metadata = { title: 'Applicants · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';
const tabClass = (on: boolean) =>
  `inline-flex min-h-10 items-center gap-2 border-b-2 px-1 text-sm font-semibold no-underline ${on ? 'border-ink text-ink hover:text-ink' : 'border-transparent text-muted hover:text-ink'}`;

type Query = Record<string, string | string[] | undefined>;

function Tabs({ tab, summary }: { tab: ApplicantsTab; summary: Loaded<ApplicantsSummary> }) {
  const s = summary.kind === 'ok' ? summary.value : null;
  return (
    <nav aria-label="Applicants" className="flex gap-6 border-b border-line">
      <Link href={tabHref('posted')} className={tabClass(tab === 'posted')} aria-current={tab === 'posted' ? 'page' : undefined}>
        Posted jobs{s && <span className="badge bg-canvas text-ink tabular-nums">{s.posted}</span>}
      </Link>
      <Link href={tabHref('general')} className={tabClass(tab === 'general')} aria-current={tab === 'general' ? 'page' : undefined}>
        General CVs
        {s && <span className="badge bg-canvas text-ink tabular-nums">{s.general}</span>}
        {s && s.generalNew > 0 && <span className="badge bg-accent-soft text-accent tabular-nums">{s.generalNew} new</span>}
      </Link>
    </nav>
  );
}

// ---------- Posted jobs ----------

async function Posted({ query, summary }: { query: Query; summary: Loaded<ApplicantsSummary> }) {
  const q = readApplicantsQuery(query);
  const loaded = await loadApplicants(q);
  const groups = loaded.kind === 'ok' && summary.kind === 'ok' ? groupApplicants(summary.value.vacancies, loaded.value, filtering(q)) : null;
  return (
    <div className="space-y-4">
      <nav aria-label="Applicants by stage" className="flex flex-wrap gap-2">
        <Link href={applicantsHref(APPLICANTS_PATH, { ...q, stage: '', filtered: 'hide' })} className={`${chip} ${!q.stage && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
          All
        </Link>
        {STAGE_FILTERS.map((s) => (
          <Link key={s} href={applicantsHref(APPLICANTS_PATH, { ...q, stage: s, filtered: 'hide' })} className={`${chip} ${q.stage === s && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
            {APPLICATION_STAGE_LABELS[s]}
          </Link>
        ))}
        <Link href={applicantsHref(APPLICANTS_PATH, { ...q, stage: '', filtered: 'only' })} className={`${chip} ${q.filtered === 'only' ? ACTIVE : IDLE}`}>
          Filtered out
        </Link>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        {q.stage && <input type="hidden" name="stage" value={q.stage} />}
        {q.filtered !== 'hide' && <input type="hidden" name="filtered" value={q.filtered} />}
        {q.vacancyId && <input type="hidden" name="vacancyId" value={q.vacancyId} />}
        <div className="min-w-56 flex-1">
          <label htmlFor="applicant-search" className="label">
            Search
          </label>
          <input id="applicant-search" name="q" defaultValue={q.q} placeholder="Name, email, mobile, reference or the CV's text" className="input" />
        </div>
        <div>
          <label htmlFor="applicant-source" className="label">
            Source
          </label>
          <Select id="applicant-source" name="source" defaultValue={q.source} className="input min-w-40">
            <option value="">Any</option>
            {APPLICATION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {APPLICATION_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="applicant-match" className="label">
            Match
          </label>
          <Select id="applicant-match" name="minMatch" defaultValue={q.minMatch === null ? '' : String(q.minMatch)} className="input min-w-36">
            <option value="">Any</option>
            <option value={String(GOOD_MATCH_PERCENT)}>{GOOD_MATCH_PERCENT}% and over</option>
            <option value="50">50% and over</option>
          </Select>
        </div>
        {/* the key skills found in the CV (22 October 2026: "make the OCR egine reads the CV and analyse it") */}
        <div>
          <label htmlFor="applicant-cv-match" className="label">
            CV match
          </label>
          <Select id="applicant-cv-match" name="minCvMatch" defaultValue={q.minCvMatch === null ? '' : String(q.minCvMatch)} className="input min-w-36">
            <option value="">Any</option>
            <option value={String(GOOD_CV_MATCH_PERCENT)}>{GOOD_CV_MATCH_PERCENT}% and over</option>
          </Select>
        </div>
        <div>
          <label htmlFor="applicant-sort" className="label">
            Sort
          </label>
          <Select id="applicant-sort" name="sort" defaultValue={q.sort} className="input min-w-44">
            <option value="">Best match first</option>
            <option value="cv">Best CV match first</option>
            <option value="years">Most experience first</option>
            {/* a column's title clicked (28 October 2026): kept while the filters are applied */}
            {q.sort && q.sort !== 'cv' && q.sort !== 'years' && <option value={q.sort}>{columnSortText(q)}</option>}
          </Select>
          {q.sort && q.dir && <input type="hidden" name="dir" value={q.dir} />}
        </div>
        <MinYearsSelect id="applicant-years" value={q.minYears} />
        <SkillSelect id="applicant-skill" value={q.skill} />
        <VerdictSelect id="applicant-verdict" value={q.verdict} />
        {/* where a shortlisted applicant stands (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them - HR Screening and scheduling") */}
        <HiringStepSelect id="applicant-step" value={q.step} />
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
        {filtering(q) && (
          <Link href={APPLICANTS_PATH} className="btn btn-secondary no-underline">
            Clear
          </Link>
        )}
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'applicants')}</Empty>
      ) : !groups ? (
        // the server has no summary yet: the applicants in one list, as before
        loaded.value.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-muted">Nobody here.</div>
        ) : (
          <ApplicantsTable rows={loaded.value} withVacancy sorting={{ q, href: (next) => applicantsHref(APPLICANTS_PATH, { ...q, ...next }) }} />
        )
      ) : groups.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{filtering(q) ? 'Nobody here.' : 'Nobody has applied for a posted job yet.'}</div>
      ) : (
        groups.map(({ group: g, rows }) => {
          const sources = sourceLine(g.bySource);
          return (
            <section key={g.vacancy.id} aria-labelledby={`vacancy-${g.vacancy.id}`} className="card overflow-hidden">
              <div className="space-y-1.5 border-b border-line-soft px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`vacancy-${g.vacancy.id}`} className="text-lg font-semibold">
                    <Link href={vacancyHref(g.vacancy.id)} className="text-ink">
                      {titleCase(g.vacancy.title)}
                    </Link>
                  </h2>
                  <VacancyStatusBadge status={g.vacancy.status} />
                  <span className="text-sm text-muted">
                    {g.vacancy.number} · {g.total} {g.total === 1 ? 'applicant' : 'applicants'}
                  </span>
                </div>
                {stageCountsText(g, APPLICATION_STAGE_LABELS) && <p className="text-sm">{stageCountsText(g, APPLICATION_STAGE_LABELS)}</p>}
                {sources.length > 0 && (
                  <p className="text-sm text-muted">
                    By source:{' '}
                    {sources.map((s, i) => (
                      <span key={s.source}>
                        {i > 0 && ' · '}
                        <Link href={sourceFilterHref(g.vacancy.id, s.source)} className="whitespace-nowrap">
                          {s.label} {s.count}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {rows.length > 0 ? (
                <ApplicantsTable rows={rows} withVacancy={false} bare sorting={{ q, href: (next) => applicantsHref(APPLICANTS_PATH, { ...q, ...next }) }} />
              ) : (
                <p className="px-6 py-4 text-sm text-muted">
                  All of them are filtered out by a must-have.{' '}
                  <Link href={applicantsHref(APPLICANTS_PATH, { vacancyId: g.vacancy.id, filtered: 'only' })}>Show them</Link>
                </p>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

// ---------- General CVs ----------

function GeneralTable({ rows, manages, q }: { rows: GeneralCvListItem[]; manages: boolean; q: GeneralQuery }) {
  const byFit = q.sort === 'fit';
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Position</th>
            <th aria-sort={byFit ? 'descending' : 'none'}>
              {/* sortable: the best fit first, again for the newest first */}
              <Link href={generalHref({ ...q, sort: byFit ? '' : 'fit' })} className="text-inherit" title={byFit ? 'Show the newest first' : 'Show the best fit first'}>
                Best open position{byFit && <span aria-hidden="true"> ↓</span>}
              </Link>
            </th>
            <th>Latest role</th>
            <th>Source</th>
            <th className="text-right">Experience</th>
            <th>Status</th>
            <th>Received</th>
            {manages && <th className="sr-only">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const position = positionCell(c);
            return (
              <tr key={c.id}>
                <td>
                  <Link href={generalCvHref(c.id)} className="font-semibold">
                    {c.fullName}
                  </Link>
                  <span className="block text-xs text-muted">
                    {joinShown([c.number, c.email])}
                  </span>
                </td>
                <td className="text-sm">
                  {position.main}
                  {position.sub && <span className="block text-xs text-muted">{position.sub}</span>}
                </td>
                <td className="text-sm">
                  {c.bestPosition ? (
                    <>
                      <Link href={vacancyHref(c.bestPosition.vacancy.id)}>{c.bestPosition.vacancy.title}</Link>
                      <span className="block text-xs text-muted tabular-nums">{c.bestPosition.percent}% CV fit</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <LatestRoleCell fromCv={c.fromCv} />
                <td className="text-sm">
                  {GENERAL_CV_SOURCE_LABELS[c.source]}
                  {c.referrer && <span className="block text-xs text-muted">by {c.referrer}</span>}
                </td>
                <ExperienceCell typed={c.yearsExperience} fromCv={c.fromCv} />
                <td>
                  <span className={`badge ${GENERAL_STATUS_STYLE[c.status]}`}>{GENERAL_CV_STATUS_LABELS[c.status]}</span>
                  {/* the latest screening verdict (24 October 2026) */}
                  {c.verdict && (
                    <span className="mt-1 block">
                      <VerdictBadge verdict={c.verdict} />
                    </span>
                  )}
                  {c.movedTo && (
                    <Link href={vacancyHref(c.movedTo.vacancyId)} className="block text-xs">
                      {c.movedTo.vacancyTitle}
                    </Link>
                  )}
                </td>
                <td className="text-sm whitespace-nowrap">{formatDate(c.receivedAt)}</td>
                {manages && (
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      {(c.status === 'new' || c.status === 'reviewed') && (
                        <Link href={generalCvHref(c.id)} className="btn btn-secondary min-h-9 px-3 text-sm no-underline">
                          Add to a vacancy
                        </Link>
                      )}
                      {(c.status === 'new' || c.status === 'reviewed') && (
                        <ActionButton action={setGeneralCvStatus.bind(null, c.id, 'archive')} label="Archive" pendingLabel="Archiving…" confirm={`Archive ${shownCode(c.number) ?? 'this CV'}? It can be restored.`} />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function General({ query, manages }: { query: Query; manages: boolean }) {
  const g = readGeneralQuery(query);
  const [loaded, { positions, teams }] = await Promise.all([loadGeneralCvs(g), loadCvPositionsOrNone()]);
  const filtered = generalFiltering(g);
  return (
    <div className="space-y-4">
      {manages && (
        <div className="flex flex-wrap gap-2">
          <Link href={NEW_GENERAL_CV_PATH} className="btn btn-primary no-underline">
            Add a CV
          </Link>
          <Link href={GENERAL_BULK_PATH} className="btn btn-secondary no-underline">
            Bulk upload CVs
          </Link>
        </div>
      )}
      <nav aria-label="General CVs by status" className="flex flex-wrap gap-2">
        <Link href={generalHref({ ...g, status: '' })} className={`${chip} ${!g.status ? ACTIVE : IDLE}`}>
          Not archived
        </Link>
        {GENERAL_CV_STATUSES.map((s) => (
          <Link key={s} href={generalHref({ ...g, status: s })} className={`${chip} ${g.status === s ? ACTIVE : IDLE}`}>
            {GENERAL_CV_STATUS_LABELS[s]}
          </Link>
        ))}
        <Link href={generalHref({ ...g, status: 'all' })} className={`${chip} ${g.status === 'all' ? ACTIVE : IDLE}`}>
          All
        </Link>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="tab" value="general" />
        {g.status && <input type="hidden" name="status" value={g.status} />}
        {g.sort && <input type="hidden" name="sort" value={g.sort} />}
        <div className="min-w-56 flex-1">
          <label htmlFor="general-search" className="label">
            Search
          </label>
          <input id="general-search" name="q" defaultValue={g.q} placeholder="Name, email, mobile, reference or the CV's text" className="input" />
        </div>
        <div>
          <label htmlFor="general-position" className="label">
            Position
          </label>
          <Select id="general-position" name="positionKey" defaultValue={g.positionKey} className="input min-w-40">
            <option value="">Any</option>
            <PositionOptions groups={positionGroups(positions, { withHidden: true })} />
            <option value={OTHER_POSITION}>Other (written)</option>
          </Select>
        </div>
        <div>
          <label htmlFor="general-team" className="label">
            Team
          </label>
          <Select id="general-team" name="departmentId" defaultValue={g.departmentId} className="input min-w-40">
            <option value="">Any</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="general-source" className="label">
            Source
          </label>
          <Select id="general-source" name="source" defaultValue={g.source} className="input min-w-40">
            <option value="">Any</option>
            {GENERAL_CV_SOURCES.map((s) => (
              <option key={s} value={s}>
                {GENERAL_CV_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <MinYearsSelect id="general-years" value={g.minYears} />
        <SkillSelect id="general-skill" value={g.skill} />
        <VerdictSelect id="general-verdict" value={g.verdict} />
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
        {filtered && (
          <Link href={tabHref('general')} className="btn btn-secondary no-underline">
            Clear
          </Link>
        )}
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'general CVs')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{filtered ? 'Nobody here.' : 'No general CVs yet. They come from “Send us your CV” on the careers page, or HR adds them.'}</div>
      ) : (
        <GeneralTable rows={loaded.value} manages={manages} q={g} />
      )}
    </div>
  );
}

async function Applicants({ searchParams }: { searchParams: PageProps<'/recruitment/applicants'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const tab = readTab(query);
  const summary = await loadApplicantsSummary();
  return (
    <div className="space-y-4">
      <Tabs tab={tab} summary={summary} />
      {tab === 'general' ? <General query={query} manages={managesRecruitment(user)} /> : <Posted query={query} summary={summary} />}
    </div>
  );
}

export default function ApplicantsPage({ searchParams }: PageProps<'/recruitment/applicants'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="page-title">Applicants</h1>
        <p className="max-w-3xl text-sm text-muted">Those who applied for a posted job, by vacancy, and the general CVs sent without one.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Applicants searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
