import { graduationMonthText, graduationPassed, isStudyYear, printedQualificationAr, STUDY_YEAR_LABELS } from '@trendlix/shared';
import type { EmployeeProfile } from '../../../lib/types';

// A student on the Education tab (owner, 25 October 2026, on the trainee contract template's {{qualification}}: "if the
// intern is a student, how will we deal with it? … i am talking about the field mapping"; asked, "Add a Student
// option"): the "Still studying" switch, the year (الفرقة) and the expected graduation, a month the API keeps as its
// first day. Plain helpers for the Education tab and its form, so they are unit tested (student.test.ts); relative
// imports, as the tests run without the "@/" alias.

type Education = Pick<EmployeeProfile, 'degree' | 'university' | 'faculty' | 'qualificationAr' | 'gender' | 'stillStudying' | 'studyYear' | 'expectedGraduation'>;

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * The expected graduation as typed or picked, as the API takes it (YYYY-MM-01): "2027-06" (a month field), "06/2027" or
 * "6/2027"; null when empty; undefined when it isn't a month.
 */
export function monthFrom(text: string): string | null | undefined {
  const s = latin(text).trim();
  if (s === '') return null;
  const iso = /^(\d{4})-(\d{1,2})$/.exec(s);
  const typed = iso ? null : /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  const [year, month] = iso ? [iso[1], Number(iso[2])] : typed ? [typed[2], Number(typed[1])] : [null, 0];
  if (!year || month < 1 || month > 12) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** A month kept (YYYY-MM-01) as the month field shows it: "2027-06"; '' for none. */
export const monthValue = (month: string | null | undefined): string => (month && /^\d{4}-\d{2}/.test(month) ? month.slice(0, 7) : '');

/** "June 2027" for a month kept; '' for none. */
export const monthShown = (month: string | null | undefined): string => graduationMonthText(month);

/** The year of study as the screens show it: "Third year", "Master's"; '' for none. */
export const studyYearShown = (year: string | null | undefined): string => (isStudyYear(year) ? STUDY_YEAR_LABELS[year] : (year ?? ''));

/**
 * Which education fields the profile counts for this person, as the API's completeness: a student is asked the
 * university, the faculty, the year and the expected graduation, never a degree, a major, a graduation year or a grade;
 * a high school diploma no university, faculty or major. The qualification always (a student's is there once it can be
 * worded: printsAs).
 */
export function educationRequired(p: Pick<Education, 'degree' | 'stillStudying'>) {
  const student = !!p.stillStudying;
  const studied = student || p.degree !== 'high_school';
  return {
    university: studied,
    faculty: studied,
    degree: !student,
    major: studied && !student,
    graduationYear: !student,
    educationGrade: !student,
    studyYear: student,
    expectedGraduation: student,
    qualificationAr: true,
  };
}

/**
 * What {{qualification}} prints for the profile (packages/shared printedQualificationAr): Qualification (Arabic) as
 * typed; else, still studying, the student's wording (`worded`); else nothing.
 */
export function printsAs(p: Education): { text: string; worded: boolean } {
  const text = printedQualificationAr(p);
  return { text, worded: text !== '' && !p.qualificationAr?.trim() };
}

/** Still marked studying after the expected graduation month (`today`: YYYY-MM-DD, Cairo): the Education tab's note. */
export function graduationNote(p: Pick<Education, 'stillStudying' | 'expectedGraduation'>, today: string): string | null {
  if (!p.stillStudying || !graduationPassed(p.expectedGraduation, today)) return null;
  return 'Passed: update the qualification, and turn Still studying off once they graduate.';
}
