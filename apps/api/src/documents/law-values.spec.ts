import { BUILT_IN_LAW_RATES } from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { EMPLOYMENT_TYPES_AR, printedTraineeStages } from './format.js';
import { missingTags, resolveValues, rightFor, type ValueSources } from './values.js';

// The tags of employment types by the labour law (owner, 18 October 2026): the contract's length, the job of a
// specific-job contract, the nature of the work, remote work, paid by commission and a trainee's training stages, each
// in Arabic and English. Everyone here is invented.

const STAGES = [
  { name: 'الأساسيات', months: 3, pay: 4000 },
  { name: 'التطبيق', months: 1, pay: 5500.5 },
];

function sources(over: { employment?: Partial<NonNullable<ValueSources['employment']>>; contract?: Partial<NonNullable<ValueSources['contract']>> } = {}, language: ValueSources['language'] = 'ar'): ValueSources {
  return {
    language,
    employee: {
      employeeCode: 'TL-002',
      fullNameEn: 'Mona Adel',
      fullNameAr: 'منى عادل',
      displayName: null,
      nationality: null,
      gender: null,
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
    },
    identity: null,
    bank: null,
    employment: {
      employmentType: 'full_time',
      joinDate: new Date('2026-01-15T00:00:00Z'),
      jobTitle: null,
      department: null,
      grade: null,
      manager: null,
      shift: null,
      workArrangement: 'hybrid',
      paidByCommission: true,
      workNature: 'seasonal',
      ...over.employment,
    },
    contract: {
      number: 'CON-2026-0009',
      form: 'specific_job',
      status: 'draft',
      startDate: new Date('2026-01-15T00:00:00Z'),
      endDate: null,
      durationMonths: null,
      probationMonths: 0,
      probationEnd: null,
      grossSalary: new Prisma.Decimal(15000),
      basicPercent: 80,
      netSalary: null,
      insuredSalary: new Prisma.Decimal(15000),
      jobTitleEn: null,
      jobTitleAr: null,
      gradeCode: null,
      payBasis: 'monthly',
      hourlyRate: null,
      hoursPerWeek: null,
      daysPerWeek: null,
      allowances: [],
      jobToDo: 'تطوير الموقع الإلكتروني',
      traineeStages: null,
      ...over.contract,
    },
    ending: null,
    company: null,
    insuranceBasicDefault: 410,
    lawYears: BUILT_IN_LAW_RATES,
    documentDate: '2026-10-18',
    inputs: {},
  };
}

const TAGS = ['contract_form', 'contract_form_ar', 'contract_form_en', 'job_to_do', 'work_nature', 'work_nature_en', 'work_pattern', 'work_pattern_en', 'paid_by_commission', 'paid_by_commission_en'];

describe('the labour law’s tags', () => {
  it('print in the template’s language, and their _ar and _en forms in theirs', () => {
    expect(resolveValues(sources(), TAGS)).toEqual({
      contract_form: 'لإنجاز عمل معين',
      contract_form_ar: 'لإنجاز عمل معين',
      contract_form_en: 'For a specific job',
      job_to_do: 'تطوير الموقع الإلكتروني',
      work_nature: 'عمل موسمي',
      work_nature_en: 'Seasonal',
      work_pattern: 'عمل عن بعد جزئيًا',
      work_pattern_en: 'Partly remote work',
      paid_by_commission: 'نعم',
      paid_by_commission_en: 'Yes',
    });
    expect(resolveValues(sources({ employment: { paidByCommission: false, workArrangement: 'wfh' } }, 'en'), ['paid_by_commission', 'work_pattern'])).toEqual({
      paid_by_commission: 'No',
      work_pattern: 'Remote work',
    });
  });

  it('read an employment from before them as regular and not paid by commission', () => {
    const before = sources();
    delete before.employment!.paidByCommission;
    delete before.employment!.workNature;
    expect(resolveValues(before, ['work_nature_en', 'paid_by_commission_en'])).toEqual({ work_nature_en: 'Regular', paid_by_commission_en: 'No' });
  });

  it('print a trainee’s stages in order, restricted as pay', () => {
    const src = sources({ employment: { employmentType: 'trainee', paidByCommission: false }, contract: { form: 'fixed', jobToDo: null, traineeStages: STAGES } });
    expect(resolveValues(src, ['trainee_stages_ar', 'employment_type'])).toEqual({
      trainee_stages_ar: '1. الأساسيات: ثلاثة أشهر، 4,000 شهريًا؛ 2. التطبيق: شهر واحد، 5,500.50 شهريًا',
      employment_type: 'متدرج',
    });
    expect(printedTraineeStages([{ name: 'Basics', months: 3, pay: 4000 }], 'en')).toBe('1. Basics: 3 months, 4,000 a month');
    expect(rightFor('trainee_stages')).toBe('salary');
  });

  it('are missing where there is nothing to print, and say where to fill it in', () => {
    const src = sources({ contract: { form: 'fixed', jobToDo: null } });
    const values = resolveValues(src, ['job_to_do', 'trainee_stages']);
    expect(missingTags(values, Object.keys(values))).toEqual([
      { tag: 'job_to_do', label: 'The job (specific-job contract)', where: { tab: 'contracts', key: 'jobToDo' } },
      { tag: 'trainee_stages', label: 'Training stages', where: { tab: 'contracts', key: 'traineeStages' } },
    ]);
  });

  it('name the employment types in the law’s Arabic', () => {
    expect(EMPLOYMENT_TYPES_AR).toEqual({ full_time: 'دوام كامل', part_time: 'عمل بعض الوقت', trainee: 'متدرج', freelance: 'عمل حر (غير خاضع لقانون العمل)' });
  });
});
