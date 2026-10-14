// Plain helpers for grades, usable on the server and in forms.

/** "G4 · Senior": how a job title's grade is shown (the grading system is on the Grades tab, lowest rank first). */
export function gradeLabel(grade: { code: string; levelEn: string }): string {
  return `${grade.code} · ${grade.levelEn}`;
}
