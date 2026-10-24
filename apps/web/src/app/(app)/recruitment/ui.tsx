import {
  APPLICATION_STAGE_LABELS,
  applicationSourceText,
  VACANCY_STATUS_LABELS,
  type ApplicationListItem,
  type ApplicationStage,
  type CandidateBadge,
  type CvListFacts,
  type VacancyStatus,
} from '@trendlix/shared';
import Link from 'next/link';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { candidateBadges } from './candidates';
import { experienceCell, latestRoleOf } from './cv-reading';
import { applicantHref, matchText, minYearsOptions, skillGroups, STAGE_STYLE, VACANCY_STATUS_STYLE } from './recruitment';
import { joinShown } from '@/lib/hidden';

// Recruitment's pieces (owner, 22 October 2026: "where will we include the ATS?"): the badges of a vacancy's status and an
// applicant's stage, and the applicants' table. Since 24 October 2026 (owner: "why isn't the experience pulled off the
// CV?"; "CV years in list + more rules"): the Experience cell with the CV's estimate, the Latest role cell, and the
// Min. experience and Skill filters the lists share.

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
 * on it ("≈ 4 y · CV"), else "—" or "Reading…".
 */
export function ExperienceCell({ typed, fromCv }: { typed: number | null | undefined; fromCv: CvListFacts | null | undefined }) {
  const cell = experienceCell(typed, fromCv);
  return (
    <td className="text-right whitespace-nowrap tabular-nums">
      {cell.fromCv ? (
        <span className="text-sm text-muted" title={cell.title ?? undefined}>
          {cell.text}
        </span>
      ) : (
        cell.text
      )}
    </td>
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

/**
 * Applicants in a table: who, their match, stage, experience, source and when they applied; `withVacancy` on All
 * Applicants. `bare`: inside a card already (the Applicants page's vacancy groups). The Latest role column (24 October
 * 2026) where the Vacancy column isn't: a vacancy's own applicants (its group, its page), so the table is no wider.
 */
export function ApplicantsTable({ rows, withVacancy, bare = false }: { rows: ApplicationListItem[]; withVacancy: boolean; bare?: boolean }) {
  return (
    <div className={bare ? 'overflow-x-auto' : 'card overflow-x-auto'}>
      <table className="table">
        <thead>
          <tr>
            <th>Applicant</th>
            {withVacancy ? <th>Vacancy</th> : <th>Latest role</th>}
            <th className="text-right">Match</th>
            <th className="text-right">CV match</th>
            <th>Stage</th>
            <th className="text-right">Experience</th>
            <th>Source</th>
            <th>Applied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={applicantHref(a.id)} className="font-semibold">
                  {a.fullName}
                </Link>
                <span className="block text-xs text-muted">
                  {joinShown([a.number, a.email])}
                </span>
                <CandidateBadges candidate={a.candidate} />
              </td>
              {withVacancy ? <td className="text-sm">{a.vacancy.title}</td> : <LatestRoleCell fromCv={a.fromCv} />}
              <td className="text-right tabular-nums">{matchText(a.matchPercent)}</td>
              <td className="text-right tabular-nums">{matchText(a.cvMatchPercent)}</td>
              <td>
                <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
              </td>
              <ExperienceCell typed={a.yearsExperience} fromCv={a.fromCv} />
              <td className="text-sm">{applicationSourceText(a)}</td>
              <td className="text-sm whitespace-nowrap">{formatDate(a.appliedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
