import {
  APPLICATION_STAGE_LABELS,
  applicationSourceText,
  CV_UPDATED_LABEL,
  VACANCY_STATUS_LABELS,
  VERDICT_FILTER_LABELS,
  VERDICT_FILTERS,
  type ApplicationListItem,
  type ApplicationStage,
  type CandidateBadge,
  type CvListFacts,
  type EarlierCvView,
  type ScreeningVerdict,
  type VacancyStatus,
  type VerdictFilter,
} from '@trendlix/shared';
import Link from 'next/link';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { candidateBadges } from './candidates';
import { DeleteApplicantButton } from './delete-ui';
import { experienceCell, latestRoleOf } from './cv-reading';
import { exAgencyChip } from './agency';
import { BetterFitLink, FitPercent, MatchValue } from './cv-fit-ui';
import {
  applicantHref,
  earlierCvHref,
  minYearsOptions,
  nextSort,
  skillGroups,
  sortApplicants,
  sortDirOf,
  sortedColumn,
  STAGE_STYLE,
  VACANCY_STATUS_STYLE,
  type ApplicantSort,
  type ApplicantsQuery,
} from './recruitment';
import { kb, verdictBadge } from './screening';
import { joinShown } from '@/lib/hidden';

// Recruitment's pieces (owner, 22 October 2026: "where will we include the ATS?"): the badges of a vacancy's status and an
// applicant's stage, and the applicants' table. Since 24 October 2026 (owner: "why isn't the experience pulled off the
// CV?"; "CV years in list + more rules"): the Experience cell with the CV's estimate, the Latest role cell, and the
// Min. experience and Skill filters the lists share. Since 24 October 2026 (owner: "is there a way to add screening
// comments?"; the verdict "Yes: Good fit / Maybe / Not a fit"): the latest verdict's badge and the Verdict filter.

export function VacancyStatusBadge({ status }: { status: VacancyStatus }) {
  return <span className={`badge ${VACANCY_STATUS_STYLE[status]}`}>{VACANCY_STATUS_LABELS[status]}</span>;
}

export function StageBadge({ stage, filteredOut }: { stage: ApplicationStage; filteredOut: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`badge ${STAGE_STYLE[stage]}`}>{APPLICATION_STAGE_LABELS[stage]}</span>
      {filteredOut && <span className="badge bg-danger-soft text-danger">Filtered out</span>}
    </span>
  );
}

/**
 * "CV updated" (owner, 25 October 2026: "Update their application"): they applied again with a new CV in the last 7 days
 * (the API says when); nothing otherwise.
 */
export function CvUpdatedBadge({ shown, at, className = '' }: { shown: boolean | undefined; at?: string | null; className?: string }) {
  if (!shown) return null;
  return (
    <span className={`badge bg-accent-soft text-accent ${className}`} title={at ? `They applied again with a new CV on ${formatDate(at)}` : 'They applied again with a new CV'}>
      {CV_UPDATED_LABEL}
    </span>
  );
}

/**
 * An application's earlier CVs (applying again, 25 October 2026), the newest first: when each was sent, its name, Open (a
 * PDF in a new tab, a Word file saved). Nothing when there are none.
 */
