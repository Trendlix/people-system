// Plain helpers for grades, usable on the server and in forms.

type Named = { code: string; levelEn: string };
type Ranked = { id: string; code: string; rank: number };

/** A job title's allowed grades: the lowest and the highest, either of which may be open (both open = any grade). */
export type GradeRange = { minGrade: Ranked | null; maxGrade: Ranked | null };

/** "G4 · Senior": how a grade is shown (the grading system is on the Grades tab, lowest rank first). */
export function gradeLabel(grade: Named): string {
  return `${grade.code} · ${grade.levelEn}`;
}

/** A job title's grades, short: "G3–G6", "From G3", "Up to G6", "G4" (one grade only); null when any grade is allowed. */
export function gradeRangeLabel({ minGrade: min, maxGrade: max }: GradeRange): string | null {
  if (min && max) return min.id === max.id ? min.code : `${min.code}–${max.code}`;
  if (min) return `From ${min.code}`;
  if (max) return `Up to ${max.code}`;
  return null;
}

/**
 * A job title's grades in a sentence, as the API words its refusal: "Account Manager takes G3 to G6.", "… takes grades
 * from G3.", "… takes grades up to G6."; null when the title allows any grade.
 */
export function gradeRangeSentence(titleEn: string, { minGrade: min, maxGrade: max }: GradeRange): string | null {
  if (min && max) return min.id === max.id ? `${titleEn} takes ${min.code} only.` : `${titleEn} takes ${min.code} to ${max.code}.`;
  if (min) return `${titleEn} takes grades from ${min.code}.`;
  if (max) return `${titleEn} takes grades up to ${max.code}.`;
  return null;
}

/** Whether the job title's range allows this grade (an open end allows everything on that side). */
export function inGradeRange(grade: { rank: number }, { minGrade: min, maxGrade: max }: GradeRange): boolean {
  return (!min || grade.rank >= min.rank) && (!max || grade.rank <= max.rank);
}

/**
 * What a C-level grade means, beside its mark (owner, 19 October 2026: "make C level Employees details not visible to
 * HR"): those holding it are hidden from HR.
 */
export const CONFIDENTIAL_GRADE_HINT = 'People holding it are hidden from HR: only the CEO and the Super Admin see their details.';

/** What a grade picker says when it leaves the C-level grades out (pickableGrades). */
export const CONFIDENTIAL_GRADES_LEFT_OUT = 'C-level grades are set by the CEO or the Super Admin.';

/**
 * The grades a picker offers (an employment, a job offer, a raise's promotion): every one for someone who may set a
 * C-level grade (`setsConfidential`: the CEO or a Super Admin, setsConfidentialGrade), else all but those marked
 * confidential, which the API refuses them with 403 (owner, 19 October 2026: else HR could hide or unhide someone by
 * their grade); `leftOut` when any was, for the picker to say so.
 */
export function pickableGrades<G extends { id: string; confidential?: boolean }>(grades: readonly G[], setsConfidential: boolean): { grades: G[]; leftOut: boolean } {
  if (setsConfidential) return { grades: [...grades], leftOut: false };
  const offered = grades.filter((g) => g.confidential !== true);
  return { grades: offered, leftOut: offered.length < grades.length };
}
