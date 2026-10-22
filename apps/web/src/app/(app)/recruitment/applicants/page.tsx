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
  sourceLine,
  type ApplicantsSummary,
  type GeneralCvListItem,
} from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDate, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadApplicants, loadApplicantsSummary, loadGeneralAreas, loadGeneralCvs, recruitmentNotLoaded, type Loaded } from '../data';
import { ActionButton } from '../forms';
import { setGeneralCvStatus } from '../general-actions';
import {
  filtering,
  GENERAL_BULK_PATH,
  GENERAL_STATUS_STYLE,
  generalCvHref,
  generalHref,
  groupApplicants,
  NEW_GENERAL_CV_PATH,
  readGeneralQuery,
  readTab,
  sourceFilterHref,
  stageCountsText,
  tabHref,
  type ApplicantsTab,
} from '../general';
import { APPLICANTS_PATH, applicantsHref, GOOD_CV_MATCH_PERCENT, managesRecruitment, readApplicantsQuery, readsRecruitment, STAGE_FILTERS, vacancyHref, WHO_SEES } from '../recruitment';
import { ApplicantsTable, VacancyStatusBadge } from '../ui';

// All applicants (owner, 22 October 2026: "where will we include the ATS?"): across the vacancies, best match first, by
// stage, source, a good match (70% and over), experience, or a search on names, email, mobile and reference; those
// filtered out by a must-have apart.
// Two tabs (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on randomly",
// "Both"): Posted jobs, the applicants grouped by vacancy (open, on hold, closed, filled), each with its counts by stage
// and by source, every source's count a link to its applicants; and General CVs, those sent without a posted job (the
// careers page's "Send us your CV", and those HR added from email, WhatsApp, LinkedIn, in person or a referral).

export const metadata: Metadata = { title: 'Applicants · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';
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
          </Select>
        </div>
        <div>
          <label htmlFor="applicant-years" className="label">
            Experience, years at least
          </label>
          <input id="applicant-years" name="minYears" inputMode="decimal" defaultValue={q.minYears === null ? '' : String(q.minYears)} className="input w-28" />
        </div>
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
          <ApplicantsTable rows={loaded.value} withVacancy />
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
                <ApplicantsTable rows={rows} withVacancy={false} bare />
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

function GeneralTable({ rows, manages }: { rows: GeneralCvListItem[]; manages: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Area</th>
            <th>Source</th>
            <th className="text-right">Experience</th>
            <th>Status</th>
            <th>Received</th>
            {manages && <th className="sr-only">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={generalCvHref(c.id)} className="font-semibold">
                  {c.fullName}
                </Link>
                <span className="block text-xs text-muted">
                  {c.number} · {c.email}
                </span>
              </td>
              <td className="text-sm">{c.area}</td>
              <td className="text-sm">
                {GENERAL_CV_SOURCE_LABELS[c.source]}
                {c.referrer && <span className="block text-xs text-muted">by {c.referrer}</span>}
              </td>
              <td className="text-right tabular-nums">{c.yearsExperience === null ? '—' : `${c.yearsExperience} y`}</td>
              <td>
                <span className={`badge ${GENERAL_STATUS_STYLE[c.status]}`}>{GENERAL_CV_STATUS_LABELS[c.status]}</span>
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
                      <ActionButton action={setGeneralCvStatus.bind(null, c.id, 'archive')} label="Archive" pendingLabel="Archiving…" confirm={`Archive ${c.number}? It can be restored.`} />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function General({ query, manages }: { query: Query; manages: boolean }) {
  const g = readGeneralQuery(query);
  const [loaded, areas] = await Promise.all([loadGeneralCvs(g), loadGeneralAreas()]);
  const filtered = !!(g.status || g.source || g.departmentId || g.q);
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
        <div className="min-w-56 flex-1">
          <label htmlFor="general-search" className="label">
            Search
          </label>
          <input id="general-search" name="q" defaultValue={g.q} placeholder="Name, email, mobile, reference or the CV's text" className="input" />
        </div>
        <div>
          <label htmlFor="general-area" className="label">
            Area
          </label>
          <Select id="general-area" name="departmentId" defaultValue={g.departmentId} className="input min-w-40">
            <option value="">Any</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
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
        <GeneralTable rows={loaded.value} manages={manages} />
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
        <h1 className="text-2xl font-semibold">Applicants</h1>
        <p className="max-w-3xl text-sm text-muted">Those who applied for a posted job, by vacancy, and the general CVs sent without one.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Applicants searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
