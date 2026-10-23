import { APPLICATION_STAGE_LABELS, applicationSourceText, VACANCY_STATUS_LABELS, type ApplicationListItem, type ApplicationStage, type CandidateBadge, type VacancyStatus } from '@trendlix/shared';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { candidateBadges } from './candidates';
import { applicantHref, matchText, STAGE_STYLE, VACANCY_STATUS_STYLE } from './recruitment';
import { joinShown } from '@/lib/hidden';

// Recruitment's pieces (owner, 22 October 2026: "where will we include the ATS?"): the badges of a vacancy's status and an
// applicant's stage, and the applicants' table.

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
 * Applicants in a table: who, their match, stage, experience, source and when they applied; `withVacancy` on All
 * Applicants. `bare`: inside a card already (the Applicants page's vacancy groups).
 */
export function ApplicantsTable({ rows, withVacancy, bare = false }: { rows: ApplicationListItem[]; withVacancy: boolean; bare?: boolean }) {
  return (
    <div className={bare ? 'overflow-x-auto' : 'card overflow-x-auto'}>
      <table className="table">
        <thead>
          <tr>
            <th>Applicant</th>
            {withVacancy && <th>Vacancy</th>}
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
              {withVacancy && <td className="text-sm">{a.vacancy.title}</td>}
              <td className="text-right tabular-nums">{matchText(a.matchPercent)}</td>
              <td className="text-right tabular-nums">{matchText(a.cvMatchPercent)}</td>
              <td>
                <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
              </td>
              <td className="text-right tabular-nums">{a.yearsExperience === null ? '—' : `${a.yearsExperience} y`}</td>
              <td className="text-sm">{applicationSourceText(a)}</td>
              <td className="text-sm whitespace-nowrap">{formatDate(a.appliedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
