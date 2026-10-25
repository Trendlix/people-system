import { BUILT_IN_LAW_RATES } from '@trendlix/shared';
import { missingTags, resolveValues, type ValueSources } from './values.js';

// {{qualification}} for a student (owner, 25 October 2026: "if the intern is a student, how will we deal with it? … i am
// talking about the field mapping"; asked, "Add a Student option"): Qualification (Arabic) as typed, else the student's
// wording, else nothing; the missing-fields check asks for it only when there is neither. The person is made up.

type Employee = ValueSources['employee'];

function sources(employee: Partial<Employee>): ValueSources {
  return {
    language: 'ar',
    employee: {
      employeeCode: 'EMP-0001',
      fullNameEn: 'Mona Adel',
      fullNameAr: 'منى عادل',
      displayName: null,
      nationality: null,
      gender: 'female',
      dateOfBirth: null,
      addressAr: null,
      city: null,
      governorate: null,
      buildingNo: null,
      mobile: null,
      workEmail: null,
      personalEmail: null,
      qualificationAr: null,
      insuranceNo: null,
      occupationCode: null,
      insuranceStartDate: null,
      insuranceBasicWage: null,
      insuranceComprehensiveWage: null,
      ...employee,
    },
    identity: null,
    bank: null,
    employment: null,
    contract: null,
    ending: null,
    company: null,
    insuranceBasicDefault: 410,
    lawYears: BUILT_IN_LAW_RATES,
    documentDate: '2026-10-25',
    inputs: {},
  };
}

const STUDENT = { stillStudying: true, studyYear: 'year_3', faculty: 'Commerce', university: 'Cairo University' };
const TAGS = ['qualification'];
const WHERE = { tag: 'qualification', label: 'Qualification (Arabic)', where: { tab: 'education', key: 'qualificationAr' } };

describe('{{qualification}} for a student', () => {
  it('prints the student’s wording while Qualification (Arabic) is empty, in the person’s gender', () => {
    expect(resolveValues(sources(STUDENT), TAGS)).toEqual({ qualification: 'طالبة بالفرقة الثالثة – كلية التجارة – جامعة القاهرة' });
    expect(resolveValues(sources({ ...STUDENT, gender: 'male' }), TAGS)).toEqual({ qualification: 'طالب بالفرقة الثالثة – كلية التجارة – جامعة القاهرة' });
  });

  it('prints Qualification (Arabic) when typed, student or not', () => {
    expect(resolveValues(sources({ ...STUDENT, qualificationAr: 'طالبة بكلية التجارة جامعة القاهرة' }), TAGS)).toEqual({ qualification: 'طالبة بكلية التجارة جامعة القاهرة' });
    expect(resolveValues(sources({ qualificationAr: 'بكالوريوس تجارة' }), TAGS)).toEqual({ qualification: 'بكالوريوس تجارة' });
  });

  it('is missing only when there is neither: not studying, or no year to word it from', () => {
    const missing = (e: Partial<Employee>) => missingTags(resolveValues(sources(e), TAGS), TAGS);
    expect(missing(STUDENT)).toEqual([]);
    expect(missing({ ...STUDENT, studyYear: null })).toEqual([WHERE]);
    expect(missing({ ...STUDENT, stillStudying: false })).toEqual([WHERE]);
    // a job offer's person (no student fields at all), as before
    expect(missing({})).toEqual([WHERE]);
  });
});
