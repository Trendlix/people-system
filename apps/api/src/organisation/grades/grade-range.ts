// The range of grades a job title takes (owner's decision, 15 October 2026): a lowest and a highest grade, either or
// both optional. An open end takes any grade on that side.

type End = { code: string; rank: number } | null;

/** "G3 to G6", "G4" (one grade only), "from G3" or "up to G6"; null when the job title takes any grade. */
export function gradeRange(min: End, max: End): string | null {
  if (min && max) return min.rank === max.rank ? min.code : `${min.code} to ${max.code}`;
  if (min) return `from ${min.code}`;
  if (max) return `up to ${max.code}`;
  return null;
}

/** Whether a grade of this rank is one the range takes. */
export function inGradeRange(rank: number, min: End, max: End): boolean {
  return (!min || rank >= min.rank) && (!max || rank <= max.rank);
}
