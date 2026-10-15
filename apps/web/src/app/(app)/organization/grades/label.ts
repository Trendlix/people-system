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
