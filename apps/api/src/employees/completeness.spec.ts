import { toDateOnly } from '../common/date-only.js';
import type { Employee } from '../generated/prisma/client.js';
import { completeness, type ProfileOnFile } from './completeness.js';

// The profile's checklist for a student (owner, 25 October 2026: "Add a Student option"; "Missing Details stops asking for
// a degree"; "HR is reminded to update it after the expected graduation"): the education items only. The person is made
// up.

/** A profile with the names, and the given education. */
const profile = (values: Partial<Employee>, today = '2026-10-25'): ProfileOnFile => ({
  employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Mona Adel', fullNameAr: 'منى عادل', gender: 'female', stillStudying: false, ...values } as Employee,
  identity: null,
  bank: null,
  employment: null,
  latestType: 'intern',
  topRank: null,
  papers: [],
  today,
});
const education = (p: ProfileOnFile) => completeness(p).missing.filter((m) => m.tab === 'education');
const keys = (p: ProfileOnFile) => education(p).map((m) => m.key);

const STUDENT: Partial<Employee> = { stillStudying: true, university: 'Cairo University', faculty: 'Commerce', studyYear: 'year_3', expectedGraduation: toDateOnly('2027-06-01') };

describe('completeness for a student', () => {
  it('asks the university, faculty, year and expected graduation, never a degree, major, graduation year or grade', () => {
    expect(keys(profile({ stillStudying: true }))).toEqual(['university', 'faculty', 'studyYear', 'expectedGraduation', 'qualificationAr']);
    // with a year, the qualification can be worded, so it is there
    expect(keys(profile(STUDENT))).toEqual([]);
    // a high school diploma on file: still at a university and a faculty
    expect(keys(profile({ ...STUDENT, degree: 'high_school', university: null, faculty: null }))).toEqual(['university', 'faculty']);
  });

  it('asks the qualification when no wording can be made and none is typed', () => {
    expect(keys(profile({ ...STUDENT, studyYear: null }))).toEqual(['studyYear', 'qualificationAr']);
    expect(keys(profile({ ...STUDENT, studyYear: null, qualificationAr: 'طالبة بكلية التجارة' }))).toEqual(['studyYear']);
  });

  it('flags them once the expected graduation month has passed, still marked studying, for HR to update the qualification', () => {
    const june = { ...STUDENT, expectedGraduation: toDateOnly('2026-06-01') };
    expect(education(profile(june, '2026-06-30'))).toEqual([]);
    expect(education(profile(june, '2026-07-01'))).toEqual([
      { key: 'expectedGraduation', label: 'Expected to graduate in June 2026: update the qualification', tab: 'education' },
    ]);
    // a typed qualification doesn't put it off: the switch still says studying
    expect(keys(profile({ ...june, qualificationAr: 'طالبة بالفرقة الرابعة' }, '2026-10-25'))).toEqual(['expectedGraduation']);
    // the item counts in the percent
    expect(completeness(profile(june, '2026-07-01')).percent).toBeLessThan(completeness(profile(june, '2026-06-30')).percent);
  });

  it('asks the rest as before for someone not studying', () => {
    expect(keys(profile({}))).toEqual(['degree', 'university', 'faculty', 'major', 'graduationYear', 'educationGrade', 'qualificationAr']);
    expect(keys(profile({ degree: 'high_school' }))).toEqual(['graduationYear', 'educationGrade', 'qualificationAr']);
    // a year or a month left on file without the switch: nothing worded, nothing flagged
    expect(keys(profile({ degree: 'high_school', studyYear: 'year_3', expectedGraduation: toDateOnly('2026-06-01') }))).toEqual(['graduationYear', 'educationGrade', 'qualificationAr']);
  });
});

// owner, 31 October 2026, on the app's Documents: "allow the employee to see the files with a red or green icon if
// submitted or missing": every paper the file needs, on file or not, the national ID's two sides as one
describe('the employee file’s papers', () => {
  it('lists each paper the file needs with whether it is on file', () => {
    const p = { ...profile({}), latestType: 'full_time' as const, papers: ['national_id_front', 'national_id_back'] };
    const papers = completeness(p).papers;
    expect(papers.length).toBeGreaterThan(1);
    expect(papers.find((x) => x.key === 'national_id')).toEqual({ key: 'national_id', label: 'National ID scan (front and back)', onFile: true });
    expect(papers.filter((x) => !x.onFile).map((x) => x.key)).toEqual(completeness(p).missing.filter((m) => m.tab === 'documents').map((m) => m.key));
    // one side only: not on file
    expect(completeness({ ...profile({}), latestType: 'full_time' as const, papers: ['national_id_front'] }).papers.find((x) => x.key === 'national_id')?.onFile).toBe(false);
  });
});
