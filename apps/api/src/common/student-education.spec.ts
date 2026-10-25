import {
  graduationMonthText,
  graduationOverdueText,
  graduationPassed,
  HIDDEN,
  maskForDeveloper,
  printedQualificationAr,
  STUDY_YEAR_LABELS,
  STUDY_YEARS,
  studentDraftWarning,
  studentQualificationAr,
} from '@trendlix/shared';

// A student on the Education tab (owner, 25 October 2026, on the trainee contract template's {{qualification}}: "if the
// intern is a student, how will we deal with it? … i am talking about the field mapping"; asked, "Add a Student option";
// packages/shared student-education.ts): the wording a contract prints while Qualification (Arabic) is empty, the
// expected graduation's texts, and a developer's view of them. The people here are made up.

describe('a student’s qualification in Arabic', () => {
  it('says the year: the first to the seventh, or a postgraduate study', () => {
    const wording = STUDY_YEARS.map((studyYear) => studentQualificationAr({ studyYear }));
    expect(wording).toEqual([
      'طالب بالفرقة الأولى',
      'طالب بالفرقة الثانية',
      'طالب بالفرقة الثالثة',
      'طالب بالفرقة الرابعة',
      'طالب بالفرقة الخامسة',
      'طالب بالفرقة السادسة',
      'طالب بالفرقة السابعة',
      'طالب دبلوم دراسات عليا',
      'طالب ماجستير',
      'طالب دكتوراه',
    ]);
    expect(Object.keys(STUDY_YEAR_LABELS)).toEqual([...STUDY_YEARS]);
    // no year, or one not on the list: no wording
    expect(studentQualificationAr({ studyYear: null })).toBe('');
    expect(studentQualificationAr({ studyYear: 'year_8' })).toBe('');
  });

  it('in the female form for a woman, as {{title_ar}} reads the gender; the masculine otherwise', () => {
    expect(studentQualificationAr({ studyYear: 'year_3', gender: 'female' })).toBe('طالبة بالفرقة الثالثة');
    expect(studentQualificationAr({ studyYear: 'masters', gender: 'female' })).toBe('طالبة ماجستير');
    expect(studentQualificationAr({ studyYear: 'postgraduate_diploma', gender: 'female' })).toBe('طالبة دبلوم دراسات عليا');
    expect(studentQualificationAr({ studyYear: 'phd', gender: 'female' })).toBe('طالبة دكتوراه');
    expect(studentQualificationAr({ studyYear: 'year_3', gender: 'male' })).toBe('طالب بالفرقة الثالثة');
    expect(studentQualificationAr({ studyYear: 'year_3', gender: null })).toBe('طالب بالفرقة الثالثة');
  });

  it('with the faculty and the university in Arabic: from the lists (kept in English), or typed in Arabic letters', () => {
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: 'Commerce', university: 'Cairo University' })).toBe('طالب بالفرقة الثالثة – كلية التجارة – جامعة القاهرة');
    expect(studentQualificationAr({ studyYear: 'year_2', gender: 'female', faculty: 'Arts', university: 'Ain Shams University' })).toBe(
      'طالبة بالفرقة الثانية – كلية الآداب – جامعة عين شمس',
    );
    // a list's university that isn't a جامعة keeps its own name
    expect(studentQualificationAr({ studyYear: 'year_1', faculty: 'Engineering', university: 'The American University in Cairo' })).toBe(
      'طالب بالفرقة الأولى – كلية الهندسة – الجامعة الأمريكية بالقاهرة',
    );
    // typed in Arabic, with or without the word
    expect(studentQualificationAr({ studyYear: 'year_4', faculty: 'الإعلام', university: 'المنصورة' })).toBe('طالب بالفرقة الرابعة – كلية الإعلام – جامعة المنصورة');
    expect(studentQualificationAr({ studyYear: 'masters', faculty: 'كلية الحقوق', university: 'جامعة طنطا' })).toBe('طالب ماجستير – كلية الحقوق – جامعة طنطا');
    // in any capitals, "Faculty of" too
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: 'faculty of commerce', university: 'cairo university' })).toBe('طالب بالفرقة الثالثة – كلية التجارة – جامعة القاهرة');
  });

  it('leaves out a faculty or a university in English rather than mix the scripts, and never doubles كلية or جامعة', () => {
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: 'Digital Media', university: 'Nile Valley Institute' })).toBe('طالب بالفرقة الثالثة');
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: 'Commerce', university: 'Some College Abroad' })).toBe('طالب بالفرقة الثالثة – كلية التجارة');
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: 'Media جديد', university: 'جامعة القاهرة' })).toBe('طالب بالفرقة الثالثة – جامعة القاهرة');
    for (const s of [studentQualificationAr({ studyYear: 'year_3', faculty: 'كلية التجارة', university: 'جامعة القاهرة' })]) {
      expect(s).not.toMatch(/كلية كلية|جامعة جامعة/);
    }
    expect(studentQualificationAr({ studyYear: 'year_3', faculty: '  ', university: '' })).toBe('طالب بالفرقة الثالثة');
  });
});

