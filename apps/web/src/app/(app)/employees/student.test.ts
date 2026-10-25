import { describe, expect, it } from 'vitest';
import { apiValue, changedKeys, shownValue } from './confirmation';
import { educationRequired, graduationNote, monthFrom, monthShown, monthValue, printsAs, studyYearShown } from './student';

// A student on the Education tab (owner, 25 October 2026: "Add a Student option"): the month typed, what the tab counts
// and prints, the note after the expected graduation, and the employee's own change requests. The people are made up.

const PROFILE = {
  degree: null,
  university: 'Cairo University',
  faculty: 'Commerce',
  qualificationAr: null,
  gender: 'female' as const,
  stillStudying: true,
  studyYear: 'year_3',
  expectedGraduation: '2027-06-01',
};

describe('the expected graduation’s month', () => {
  it('is typed or picked as a month, kept as its first day', () => {
    expect(monthFrom('2027-06')).toBe('2027-06-01');
    expect(monthFrom('06/2027')).toBe('2027-06-01');
    expect(monthFrom(' 6/2027 ')).toBe('2027-06-01');
    expect(monthFrom('٠٦/٢٠٢٧')).toBe('2027-06-01');
    expect(monthFrom('')).toBeNull();
    expect(monthFrom('13/2027')).toBeUndefined();
    expect(monthFrom('June 2027')).toBeUndefined();
  });

  it('is shown in the month field and in words', () => {
    expect(monthValue('2027-06-01')).toBe('2027-06');
    expect(monthValue(null)).toBe('');
    expect(monthShown('2027-06-01')).toBe('June 2027');
    expect(studyYearShown('year_3')).toBe('Third year');
    expect(studyYearShown('masters')).toBe("Master's");
    expect(studyYearShown(null)).toBe('');
  });
});

describe('the Education tab for a student', () => {
  it('counts the year and the expected graduation, not a degree, major, graduation year or grade', () => {
    expect(educationRequired(PROFILE)).toEqual({
      university: true,
      faculty: true,
      degree: false,
      major: false,
      graduationYear: false,
      educationGrade: false,
      studyYear: true,
      expectedGraduation: true,
      qualificationAr: true,
    });
    expect(educationRequired({ degree: 'high_school', stillStudying: false })).toMatchObject({ university: false, faculty: false, major: false, degree: true, studyYear: false });
    expect(educationRequired({ degree: 'bachelor', stillStudying: undefined })).toMatchObject({ major: true, graduationYear: true, expectedGraduation: false });
  });

  it('shows what {{qualification}} prints: the student’s wording while none is typed', () => {
    expect(printsAs(PROFILE)).toEqual({ text: 'طالبة بالفرقة الثالثة – كلية التجارة – جامعة القاهرة', worded: true });
    expect(printsAs({ ...PROFILE, qualificationAr: 'طالبة بكلية التجارة' })).toEqual({ text: 'طالبة بكلية التجارة', worded: false });
    expect(printsAs({ ...PROFILE, studyYear: null })).toEqual({ text: '', worded: false });
    expect(printsAs({ ...PROFILE, stillStudying: false })).toEqual({ text: '', worded: false });
  });

  it('says to update the qualification once the expected graduation month has passed', () => {
    const june = { stillStudying: true, expectedGraduation: '2026-06-01' };
    expect(graduationNote(june, '2026-06-30')).toBeNull();
    expect(graduationNote(june, '2026-07-01')).toBe('Passed: update the qualification, and turn Still studying off once they graduate.');
    expect(graduationNote({ ...june, stillStudying: false }, '2026-10-25')).toBeNull();
  });
});

describe('the employee’s change request for a student', () => {
  it('shows the switch, the year and the month as the profile does', () => {
    expect(shownValue('stillStudying', true)).toBe('Yes');
    expect(shownValue('stillStudying', false)).toBe('No');
    expect(shownValue('stillStudying', null)).toBe('');
    expect(shownValue('studyYear', 'year_7')).toBe('Seventh year');
    expect(shownValue('expectedGraduation', '2027-06-01')).toBe('June 2027');
  });

  it('sends the switch as true or false, the month as its first day', () => {
    const errors: string[] = [];
    expect(apiValue('stillStudying', 'true', errors)).toBe(true);
    expect(apiValue('stillStudying', 'false', errors)).toBe(false);
    expect(apiValue('expectedGraduation', '2027-06', errors)).toBe('2027-06-01');
    expect(apiValue('expectedGraduation', '', errors)).toBeNull();
    expect(apiValue('studyYear', 'year_2', errors)).toBe('year_2');
    expect(errors).toEqual([]);
    apiValue('expectedGraduation', 'next summer', errors);
    expect(errors).toEqual(['Enter the expected graduation as a month, e.g. 06/2027.']);
  });

  it('finds the switch turned on, with the year and the month', () => {
    const start = { stillStudying: 'false', university: 'Cairo University' };
    const now = { stillStudying: 'true', studyYear: 'year_3', expectedGraduation: '2027-06', university: 'Cairo University' };
    expect(changedKeys(start, now)).toEqual(['stillStudying', 'studyYear', 'expectedGraduation']);
  });
});
