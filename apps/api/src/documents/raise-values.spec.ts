import { BUILT_IN_LAW_RATES, insuredSalary, lawRatesFor } from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { printedMoney } from './format.js';
import { missingTags, resolveValues, restrictedTags, type ValueSources } from './values.js';

// What a raise's documents print (owner's decisions, 16 October 2026): the salary amendment letter (the pay before and
// after, the effective date, why, the promotion, the contract it adds to) and social insurance Form 2 (the wage change).
// Everyone here is invented.

const D = (n: number) => new Prisma.Decimal(n);
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function sources(raise: ValueSources['raise'], language: ValueSources['language'] = 'ar'): ValueSources {
  return {
    language,
    employee: {
      employeeCode: 'TL-001',
      fullNameEn: 'Omar Khaled',
      fullNameAr: 'عمر خالد',
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
      insuranceNo: '1234567',
      occupationCode: null,
      insuranceStartDate: null,
      insuranceBasicWage: null,
      insuranceComprehensiveWage: null,
    },
    identity: null,
    bank: null,
    employment: {
      employmentType: 'full_time',
      joinDate: day('2026-03-01'),
      jobTitle: { titleEn: 'Accountant', titleAr: 'محاسب', jdDuties: null },
      department: null,
      grade: { code: 'G4', levelEn: 'Mid-Level', levelAr: null },
      manager: null,
      shift: null,
      workArrangement: 'office',
    },
    // the amendment: 13,000 from 1 November 2026 to the contract's end
    contract: {
      number: 'CON-2026-0004-A1',
      form: 'fixed',
      status: 'draft',
      startDate: day('2026-11-01'),
      endDate: day('2027-02-28'),
      durationMonths: null,
      probationMonths: 0,
      probationEnd: null,
      grossSalary: D(13000),
      basicPercent: 80,
      netSalary: null,
      insuredSalary: D(13500),
      jobTitleEn: null,
      jobTitleAr: null,
      gradeCode: null,
      payBasis: 'monthly',
      hourlyRate: null,
      hoursPerWeek: null,
      daysPerWeek: null,
      allowances: [{ nameEn: 'Transport', nameAr: 'بدل انتقال', amount: D(500) }],
    },
    ending: null,
    company: null,
    insuranceBasicDefault: 410,
    lawYears: BUILT_IN_LAW_RATES,
    documentDate: '2026-10-16',
    inputs: {},
    raise,
  };
}

const RAISE: NonNullable<ValueSources['raise']> = {
  reason: 'promotion',
  previous: { grossSalary: D(10000), basicPercent: 80, allowances: [{ nameEn: 'Transport', nameAr: 'بدل انتقال', amount: D(400) }] },
  newJobTitle: { titleEn: 'Senior Accountant', titleAr: 'محاسب أول' },
  newGrade: { code: 'G5' },
  amended: { number: 'CON-2026-0004', startDate: day('2026-03-01') },
  form2From: null,
};

const TAGS = [
  'raise_effective_date',
  'raise_reason',
  'raise_reason_en',
  'previous_gross_salary',
  'previous_basic_salary',
  'previous_allowances',
  'previous_total_salary',
  'raise_amount',
  'raise_percent',
  'new_job_title',
  'new_job_title_en',
  'new_grade',
  'amended_contract_number',
  'amended_contract_date',
  'gross_salary',
];

describe("a raise's values", () => {
  it('the salary amendment letter: before and after, from when, why, the promotion and the contract it adds to', () => {
    const v = resolveValues(sources(RAISE), TAGS);
    expect(v.raise_effective_date).toBe('01/11/2026');
    expect(v.raise_reason).toBe('ترقية');
    expect(v.raise_reason_en).toBe('Promotion');
    expect(v.new_job_title).toBe('محاسب أول');
    expect(v.new_job_title_en).toBe('Senior Accountant');
    expect(v.new_grade).toBe('G5');
    expect(v.amended_contract_number).toBe('CON-2026-0004');
    expect(v.amended_contract_date).toBe('01/03/2026');
    expect(v.raise_percent).toBe('30%');
    // money as the other pay tags print it
    const money = resolveValues(sources(RAISE), ['gross_salary', 'previous_gross_salary', 'raise_amount', 'previous_total_salary', 'previous_basic_salary']);
    expect(money).toEqual({
      gross_salary: printedMoney(13000),
      previous_gross_salary: printedMoney(10000),
      raise_amount: printedMoney(3000),
      previous_total_salary: printedMoney(10400),
      previous_basic_salary: printedMoney(8000),
    });
    expect(resolveValues(sources(RAISE, 'en'), ['previous_allowances']).previous_allowances).toMatch(/^Transport: /);
  });

  it('without a promotion: the job title and grade as they are', () => {
    const v = resolveValues(sources({ ...RAISE, newJobTitle: null, newGrade: null }, 'en'), ['new_job_title', 'new_grade']);
    expect(v).toEqual({ new_job_title: 'Accountant', new_grade: 'G4' });
  });

  it('Form 2: the new insured wage from the effective date, or the Form 2 date, within that year’s limits', () => {
    const tags = ['insured_wage_from', 'new_insured_wage', 'previous_insured_wage', 'new_comprehensive_wage'];
    const v = resolveValues(sources(RAISE), tags);
    expect(v.insured_wage_from).toBe('01/11/2026');
    const limits = lawRatesFor(2026);
    expect(v.new_comprehensive_wage).toBe(printedMoney(13500));
    expect(v.new_insured_wage).toBe(printedMoney(insuredSalary(13500, limits)));
    expect(v.previous_insured_wage).toBe(printedMoney(insuredSalary(10400, limits)));
    expect(resolveValues(sources({ ...RAISE, form2From: day('2026-12-01') }), ['insured_wage_from']).insured_wage_from).toBe('01/12/2026');
  });

  it('Form 1’s insured and comprehensive wages after a raise: the contract pay before it until January (insuredContractTotal)', () => {
    const tags = ['insurance_total_salary', 'insurance_insured_salary'];
    expect(resolveValues({ ...sources(RAISE), insuredContractTotal: 10400 }, tags).insurance_total_salary).toBe(printedMoney(10400));
    // the contract's own without it, and the employee's own comprehensive wage whatever it is
    expect(resolveValues(sources(RAISE), tags).insurance_total_salary).toBe(printedMoney(13500));
    const own = sources(RAISE);
    own.employee = { ...own.employee, insuranceComprehensiveWage: D(11000) };
    expect(resolveValues({ ...own, insuredContractTotal: 10400 }, tags).insurance_total_salary).toBe(printedMoney(11000));
  });

  it('not a raise: empty, so a template printing them is missing them, with the contract', () => {
    const v = resolveValues(sources(null), TAGS);
    expect(v.raise_reason).toBe('');
    expect(v.previous_gross_salary).toBe('');
    expect(missingTags(v, ['raise_reason'])).toEqual([{ tag: 'raise_reason', label: 'Reason for the raise', where: { tab: 'contracts', key: 'raise' } }]);
  });

  it('the pay before and after is restricted, as the salary', () => {
    expect(restrictedTags(['raise_reason', 'previous_gross_salary', 'raise_amount', 'new_insured_wage', 'new_job_title'])).toEqual([
      'previous_gross_salary',
      'raise_amount',
      'new_insured_wage',
    ]);
  });
});