describe('{{qualification}}', () => {
  const student = { stillStudying: true, studyYear: 'year_3', gender: 'female', faculty: 'Commerce', university: 'Cairo University' };

  it('is Qualification (Arabic) as typed, which always wins', () => {
    expect(printedQualificationAr({ ...student, qualificationAr: 'طالبة بكلية التجارة' })).toBe('طالبة بكلية التجارة');
    expect(printedQualificationAr({ qualificationAr: ' بكالوريوس تجارة ' })).toBe('بكالوريوس تجارة');
  });

  it('else, still studying, the student’s wording; else nothing, as before', () => {
    expect(printedQualificationAr({ ...student, qualificationAr: null })).toBe('طالبة بالفرقة الثالثة – كلية التجارة – جامعة القاهرة');
    expect(printedQualificationAr({ ...student, qualificationAr: '' })).toBe('طالبة بالفرقة الثالثة – كلية التجارة – جامعة القاهرة');
    expect(printedQualificationAr({ ...student, stillStudying: false, qualificationAr: null })).toBe('');
    expect(printedQualificationAr({ ...student, studyYear: null, qualificationAr: null })).toBe('');
    expect(printedQualificationAr({ qualificationAr: null })).toBe('');
  });
});

describe('the expected graduation', () => {
  it('is a month: "June 2026"', () => {
    expect(graduationMonthText('2026-06-01')).toBe('June 2026');
    expect(graduationMonthText('2027-01')).toBe('January 2027');
    expect(graduationMonthText('2026-13-01')).toBe('');
    expect(graduationMonthText(null)).toBe('');
  });

  it('has passed from the first day of the month after it', () => {
    expect(graduationPassed('2026-06-01', '2026-06-30')).toBe(false);
    expect(graduationPassed('2026-06-01', '2026-07-01')).toBe(true);
    expect(graduationPassed('2026-06-01', '2027-01-15')).toBe(true);
    expect(graduationPassed('2026-06-01', '2026-05-31')).toBe(false);
    expect(graduationPassed(null, '2027-01-15')).toBe(false);
  });

  it('says what to do: Missing Details’ item and a draft’s warning', () => {
    expect(graduationOverdueText('2026-06-01')).toBe('Expected to graduate in June 2026: update the qualification');
    expect(studentDraftWarning('2026-06-01')).toBe('Still marked as a student (expected to graduate June 2026): check the qualification before printing.');
  });

  it('is hidden from a developer: the fields as nothing, the month in a text', () => {
    const profile = { stillStudying: true, studyYear: 'year_3', expectedGraduation: '2026-06-01', faculty: 'Commerce', university: 'Cairo University' };
    expect(maskForDeveloper(profile, '/api/employees/1')).toEqual({ stillStudying: null, studyYear: null, expectedGraduation: null, faculty: HIDDEN, university: HIDDEN });
    const gaps = { missing: [{ key: 'expectedGraduation', label: graduationOverdueText('2026-06-01'), tab: 'education' }] };
    expect(maskForDeveloper(gaps, '/api/employees/missing')).toEqual({ missing: [{ key: 'expectedGraduation', label: `Expected to graduate in ${HIDDEN}: update the qualification`, tab: 'education' }] });
    expect(maskForDeveloper({ studentWarning: studentDraftWarning('2026-06-01') }, '/api/contracts')).toEqual({
      studentWarning: `Still marked as a student (expected to graduate ${HIDDEN}): check the qualification before printing.`,
    });
    // an audit change of them: from and to hidden
    const change = { field: 'studyYear', from: 'year_3', to: 'year_4' };
    expect(maskForDeveloper(change, '/api/audit')).toEqual({ field: 'studyYear', from: HIDDEN, to: HIDDEN });
  });
});