export function EarlierCvList({ applicationId, cvs, className = '' }: { applicationId: string; cvs: readonly EarlierCvView[] | undefined; className?: string }) {
  if (!cvs?.length) return null;
  return (
    <ul className={`space-y-1 text-sm ${className}`}>
      {cvs.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="whitespace-nowrap text-muted">{formatDate(c.sentAt)}</span>
          <span className="min-w-0 break-all">{c.cvFileName}</span>
          <span className="text-xs text-muted">{kb(c.sizeBytes)}</span>
          <a href={earlierCvHref(applicationId, c.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center">
            Open<span className="sr-only"> the CV sent {formatDate(c.sentAt)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A latest screening verdict's badge (24 October 2026): Good fit green, Maybe amber, Not a fit red; nothing for none yet. */
export function VerdictBadge({ verdict, className = '' }: { verdict: ScreeningVerdict | null | undefined; className?: string }) {
  const badge = verdictBadge(verdict);
  if (!badge) return null;
  return (
    <span className={`badge ${badge.className} ${className}`} title="The latest screening verdict">
      {badge.label}
    </span>
  );
}

/** The Verdict filter (24 October 2026): any, Good fit, Maybe, Not a fit, or none yet. */
export function VerdictSelect({ id, value }: { id: string; value: VerdictFilter | '' }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        Verdict
      </label>
      <Select id={id} name="verdict" defaultValue={value} className="input min-w-36">
        <option value="">Any</option>
        {VERDICT_FILTERS.map((v) => (
          <option key={v} value={v}>
            {VERDICT_FILTER_LABELS[v]}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** An applicant's candidate badges ("2 applications", "Applied before", "Former employee"; 22 October 2026). */
export function CandidateBadges({ candidate }: { candidate: CandidateBadge | null | undefined }) {
  const badges = candidateBadges(candidate);
  if (!badges.length) return null;
  return (
    <span className="mt-1 inline-flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b} className={`badge ${b === 'Applied before' || b.endsWith('applications') ? 'bg-canvas text-ink' : 'bg-warn-soft text-warn'}`}>
          {b}
        </span>
      ))}
    </span>
  );
}

/**
 * An Experience cell (24 October 2026): the years typed, else the CV's estimate muted with "From the dates in the CV"
 * on it ("≈ 4 y · CV"), else "—" or "Reading…". Under it, "Ex-agency" with its months on hover (owner, 27 October 2026:
 * "i need a flag if the candidate is ex marketing agencies or not").
 */
export function ExperienceCell({ typed, fromCv }: { typed: number | null | undefined; fromCv: CvListFacts | null | undefined }) {
  const cell = experienceCell(typed, fromCv);
  const agency = exAgencyChip(fromCv);
  return (
    <td className="text-right whitespace-nowrap tabular-nums">
      {cell.fromCv ? (
        <span className="text-sm text-muted" title={cell.title ?? undefined}>
          {cell.text}
        </span>
      ) : (
        cell.text
      )}
      {agency && (
        <span className="mt-1 block">
          <ExAgencyBadge chip={agency} />
        </span>
      )}
    </td>
  );
}

/** "Ex-agency", its months at marketing agencies on hover (and read out). */
export function ExAgencyBadge({ chip }: { chip: { text: string; title: string } }) {
  return (
    <span className="badge bg-accent-soft text-accent" title={chip.title}>
      {chip.text}
      <span className="sr-only">: {chip.title}</span>
    </span>
  );
}

/** A Latest role cell (24 October 2026): the CV's latest title and company, cut short with the whole on hover. */
export function LatestRoleCell({ fromCv }: { fromCv: CvListFacts | null | undefined }) {
  const role = latestRoleOf(fromCv);
  return (
    <td className="text-sm">
      {role ? (
        <span className="block max-w-56 truncate" title={role} dir="auto">
          {role}
        </span>
      ) : (
        <span className="text-muted">—</span>
      )}
    </td>
  );
}

/** The Min. experience filter (24 October 2026): any, 1+ … 10+ years, the years typed else the CV's estimate. */
export function MinYearsSelect({ id, value }: { id: string; value: number | null }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        Min. experience
      </label>
      <Select id={id} name="minYears" defaultValue={value === null ? '' : String(value)} className="input min-w-36">
        <option value="">Any</option>
        {minYearsOptions(value).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** The Skill filter (24 October 2026): a skill of the dictionary (skills-dictionary.ts) the CV names, by group. */
export function SkillSelect({ id, value }: { id: string; value: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        Skill
      </label>
      <Select id={id} name="skill" defaultValue={value} className="input min-w-44">
        <option value="">Any</option>
        {skillGroups().map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

/** How a table is sorted by its titles: the list's sort and order, and the address a title's click goes to. */
export interface TableSorting {
  q: Pick<ApplicantsQuery, 'sort' | 'dir'>;
  href: (next: Pick<ApplicantsQuery, 'sort' | 'dir'>) => string;
}

/**
 * A column's title, a link sorting by it when the table is sortable (owner, 28 October 2026: "i want to activate sorting
 * by from the titles"): the column sorted by shows its order (▲ ascending, ▼ descending), and a click on it turns the
 * order round; another column starts in its own order (FIRST_DIR).
 */
function SortTitle({ column, label, right = false, sorting }: { column: ApplicantSort; label: string; right?: boolean; sorting?: TableSorting }) {
  if (!sorting) return <th className={right ? 'text-right' : undefined}>{label}</th>;
  const active = sortedColumn(sorting.q) === column;
  const dir = sortDirOf(sorting.q);
  const next = nextSort(sorting.q, column);
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={right ? 'text-right' : undefined}>
      <Link
        href={sorting.href(next)}
        scroll={false}
        title={`Sort by ${label.toLowerCase()}${active ? `, ${dir === 'asc' ? 'descending' : 'ascending'}` : ''}`}
        className={`group inline-flex items-center gap-1 no-underline hover:text-ink ${active ? 'text-ink' : 'text-inherit'}`}
      >
        {label}
        <span aria-hidden="true" className={active ? '' : 'opacity-0 group-hover:opacity-50'}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '▼'}
        </span>
      </Link>
    </th>
  );
}

/**
 * Applicants in a table: who, their match, stage, experience, source and when they applied; `withVacancy` on All
 * Applicants. `bare`: inside a card already (the Applicants page's vacancy groups). The Latest role column (24 October
 * 2026) where the Vacancy column isn't: a vacancy's own applicants (its group, its page), so the table is no wider.
 * `deletes`: a Super Admin's Delete applicant on each row (owner, 25 October 2026: "applicant alone - superadmin only").
 * `sorting`: each title sorts the list by its column (28 October 2026), the rows here put in that order.
 */
export function ApplicantsTable({
  rows,
  withVacancy,
  bare = false,
  deletes = false,
  sorting,
}: {
  rows: ApplicationListItem[];
  withVacancy: boolean;
  bare?: boolean;
  deletes?: boolean;
  sorting?: TableSorting;
}) {
  const shown = sorting ? sortApplicants(rows, sorting.q) : rows;
  return (
    <div className={bare ? 'overflow-x-auto' : 'card overflow-x-auto'}>
      <table className="table">
        <thead>
          <tr>
            <SortTitle column="name" label="Applicant" sorting={sorting} />
            {withVacancy ? <SortTitle column="vacancy" label="Vacancy" sorting={sorting} /> : <SortTitle column="role" label="Latest role" sorting={sorting} />}
            <SortTitle column="match" label="Match" right sorting={sorting} />
            <SortTitle column="cv" label="CV match" right sorting={sorting} />
            <SortTitle column="stage" label="Stage" sorting={sorting} />
            <SortTitle column="years" label="Experience" right sorting={sorting} />
            <SortTitle column="source" label="Source" sorting={sorting} />
            <SortTitle column="applied" label="Applied" sorting={sorting} />
            {deletes && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={applicantHref(a.id)} className="font-semibold">
                  {a.fullName}
                </Link>
                <span className="block text-xs text-muted">
                  {joinShown([a.number, a.email])}
                </span>
                <CandidateBadges candidate={a.candidate} />
                {/* they applied again with a new CV in the last 7 days (25 October 2026: "Update their application") */}
                {a.cvUpdated && (
                  <span className="mt-1 block">
                    <CvUpdatedBadge shown={a.cvUpdated} at={a.cvUpdatedAt} />
                  </span>
                )}
                {/* another open vacancy the CV fits better (owner, 25 October 2026: "and if it recomended to another position based on the CV") */}
                {a.betterFit && (
                  <span className="mt-1 block">
                    <BetterFitLink badge={a.betterFit} />
                  </span>
                )}
              </td>
              {withVacancy ? <td className="text-sm">{a.vacancy.title}</td> : <LatestRoleCell fromCv={a.fromCv} />}
              <td className="text-right tabular-nums">
                {/* not asked the screening questions (added from the suggested CVs or by HR): the CV fit, "72% · CV" (25 October 2026) */}
                <MatchValue a={a} />
              </td>
              <td className="text-right">
                {/* the CV fit, its breakdown on hover or tap (owner, 25 October 2026: "Full CV fit score") */}
                <FitPercent percent={a.cvMatchPercent} fit={a.cvFit} />
              </td>
              <td>
                <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
                {/* the latest screening verdict (24 October 2026) */}
                {a.verdict && (
                  <span className="mt-1 block">
                    <VerdictBadge verdict={a.verdict} />
                  </span>
                )}
              </td>
              <ExperienceCell typed={a.yearsExperience} fromCv={a.fromCv} />
              <td className="text-sm">{applicationSourceText(a)}</td>
              <td className="text-sm whitespace-nowrap">{formatDate(a.appliedAt)}</td>
              {deletes && (
                <td className="whitespace-nowrap">
                  <DeleteApplicantButton id={a.id} number={a.number} compact />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
