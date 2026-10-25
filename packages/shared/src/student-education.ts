import { FACULTIES, UNIVERSITIES } from './education.js';

// A student on the Education tab (owner, 25 October 2026, looking at the trainee contract template's {{qualification}},
// المؤهل العلمي: "if the intern is a student, how will we deal with it? … i am talking about the field mapping"; asked,
// "Add a Student option"): a "Still studying" switch, with the year (الفرقة) and the expected graduation. While
// Qualification (Arabic) is empty, the contract prints the student's wording, "طالب بالفرقة الثالثة – كلية … – جامعة …";
// Missing Details asks no degree of a student, and flags them once the expected graduation has passed. Pure, so it is
// unit tested (apps/api/src/common/student-education.spec.ts).

/** The year of study: the first to the seventh (الفرقة), or a postgraduate study. */
export const STUDY_YEARS = ['year_1', 'year_2', 'year_3', 'year_4', 'year_5', 'year_6', 'year_7', 'postgraduate_diploma', 'masters', 'phd'] as const;
export type StudyYear = (typeof STUDY_YEARS)[number];

export const STUDY_YEAR_LABELS: Record<StudyYear, string> = {
  year_1: 'First year',
  year_2: 'Second year',
  year_3: 'Third year',
  year_4: 'Fourth year',
  year_5: 'Fifth year',
  year_6: 'Sixth year',
  year_7: 'Seventh year',
  postgraduate_diploma: 'Postgraduate diploma',
  masters: "Master's",
  phd: 'PhD',
};

/** What a student studies, as the wording says it after طالب or طالبة. */
const STUDYING_AR: Record<StudyYear, string> = {
  year_1: 'بالفرقة الأولى',
  year_2: 'بالفرقة الثانية',
  year_3: 'بالفرقة الثالثة',
  year_4: 'بالفرقة الرابعة',
  year_5: 'بالفرقة الخامسة',
  year_6: 'بالفرقة السادسة',
  year_7: 'بالفرقة السابعة',
  postgraduate_diploma: 'دبلوم دراسات عليا',
  masters: 'ماجستير',
  phd: 'دكتوراه',
};

export const isStudyYear = (value: unknown): value is StudyYear => typeof value === 'string' && (STUDY_YEARS as readonly string[]).includes(value);

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
/** A name that already says what it is: جامعة القاهرة, كلية الآداب, الأكاديمية …, المعهد … */
const INSTITUTION = /^(?:ال)?(?:جامعة|كلية|أكاديمية|اكاديمية|معهد|معاهد|مدينة)(?:\s|$)/;

const lower = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const FACULTY_AR = new Map(FACULTIES.map((f) => [lower(f.en), f.ar]));
const UNIVERSITY_AR = new Map(UNIVERSITIES.map((u) => [lower(u.en), u.ar]));

/** Written in Arabic letters only (the digits and signs aside): an English or a mixed name is left out, never mixed in. */
const inArabicLetters = (s: string) => ARABIC.test(s) && !LATIN.test(s);

/** "كلية التجارة" for the faculty on the list (stored in English) or typed in Arabic; null when only in English. */
function facultyAr(value: string | null | undefined): string | null {
  const v = value?.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  const name = FACULTY_AR.get(lower(v)) ?? FACULTY_AR.get(lower(v.replace(/^faculty of\s+/i, ''))) ?? (inArabicLetters(v) ? v : null);
  return name && (INSTITUTION.test(name) ? name : `كلية ${name}`);
}

/** The university's Arabic name: the list's as it is (جامعة القاهرة, الجامعة الأمريكية بالقاهرة), or as typed in Arabic. */
function universityAr(value: string | null | undefined): string | null {
  const v = value?.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  const listed = UNIVERSITY_AR.get(lower(v));
  if (listed) return listed;
  if (!inArabicLetters(v)) return null;
  return INSTITUTION.test(v) ? v : `جامعة ${v}`;
}

/** What the student's wording is made from: the profile's education and gender. */
export interface StudentEducation {
  /** STUDY_YEARS; anything else (none): no wording. */
  studyYear?: string | null;
  /** GENDERS, read as {{title_ar}} reads it: female gives طالبة, anything else (none too) طالب. */
  gender?: string | null;
  faculty?: string | null;
  university?: string | null;
}

/**
 * The student's qualification as an Arabic document prints it: "طالب بالفرقة الثالثة – كلية التجارة – جامعة القاهرة",
 * "طالبة ماجستير – كلية الآداب" …; the faculty and the university only when they can be written in Arabic (from the
 * lists, or typed in Arabic letters), never doubling كلية or جامعة. Empty without a year of study.
 */
export function studentQualificationAr(s: StudentEducation): string {
  if (!isStudyYear(s.studyYear)) return '';
  const parts = [`${s.gender === 'female' ? 'طالبة' : 'طالب'} ${STUDYING_AR[s.studyYear]}`];
  const faculty = facultyAr(s.faculty);
  if (faculty) parts.push(faculty);
  const university = universityAr(s.university);
  if (university) parts.push(university);
  return parts.join(' – ');
}

/** What {{qualification}} is printed from. */
export interface QualificationSource extends StudentEducation {
  qualificationAr: string | null | undefined;
  stillStudying?: boolean | null;
}

/**
 * {{qualification}}: Qualification (Arabic) as typed, which always wins; else, for someone still studying, the student's
 * wording (studentQualificationAr); else nothing, as before.
 */
export function printedQualificationAr(e: QualificationSource): string {
  const typed = e.qualificationAr?.trim();
  if (typed) return typed;
  return e.stillStudying ? studentQualificationAr(e) : '';
}

// ---------- the expected graduation: a month, kept as its first day (YYYY-MM-01) ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/;

/** "June 2026" for 2026-06-01 (or 2026-06); '' for anything else. */
export function graduationMonthText(month: string | null | undefined): string {
  const m = month ? MONTH.exec(month) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Whether the expected graduation month has passed by `today` (YYYY-MM-DD): from the first day of the month after. */
export function graduationPassed(expected: string | null | undefined, today: string): boolean {
  return !!expected && MONTH.test(expected) && today.slice(0, 7) > expected.slice(0, 7);
}

/** Missing Details' item for someone still marked studying after the expected graduation: for HR. */
export const graduationOverdueText = (expected: string) => `Expected to graduate in ${graduationMonthText(expected)}: update the qualification`;

/** The warning on a renewal or a conversion to full-time drafted for someone still marked studying past it; never blocking. */
export const studentDraftWarning = (expected: string) =>
  `Still marked as a student (expected to graduate ${graduationMonthText(expected)}): check the qualification before printing.`;
