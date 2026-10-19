import { employmentStanding, type EmployeeStatus, type EmploymentType, type Standing } from '@trendlix/shared';
import type { EmployeeProfile } from '../../../lib/types';

// Where someone stands, as the badges show it (ui.tsx's StatusBadge and StandingBadge): an employment's status, and the
// directory's standing, which since 19 October 2026 shows a trainee as Trainee and an intern as Intern rather than
// Probation or Active (owner: "interns to be labeled trainees instead of probation"): a training or internship agreement
// has no probation (employmentStanding, @trendlix/shared). Pure code, tested; relative imports for the tests.

/** Each status's colours: Probation keeps the badge's own accent ones. */
export const STATUS_STYLE: Record<EmployeeStatus, string> = {
  active: 'bg-ok-soft text-ok',
  probation: '', // the badge's own accent colours
  on_leave: 'bg-warn-soft text-warn',
  notice_period: 'bg-line-soft text-muted',
  resigned: 'bg-line-soft text-muted',
  terminated: 'bg-line-soft text-muted',
};

/**
 * Each standing's colours: a status's as above; Trainee and Intern outlined, apart from Active's and Probation's filled
 * ones (a trainee in Active's green, an intern in Probation's accent); Former employee and Not employed yet, no current
 * employment, shown quietly.
 */
export const STANDING_STYLE: Record<Standing, string> = {
  ...STATUS_STYLE,
  trainee: 'border border-ok/40 bg-white text-ok',
  intern: 'border border-accent/40 bg-white text-accent',
  former: 'bg-line-soft text-muted',
  not_employed: 'border border-dashed border-line bg-white text-muted',
};

/**
 * A current employment's status as its badge shows it: Trainee or Intern for a trainee's or an intern's Active (or a
 * Probation from before 19 October 2026); null to show the status itself (any other, or the type not known).
 */
export function trainingStanding(status: EmployeeStatus, employmentType?: EmploymentType | string | null): 'trainee' | 'intern' | null {
  if (!employmentType) return null;
  const standing = employmentStanding({ status, employmentType });
  return standing === 'trainee' || standing === 'intern' ? standing : null;
}

/**
 * A direct report's standing, as the API sends it (Trainee or Intern for a trainee's or an intern's Active); from an
 * older API, their employment's status (a report's employment is current).
 */
export function reportStanding(r: { status: EmployeeStatus; standing?: Standing }): Standing {
  return r.standing ?? (r.status === 'resigned' || r.status === 'terminated' ? 'former' : r.status);
}

/**
 * A profile's standing, worked out as GET /employees does: the current employment's (employmentStanding: Trainee or
 * Intern for a trainee's or an intern's), else whether one ended.
 */
export function standingOf(profile: Pick<EmployeeProfile, 'employment' | 'employments'>): Standing {
  if (profile.employment) return employmentStanding(profile.employment);
  return profile.employments.length > 0 ? 'former' : 'not_employed';
}
