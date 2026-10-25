import { BUILT_IN_LAW_RATES } from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { EMPLOYMENT_TYPES_AR } from './format.js';
import { missingTags, resolveValues, rightFor, type ValueSources } from './values.js';

// The tags of employment types by the labour law (owner, 18 October 2026): the contract's length, the job of a
// specific-job contract, the nature of the work, remote work and paid by commission, each in Arabic and English (a
// trainee's training stages went with the trainee on 25 October 2026). Everyone here is invented.

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

  it('have no training stages any more (25 October 2026): nothing is printed for them, and nothing is restricted', () => {
    const src = sources({ contract: { form: 'fixed', jobToDo: null } });
    expect(resolveValues(src, ['trainee_stages', 'trainee_stages_ar'])).toEqual({ trainee_stages: '', trainee_stages_ar: '' });
    expect(rightFor('trainee_stages')).toBeNull();
  });

  it('are missing where there is nothing to print, and say where to fill it in', () => {
    const src = sources({ contract: { form: 'fixed', jobToDo: null } });
    const values = resolveValues(src, ['job_to_do']);
    expect(missingTags(values, Object.keys(values))).toEqual([{ tag: 'job_to_do', label: 'The job (specific-job contract)', where: { tab: 'contracts', key: 'jobToDo' } }]);
  });

  it('name the employment types in the law’s Arabic, the unpaid internship تدريب غير مدفوع (25 October 2026)', () => {
    expect(EMPLOYMENT_TYPES_AR).toEqual({
      full_time: 'دوام كامل',
      part_time: 'عمل بعض الوقت',
      intern: 'تدريب غير مدفوع',
      freelance: 'عمل حر (غير خاضع لقانون العمل)',
    });
  });

  it('print an unpaid intern’s type, and the gross as 0 with the allowances on top (19 October 2026)', () => {
    const transport = { nameEn: 'Transportation', nameAr: 'بدل انتقال', amount: new Prisma.Decimal(1500) };
    const contract = { form: 'fixed', jobToDo: null, grossSalary: new Prisma.Decimal(0), insuredSalary: new Prisma.Decimal(0), allowances: [transport] };
    const intern = sources({ employment: { employmentType: 'intern', paidByCommission: false }, contract });
    const tags = ['employment_type', 'employment_type_en', 'gross_salary', 'gross_salary_words', 'gross_salary_words_en', 'basic_salary', 'allowances', 'allowances_total', 'total_salary'];
    const values = resolveValues(intern, tags);
    expect(values).toEqual({
      employment_type: 'تدريب غير مدفوع',
      employment_type_en: 'Unpaid internship',
      gross_salary: '0',
      gross_salary_words: 'صفر جنيه مصري فقط لا غير',
      gross_salary_words_en: 'Zero Egyptian pounds only',
      basic_salary: '0',
      allowances: 'بدل انتقال: 1,500',
      allowances_total: '1,500',
      total_salary: '1,500',
    });
    // a gross of 0 is a value: nothing is missing
    expect(missingTags(values, tags)).toEqual([]);
    expect(resolveValues(sources({ employment: { employmentType: 'intern' } }, 'en'), ['employment_type'])).toEqual({ employment_type: 'Unpaid internship' });
  });
});
