import { Prisma } from '../generated/prisma/client.js';
import { BUILT_IN_LAW_RATES, nationalityAr } from '@trendlix/shared';
import { missingTags, resolveValues, rightFor, type ValueSources } from './values.js';

// The values a document prints, from its sources: here the role's duties (owner's request, 15 October 2026), which keep
// their formatting, alongside the plain values.

const DUTIES = '<p>Leads the <strong>sales</strong> team.</p><ul><li><p>Plans the targets</p></li></ul>';

type JobTitle = NonNullable<ValueSources['employment']>['jobTitle'];

function sources(jobTitle: JobTitle, language: ValueSources['language'] = 'ar'): ValueSources {
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
      jobTitle,
      department: null,
      grade: null,
      manager: null,
      shift: null,
      workArrangement: 'office',
    },
    contract: null,
    ending: null,
    company: null,
    insuranceBasicDefault: 410,
    lawYears: BUILT_IN_LAW_RATES,
    documentDate: '2026-10-15',
    inputs: {},
  };
}

describe("a document's values", () => {
  const role = { titleEn: 'Account Manager', titleAr: 'مدير حسابات', jdDuties: DUTIES };

  it("{{job_duties}} is the role's duties as written, with their formatting, in any template language", () => {
    for (const language of ['ar', 'en', 'bilingual'] as const) {
      expect(resolveValues(sources(role, language), ['job_duties', 'job_title'])).toEqual({ job_duties: { html: DUTIES }, job_title: language === 'en' ? 'Account Manager' : 'مدير حسابات' });
    }
  });

  it('is empty without duties to read: none written, only blank paragraphs, no job title or no employment', () => {
    expect(resolveValues(sources({ ...role, jdDuties: null }), ['job_duties'])).toEqual({ job_duties: '' });
    expect(resolveValues(sources({ ...role, jdDuties: '<p></p><ul><li><p> </p></li></ul>' }), ['job_duties'])).toEqual({ job_duties: '' });
    expect(resolveValues(sources(null), ['job_duties'])).toEqual({ job_duties: '' });
    expect(resolveValues({ ...sources(role), employment: null }, ['job_duties'])).toEqual({ job_duties: '' });
  });

  it('empty duties are missing, to be written for the job title; duties written are not', () => {
    const tags = ['job_duties', 'job_title'];
    expect(missingTags(resolveValues(sources({ ...role, jdDuties: null }), tags), tags)).toEqual([
      { tag: 'job_duties', label: 'Duties and responsibilities', where: { tab: 'employment', key: 'jobTitle' } },
    ]);
    expect(missingTags(resolveValues(sources(role), tags), tags)).toEqual([]);
    // no job title at all: both point to it
    expect(missingTags(resolveValues(sources(null), tags), tags).map((m) => [m.tag, m.where.key])).toEqual([
      ['job_duties', 'jobTitle'],
      ['job_title', 'jobTitle'],
    ]);
  });

  it('the other values stay plain text', () => {
    const src: ValueSources = {
      ...sources(role),
      contract: {
        number: 'CT-1',
        form: 'fixed',
        status: 'draft',
        startDate: new Date('2026-01-15T00:00:00Z'),
        endDate: null,
        durationMonths: 12,
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
      },
    };
    const values = resolveValues(src, ['gross_salary', 'full_name_ar', 'net_salary']);
    expect(values).toEqual({ gross_salary: '15,000', full_name_ar: 'عمر خالد', net_salary: '' });
    expect(missingTags(values, Object.keys(values)).map((m) => m.tag)).toEqual(['net_salary']);
  });
});

// The tags added on the owner's request of 15 October 2026 ("add the missing fields"): each in the template's language
// (a bilingual template's in Arabic), its _ar and _en forms in the language they name.
describe('the added fields', () => {
  const LANGUAGES = ['ar', 'en', 'bilingual'] as const;
  /** A time of day as the database gives a TIME column. */
  const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
  const contract = (terms: Partial<NonNullable<ValueSources['contract']>> = {}): NonNullable<ValueSources['contract']> => ({
    number: 'CON-2026-0001',
    form: 'fixed',
    status: 'draft',
    startDate: new Date('2026-01-15T00:00:00Z'),
    endDate: null,
    durationMonths: 12,
    probationMonths: 3,
    probationEnd: null,
    grossSalary: new Prisma.Decimal(15000),
    basicPercent: 80,
    netSalary: new Prisma.Decimal(12500),
    insuredSalary: new Prisma.Decimal(15000),
    jobTitleEn: null,
    jobTitleAr: null,
    gradeCode: null,
    payBasis: 'monthly',
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    allowances: [],
    ...terms,
  });
  /** An employee with a manager, a shift from 9 to 5, Sunday to Thursday, the Senior grade and a draft contract. */
  function full(language: ValueSources['language'] = 'ar', employment: Partial<NonNullable<ValueSources['employment']>> = {}): ValueSources {
    const base = sources(null, language);
    return {
      ...base,
      employee: { ...base.employee, personalEmail: 'omar.khaled@mail.test' },
      employment: {
        ...base.employment!,
        grade: { code: 'G4', levelEn: 'Senior', levelAr: 'أول' },
        manager: { fullNameEn: 'Mona Adel', fullNameAr: 'منى عادل' },
        shift: { startTime: time('09:00'), endTime: time('17:00'), workingDays: [0, 1, 2, 3, 4] },
        workArrangement: 'hybrid',
        ...employment,
      },
      contract: contract(),
    };
  }
  const value = (src: ValueSources, tag: string) => resolveValues(src, [tag])[tag];
  /** A tag's value in each language: the template's (Arabic, English, bilingual), then its _ar and _en forms. */
  const forms = (tag: string, employment: Partial<NonNullable<ValueSources['employment']>> = {}) => [
    ...LANGUAGES.map((language) => value(full(language, employment), tag)),
    value(full('en', employment), `${tag}_ar`),
    value(full('ar', employment), `${tag}_en`),
  ];

  it('{{personal_email}} is the profile’s personal email; missing without one, on Basic Data', () => {
    expect(value(full(), 'personal_email')).toBe('omar.khaled@mail.test');
    const none = sources(null);
    expect(resolveValues(none, ['personal_email'])).toEqual({ personal_email: '' });
    expect(missingTags(resolveValues(none, ['personal_email']), ['personal_email'])).toEqual([
      { tag: 'personal_email', label: 'Personal email', where: { tab: 'basic', key: 'personalEmail' } },
    ]);
  });

  it('{{manager_name}}: the direct manager’s full name in the template’s language, the other name when one is empty', () => {
    expect(forms('manager_name')).toEqual(['منى عادل', 'Mona Adel', 'منى عادل', 'منى عادل', 'Mona Adel']);
    expect(forms('manager_name', { manager: { fullNameEn: 'Mona Adel', fullNameAr: ' ' } })).toEqual(['Mona Adel', 'Mona Adel', 'Mona Adel', 'Mona Adel', 'Mona Adel']);
    // no manager: missing, to be chosen on the Employment tab
    const tags = ['manager_name', 'manager_name_ar', 'manager_name_en'];
    const values = resolveValues(full('ar', { manager: null }), tags);
    expect(values).toEqual({ manager_name: '', manager_name_ar: '', manager_name_en: '' });
    expect(missingTags(values, tags).map((m) => [m.tag, m.label, m.where])).toEqual([
      ['manager_name', 'Direct manager', { tab: 'employment', key: 'manager' }],
      ['manager_name_ar', 'Direct manager (Arabic)', { tab: 'employment', key: 'manager' }],
      ['manager_name_en', 'Direct manager (English)', { tab: 'employment', key: 'manager' }],
    ]);
  });

  it('{{shift}}: the shift’s times on the 12-hour clock, then its working days as a range when they follow each other', () => {
    const en = '9:00 AM – 5:00 PM, Sunday to Thursday';
    const ar = 'من 9:00 ص إلى 5:00 م، من الأحد إلى الخميس';
    expect(forms('shift')).toEqual([ar, en, ar, ar, en]);
    // across the weekend, and the whole week
    const days = (workingDays: number[], startTime = time('09:00'), endTime = time('17:00')) => ({ shift: { startTime, endTime, workingDays } });
    expect(forms('shift', days([6, 0, 1, 2, 3, 4], time('08:30'), time('16:30')))).toEqual([
      'من 8:30 ص إلى 4:30 م، من السبت إلى الخميس',
      '8:30 AM – 4:30 PM, Saturday to Thursday',
      'من 8:30 ص إلى 4:30 م، من السبت إلى الخميس',
      'من 8:30 ص إلى 4:30 م، من السبت إلى الخميس',
      '8:30 AM – 4:30 PM, Saturday to Thursday',
    ]);
    expect(value(full('en', days([3, 1, 0, 2, 4, 5, 6])), 'shift')).toBe('9:00 AM – 5:00 PM, Sunday to Saturday');
    // noon and midnight
    expect(value(full('en', days([0, 1, 2], time('12:00'), time('00:30'))), 'shift')).toBe('12:00 PM – 12:30 AM, Sunday to Tuesday');
    expect(value(full('ar', days([0, 1, 2], time('12:00'), time('00:30'))), 'shift')).toBe('من 12:00 م إلى 12:30 ص، من الأحد إلى الثلاثاء');
  });

  it('{{shift}}: a flexible shift says its hours to work a day within its times; hours that fill the window print as before (owner, 16 October 2026)', () => {
    const shift = (hoursPerDay: number | null, workingDays = [0, 1, 2, 3, 4]) => ({
      shift: { startTime: time('09:00'), endTime: time('19:00'), hoursPerDay: hoursPerDay === null ? null : new Prisma.Decimal(hoursPerDay), workingDays },
    });
    // the MORNING shift: 9 hours anywhere between 9:00 AM and 7:00 PM
    const ar = '9 ساعات عمل يوميًا بين 9:00 ص و7:00 م، من الأحد إلى الخميس';
    const en = '9 working hours a day between 9:00 AM and 7:00 PM, Sunday to Thursday';
    expect(forms('shift', shift(9))).toEqual([ar, en, ar, ar, en]);
    expect(value(full('en', shift(8.5)), 'shift')).toBe('8.5 working hours a day between 9:00 AM and 7:00 PM, Sunday to Thursday');
    expect(value(full('ar', shift(8.5)), 'shift')).toBe('8.5 ساعة عمل يوميًا بين 9:00 ص و7:00 م، من الأحد إلى الخميس');
    expect(value(full('ar', shift(2, [])), 'shift')).toBe('ساعتا عمل يوميًا بين 9:00 ص و7:00 م');
    expect(value(full('en', shift(1, [])), 'shift')).toBe('1 working hour a day between 9:00 AM and 7:00 PM');
    // the whole window, set or not: the times, as before
    for (const hours of [10, null]) expect(value(full('en', shift(hours)), 'shift')).toBe('9:00 AM – 7:00 PM, Sunday to Thursday');
  });

  it('{{shift}}: working days that don’t follow each other are listed; two or one are named; none leaves the times', () => {
    const days = (workingDays: number[]) => ({ shift: { startTime: time('10:00'), endTime: time('19:00'), workingDays } });
    expect(forms('shift', days([4, 0, 2]))).toEqual([
      'من 10:00 ص إلى 7:00 م، أيام الأحد والثلاثاء والخميس',
      '10:00 AM – 7:00 PM, Sunday, Tuesday and Thursday',
      'من 10:00 ص إلى 7:00 م، أيام الأحد والثلاثاء والخميس',
      'من 10:00 ص إلى 7:00 م، أيام الأحد والثلاثاء والخميس',
      '10:00 AM – 7:00 PM, Sunday, Tuesday and Thursday',
    ]);
    expect(value(full('en', days([0, 1, 3, 4])), 'shift')).toBe('10:00 AM – 7:00 PM, Sunday, Monday, Wednesday and Thursday');
    // two days that follow each other aren't a range; across the weekend, in that order
    expect(value(full('en', days([0, 6])), 'shift')).toBe('10:00 AM – 7:00 PM, Saturday and Sunday');
    expect(value(full('ar', days([0, 6])), 'shift')).toBe('من 10:00 ص إلى 7:00 م، يومي السبت والأحد');
    expect(value(full('en', days([5])), 'shift')).toBe('10:00 AM – 7:00 PM, Friday');
    expect(value(full('ar', days([5])), 'shift')).toBe('من 10:00 ص إلى 7:00 م، يوم الجمعة');
    expect(value(full('en', days([])), 'shift')).toBe('10:00 AM – 7:00 PM');
    expect(value(full('ar', days([])), 'shift')).toBe('من 10:00 ص إلى 7:00 م');
  });

  it('{{shift}} is empty without a shift: missing, to be chosen on the Employment tab', () => {
    const tags = ['shift', 'shift_ar', 'shift_en'];
    const values = resolveValues(full('ar', { shift: null }), tags);
    expect(values).toEqual({ shift: '', shift_ar: '', shift_en: '' });
    expect(missingTags(values, tags).map((m) => [m.tag, m.label, m.where])).toEqual([
      ['shift', 'Working hours', { tab: 'employment', key: 'shift' }],
      ['shift_ar', 'Working hours (Arabic)', { tab: 'employment', key: 'shift' }],
      ['shift_en', 'Working hours (English)', { tab: 'employment', key: 'shift' }],
    ]);
  });

  it('{{work_arrangement}}: each arrangement in English and Arabic', () => {
    const expected = {
      office: ['داخل المكتب', 'Indoor (office)'],
      outdoor: ['ميداني (خارج المكتب)', 'Outdoor (field work)'],
      indoor_outdoor: ['داخل المكتب وخارجه', 'Indoor and outdoor'],
      hybrid: ['هجين (المكتب والمنزل)', 'Hybrid (office and home)'],
      wfh: ['العمل من المنزل', 'Work from home'],
    } as const;
    for (const [workArrangement, [ar, en]] of Object.entries(expected)) {
      expect(forms('work_arrangement', { workArrangement: workArrangement as keyof typeof expected }), workArrangement).toEqual([ar, en, ar, ar, en]);
    }
    // there is always one, but not without an employment
    expect(resolveValues({ ...full(), employment: null }, ['work_arrangement'])).toEqual({ work_arrangement: '' });
  });

  it('{{probation_months}}: the contract’s probation in words; none is a value too', () => {
    const probation = (probationMonths: number) => {
      const src = { ...full(), contract: contract({ probationMonths }) };
      return [
        ...LANGUAGES.map((language) => value({ ...src, language }, 'probation_months')),
        value({ ...src, language: 'en' }, 'probation_months_ar'),
        value(src, 'probation_months_en'),
      ];
    };
    expect(probation(3)).toEqual(['ثلاثة أشهر', '3 months', 'ثلاثة أشهر', 'ثلاثة أشهر', '3 months']);
    expect(probation(2)).toEqual(['شهران', '2 months', 'شهران', 'شهران', '2 months']);
    expect(probation(1)).toEqual(['شهر واحد', '1 month', 'شهر واحد', 'شهر واحد', '1 month']);
    expect(probation(0)).toEqual(['لا توجد فترة اختبار', 'No probation', 'لا توجد فترة اختبار', 'لا توجد فترة اختبار', 'No probation']);
    const tags = ['probation_months', 'probation_months_en'];
    expect(missingTags(resolveValues({ ...full(), contract: contract({ probationMonths: 0 }) }, tags), tags)).toEqual([]);
    // no contract at all: the contract is what's missing
    const none = resolveValues({ ...full(), contract: null }, tags);
    expect(none).toEqual({ probation_months: '', probation_months_en: '' });
    expect(missingTags(none, tags, {}, false).map((m) => m.where)).toEqual([
      { tab: 'contracts', key: 'contract' },
      { tab: 'contracts', key: 'contract' },
    ]);
    expect(missingTags(none, tags).map((m) => m.where)).toEqual([
      { tab: 'contracts', key: 'probationMonths' },
      { tab: 'contracts', key: 'probationMonths' },
    ]);
  });

  it('{{grade_level}}: the grade’s level, the English one without an Arabic level; from the employment’s grade even once signed', () => {
    expect(forms('grade_level')).toEqual(['أول', 'Senior', 'أول', 'أول', 'Senior']);
    expect(forms('grade_level', { grade: { code: 'G3', levelEn: 'Intermediate', levelAr: null } })).toEqual([
      'Intermediate',
      'Intermediate',
      'Intermediate',
      'Intermediate',
      'Intermediate',
    ]);
    // a signed contract keeps only the grade's code: {{grade}} prints it, the level is the employment's grade's
    const signed = { ...full('en'), contract: contract({ status: 'active', gradeCode: 'G4' }) };
    expect(resolveValues(signed, ['grade', 'grade_level'])).toEqual({ grade: 'G4', grade_level: 'Senior' });
    const tags = ['grade_level', 'grade_level_ar'];
    expect(missingTags(resolveValues(full('ar', { grade: null }), tags), tags).map((m) => [m.tag, m.label, m.where])).toEqual([
      ['grade_level', 'Grade level', { tab: 'employment', key: 'grade' }],
      ['grade_level_ar', 'Grade level (Arabic)', { tab: 'employment', key: 'grade' }],
    ]);
  });

  it('{{net_hourly_rate}}: by the hour, the net ÷ the hours of a month, to the piaster; none for a monthly salary or without a net', () => {
    const hourly = (netSalary: number | null) =>
      contract({ payBasis: 'hourly', hourlyRate: new Prisma.Decimal(100), hoursPerWeek: new Prisma.Decimal(24), netSalary: netSalary === null ? null : new Prisma.Decimal(netSalary) });
    // 24 hours a week are 104 hours a month: 9,000 ÷ 104 = 86.538…
    for (const language of LANGUAGES) expect(value({ ...full(language), contract: hourly(9000) }, 'net_hourly_rate')).toBe('86.54');
    expect(value({ ...full(), contract: hourly(10400) }, 'net_hourly_rate')).toBe('100');
    expect(value({ ...full(), contract: hourly(null) }, 'net_hourly_rate')).toBe('');
    expect(value(full(), 'net_hourly_rate')).toBe(''); // a monthly salary, with a net
    expect(missingTags(resolveValues(full(), ['net_hourly_rate']), ['net_hourly_rate'])).toEqual([
      { tag: 'net_hourly_rate', label: 'Net per hour', where: { tab: 'contracts', key: 'netSalary' } },
    ]);
  });

  it('{{basic_percent}}: the basic salary’s share of the gross', () => {
    for (const language of LANGUAGES) expect(value(full(language), 'basic_percent')).toBe('80%');
    expect(value({ ...full(), contract: contract({ basicPercent: 75 }) }, 'basic_percent')).toBe('75%');
    expect(value({ ...full(), contract: null }, 'basic_percent')).toBe('');
    expect(missingTags(resolveValues({ ...full(), contract: null }, ['basic_percent']), ['basic_percent'])[0].where).toEqual({ tab: 'contracts', key: 'basicPercent' });
  });

  it('the pay ones are restricted like the salary; the others are not', () => {
    expect(rightFor('net_hourly_rate')).toBe('salary');
    expect(rightFor('basic_percent')).toBe('salary');
    for (const tag of ['personal_email', 'manager_name', 'shift', 'work_arrangement', 'probation_months', 'grade_level']) expect(rightFor(tag), tag).toBeNull();
  });
});

// What social insurance Forms 1 and 6 print that the system didn't hold (owner, 15 October 2026): the address in its
// parts and the building number, the employee's occupation in the social insurance table (owner's decision, 16 October
// 2026: no longer the job title's), and the company's insurance office and sector code.
describe('the social insurance details', () => {
  const COMPANY: NonNullable<ValueSources['company']> = {
    nameEn: 'TrendLIX',
    nameAr: 'تريندلكس',
    addressAr: null,
    addressEn: null,
    commercialRegNo: null,
    taxRegNo: null,
    insuranceEmployerNo: '1234567',
    insuranceOffice: 'مكتب تأمينات الدقي',
    insuranceSectorCode: '07',
    repName: null,
    repTitle: null,
    repNameEn: null,
    repTitleEn: null,
    repNationalId: null,
  };
  const TAGS = ['address_line', 'city', 'governorate', 'building_no', 'occupation_code', 'occupation_name', 'insurance_office', 'insurance_sector_code'];
  const ACCOUNTANT = { titleEn: 'Accountant', titleAr: 'محاسب', jdDuties: null };
  function insured(language: ValueSources['language'] = 'ar'): ValueSources {
    const base = sources(ACCOUNTANT, language);
    return {
      ...base,
      employee: { ...base.employee, addressAr: '15 شارع عباس العقاد،', city: 'مدينة نصر', governorate: 'Cairo', buildingNo: '12أ', occupationCode: '012100' },
      company: COMPANY,
    };
  }

  it('prints each from where it is kept, the same in every template language', () => {
    for (const language of ['ar', 'en', 'bilingual'] as const) {
      expect(resolveValues(insured(language), TAGS)).toEqual({
        address_line: '15 شارع عباس العقاد',
        city: 'مدينة نصر',
        governorate: 'القاهرة',
        building_no: '12أ',
        occupation_code: '012100',
        occupation_name: 'فيزيائي عام',
        insurance_office: 'مكتب تأمينات الدقي',
        insurance_sector_code: '07', // as stored, its leading 0 kept
      });
    }
    // {{address}} still prints the whole address
    expect(resolveValues(insured(), ['address']).address).toBe('15 شارع عباس العقاد، مدينة نصر، القاهرة');
  });

  it('the occupation is the employee’s own, whatever their job title, even with no job title or employment', () => {
    const tags = ['occupation_code', 'occupation_name'];
    expect(resolveValues(sources(ACCOUNTANT), tags)).toEqual({ occupation_code: '', occupation_name: '' });
    const own = (src: ValueSources): ValueSources => ({ ...src, employee: { ...src.employee, occupationCode: '194200' } });
    expect(resolveValues(own(sources(null)), tags)).toEqual({ occupation_code: '194200', occupation_name: 'اخصائي موارد بشريه' });
    expect(resolveValues(own({ ...sources(ACCOUNTANT), employment: null }), tags)).toEqual({ occupation_code: '194200', occupation_name: 'اخصائي موارد بشريه' });
    // a code no longer in the table prints as stored, without a name
    const gone = sources(null);
    expect(resolveValues({ ...gone, employee: { ...gone.employee, occupationCode: '000001' } }, tags)).toEqual({ occupation_code: '000001', occupation_name: '' });
  });

  it('says where each missing one is filled in: the profile’s tabs (the occupation on Social Insurance), the company profile', () => {
    const values = resolveValues(sources(null), TAGS);
    expect(Object.values(values).every((v) => v === '')).toBe(true);
    expect(missingTags(values, TAGS)).toEqual([
      { tag: 'address_line', label: 'Street address (Arabic)', where: { tab: 'basic', key: 'addressAr' } },
      { tag: 'city', label: 'City or district (Arabic)', where: { tab: 'basic', key: 'city' } },
      { tag: 'governorate', label: 'Governorate (Arabic)', where: { tab: 'basic', key: 'governorate' } },
      { tag: 'building_no', label: 'Building number', where: { tab: 'basic', key: 'buildingNo' } },
      { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'insurance', key: 'occupationCode' } },
      { tag: 'occupation_name', label: 'Occupation (social insurance)', where: { tab: 'insurance', key: 'occupationCode' } },
      { tag: 'insurance_office', label: 'Social insurance office', where: { tab: 'company', key: 'insuranceOffice' } },
      { tag: 'insurance_sector_code', label: 'Sector code (social insurance)', where: { tab: 'company', key: 'insuranceSectorCode' } },
    ]);
    expect(missingTags(resolveValues(insured(), TAGS), TAGS)).toEqual([]);
  });

  it('none is restricted', () => {
    for (const tag of TAGS) expect(rightFor(tag), tag).toBeNull();
  });
});

// What Form 1 prints that is each employee's own on the Social Insurance tab (owner, 16 October 2026): the
// subscription start and the basic and comprehensive wages, each with what is printed while the employee has none of
// their own; and the insured wage, the comprehensive wage within this year's insurable limits in Cairo (owner's
// decision, 16 October 2026: "Apply the insurance wage cap rule from the comprehensive wage").
describe('the Social Insurance tab’s dates and wages', () => {
  const d = (n: number) => new Prisma.Decimal(n);
  const TAGS = ['insurance_start_date', 'insurance_basic_salary', 'insurance_insured_salary', 'insurance_total_salary'];
  /** A draft contract: gross 15,000, insured 14,500, a transport allowance of 1,000. */
  const CONTRACT: NonNullable<ValueSources['contract']> = {
    number: 'CON-2026-0001',
    form: 'fixed',
    status: 'draft',
    startDate: new Date('2026-01-15T00:00:00Z'),
    endDate: null,
    durationMonths: 12,
    probationMonths: 3,
    probationEnd: null,
    grossSalary: d(15000),
    basicPercent: 80,
    netSalary: null,
    insuredSalary: d(14500),
    jobTitleEn: null,
    jobTitleAr: null,
    gradeCode: null,
    payBasis: 'monthly',
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    allowances: [{ nameEn: 'Transport', nameAr: 'انتقال', amount: d(1000) }],
  };
  const withContract = (over: Partial<NonNullable<ValueSources['contract']>> = {}): ValueSources => ({ ...sources(null), contract: { ...CONTRACT, ...over } });
  /** The employee's own comprehensive wage (and subscription start and basic wage, when given), whatever the contract says. */
  const withOwn = (comprehensive: number, more: Partial<ValueSources['employee']> = {}): ValueSources => {
    const src = withContract();
    return { ...src, employee: { ...src.employee, insuranceComprehensiveWage: d(comprehensive), ...more } };
  };
  const insured = (src: ValueSources) => resolveValues(src, ['insurance_insured_salary']).insurance_insured_salary;

  // the insured wage is kept within the limits of the year it is now in Cairo (2026: 2,700 to 16,700)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('without the employee’s own: the join date, the contract settings’ default, the gross and allowances, within the limits', () => {
    expect(resolveValues(withContract(), TAGS)).toEqual({
      insurance_start_date: '15/01/2026',
      insurance_basic_salary: '410',
      insurance_insured_salary: '16,000',
      insurance_total_salary: '16,000',
    });
    // the default as the contract settings say; the contract's basic salary (the gross × its share) is not it
    expect(resolveValues({ ...withContract(), insuranceBasicDefault: 512.5 }, ['insurance_basic_salary', 'basic_salary'])).toEqual({
      insurance_basic_salary: '512.50',
      basic_salary: '12,000',
    });
  });

  it('the contract’s gross and allowances above the year’s maximum: capped at it', () => {
    const src = withContract({ grossSalary: d(20000), insuredSalary: d(16700) });
    expect(resolveValues(src, ['insurance_insured_salary', 'insurance_total_salary'])).toEqual({ insurance_insured_salary: '16,700', insurance_total_salary: '21,000' });
  });

  it('the employee’s own, whatever the contract says; the insured wage their comprehensive wage capped at the maximum', () => {
    const own = withOwn(17250.75, { insuranceStartDate: new Date('2026-02-01T00:00:00Z'), insuranceBasicWage: d(2500.5) });
    expect(resolveValues(own, TAGS)).toEqual({
      insurance_start_date: '01/02/2026',
      insurance_basic_salary: '2,500.50',
      insurance_insured_salary: '16,700',
      insurance_total_salary: '17,250.75',
    });
    // within the limits, as it is, to the piastre
    expect(insured(withOwn(15200.5))).toBe('15,200.50');
    // the contract's own tags are unchanged: its insured salary is the social insurance copy's
    expect(resolveValues(own, ['join_date', 'insured_salary', 'total_salary'])).toEqual({ join_date: '15/01/2026', insured_salary: '14,500', total_salary: '16,000' });
  });

  it('a comprehensive wage below the year’s minimum: raised to it', () => {
    expect(insured(withOwn(2000))).toBe('2,700');
    expect(insured(withContract({ grossSalary: d(1500), allowances: [] }))).toBe('2,700');
  });

  it('the limits of the year it is in Cairo, or of the latest year known', () => {
    const own = withOwn(17250.75);
    // already 1 January in Cairo
    vi.setSystemTime(new Date('2025-12-31T22:30:00Z'));
    expect(insured(own)).toBe('16,700');
    vi.setSystemTime(new Date('2025-12-31T20:30:00Z'));
    expect(insured(own)).toBe('14,500');
    // a year not in the table: the latest known
    vi.setSystemTime(new Date('2031-06-01T09:00:00Z'));
    expect(insured(own)).toBe('16,700');
  });

  it('missing only with neither the employee’s own nor what stands in for it, filled in on the Social Insurance tab', () => {
    const none: ValueSources = { ...sources(null), employment: null };
    const values = resolveValues(none, TAGS);
    // the basic wage always has the default
    expect(values.insurance_basic_salary).toBe('410');
    expect(missingTags(values, TAGS)).toEqual([
      { tag: 'insurance_start_date', label: 'Subscription start (social insurance)', where: { tab: 'insurance', key: 'insuranceStartDate' } },
      // the insured wage is worked out from the comprehensive wage, which is where it is filled in
      { tag: 'insurance_insured_salary', label: 'Insured wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
      { tag: 'insurance_total_salary', label: 'Comprehensive wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
    ]);
    // without a contract, still the Social Insurance tab (not the contract)
    expect(missingTags(values, TAGS, {}, false).map((m) => m.where.tab)).toEqual(['insurance', 'insurance', 'insurance']);
    // the employee's own comprehensive wage alone is enough
    const own: ValueSources = { ...none, employee: { ...none.employee, insuranceComprehensiveWage: d(9000) } };
    expect(resolveValues(own, ['insurance_insured_salary', 'insurance_total_salary'])).toEqual({ insurance_insured_salary: '9,000', insurance_total_salary: '9,000' });
  });

  it('the wages are restricted like the salary; the start date is not', () => {
    expect(rightFor('insurance_basic_salary')).toBe('salary');
    expect(rightFor('insurance_insured_salary')).toBe('salary');
    expect(rightFor('insurance_total_salary')).toBe('salary');
    expect(rightFor('insurance_start_date')).toBeNull();
  });
});

// The nationality on an Arabic document (owner, 16 October 2026: Form 1 printed "Egyptian"): in Arabic, in the
// person's gender; as typed on an English one.
describe('the nationality', () => {
  it('in Arabic in the person’s gender, matched in any capitals and ignoring spaces; else as typed', () => {
    expect(nationalityAr('Egyptian', 'male')).toBe('مصري');
    expect(nationalityAr('Egyptian', 'female')).toBe('مصرية');
    expect(nationalityAr('  EGYPTIAN ', null)).toBe('مصري'); // masculine when the gender isn't known
    expect(nationalityAr('saudi', 'female')).toBe('سعودية');
    expect(nationalityAr('Filipino', 'female')).toBe('فلبينية');
    expect(nationalityAr('Ethi opian', 'male')).toBe('إثيوبي');
    // already Arabic, or not in the table: as it is
    expect(nationalityAr('مصرية', 'male')).toBe('مصرية');
    expect(nationalityAr(' Icelandic ', 'female')).toBe('Icelandic');
    expect(nationalityAr(null, 'male')).toBe('');
    expect(nationalityAr('', null)).toBe('');
  });

  function of(nationality: string | null, gender: string | null, language: ValueSources['language'] = 'ar'): ValueSources {
    const base = sources(null, language);
    return { ...base, employee: { ...base.employee, nationality, gender } };
  }
  const TAGS = ['nationality', 'nationality_ar', 'nationality_en'];

  it('{{nationality}} in the template’s language (a bilingual one’s in Arabic); its _ar and _en forms in theirs', () => {
    expect(resolveValues(of('Egyptian', 'female', 'ar'), TAGS)).toEqual({ nationality: 'مصرية', nationality_ar: 'مصرية', nationality_en: 'Egyptian' });
    expect(resolveValues(of('Egyptian', 'female', 'bilingual'), TAGS)).toEqual({ nationality: 'مصرية', nationality_ar: 'مصرية', nationality_en: 'Egyptian' });
    expect(resolveValues(of('Egyptian', 'female', 'en'), TAGS)).toEqual({ nationality: 'Egyptian', nationality_ar: 'مصرية', nationality_en: 'Egyptian' });
    // no gender recorded (a job offer has none): the masculine
    expect(resolveValues(of('Egyptian', null, 'ar'), ['nationality'])).toEqual({ nationality: 'مصري' });
    // typed in Arabic: as typed in either
    expect(resolveValues(of('مصري', 'male', 'en'), TAGS)).toEqual({ nationality: 'مصري', nationality_ar: 'مصري', nationality_en: 'مصري' });
  });

  it('missing without one, to be filled in on Basic Data; not restricted', () => {
    expect(missingTags(resolveValues(of(null, 'male'), TAGS), TAGS).map((m) => [m.tag, m.where])).toEqual([
      ['nationality', { tab: 'basic', key: 'nationality' }],
      ['nationality_ar', { tab: 'basic', key: 'nationality' }],
      ['nationality_en', { tab: 'basic', key: 'nationality' }],
    ]);
    for (const tag of TAGS) expect(rightFor(tag), tag).toBeNull();
  });
});

// How an Arabic document addresses the person (owner, 22 October 2026: "if male = السيد / if female = السيدة"; "if no
// gender leave blank").
describe('{{title_ar}}', () => {
  function of(gender: string | null): ValueSources {
    const base = sources(null, 'ar');
    return { ...base, employee: { ...base.employee, gender } };
  }

  it('prints السيد for a man, السيدة for a woman, and nothing without a gender', () => {
    expect(resolveValues(of('male'), ['title_ar'])).toEqual({ title_ar: 'السيد' });
    expect(resolveValues(of('female'), ['title_ar'])).toEqual({ title_ar: 'السيدة' });
    expect(resolveValues(of(null), ['title_ar'])).toEqual({ title_ar: '' });
  });

  it('never stops a document when blank, and is not restricted', () => {
    expect(missingTags(resolveValues(of(null), ['title_ar', 'nationality']), ['title_ar', 'nationality']).map((m) => m.tag)).toEqual(['nationality']);
    expect(rightFor('title_ar')).toBeNull();
  });
});

describe('amounts in English words', () => {
  it('prints the gross, net, insured and total salary in English words beside the Arabic', async () => {
    const { resolveValues } = await import('./values.js');
    const { Prisma } = await import('../generated/prisma/client.js');
    const d = (n: number) => new Prisma.Decimal(n);
    const sources = {
      language: 'en',
      employee: { employeeCode: 'EMP-1', fullNameEn: 'A', fullNameAr: 'أ', displayName: null, nationality: null, gender: null, dateOfBirth: null, addressAr: null, city: null, governorate: null, mobile: null, workEmail: null, personalEmail: null, qualificationAr: null, insuranceNo: null, occupationCode: null, insuranceStartDate: null, insuranceBasicWage: null, insuranceComprehensiveWage: null },
      identity: null,
      bank: null,
      employment: null,
      contract: {
        number: 'CON-1', form: 'fixed', status: 'draft', startDate: new Date('2026-11-01'), endDate: null, durationMonths: 12, probationEnd: null, probationMonths: 3,
        grossSalary: d(15000), basicPercent: 80, netSalary: d(13069.65), insuredSalary: d(15000), jobTitleEn: null, jobTitleAr: null, gradeCode: null,
        payBasis: 'monthly', hourlyRate: null, hoursPerWeek: null, daysPerWeek: null, allowances: [{ nameEn: 'Transport', nameAr: 'انتقال', amount: d(1000) }],
      },
      ending: null,
      company: null,
      documentDate: '2026-10-15',
      inputs: {},
    } as unknown as Parameters<typeof resolveValues>[0];
    const values = resolveValues(sources, ['gross_salary_words', 'gross_salary_words_en', 'net_salary_words_en', 'insured_salary_words_en', 'total_salary_words_en']);
    expect(values.gross_salary_words).toMatch(/لا غير$/);
    expect(values.gross_salary_words_en).toBe('Fifteen thousand Egyptian pounds only');
    expect(values.net_salary_words_en).toBe('Thirteen thousand sixty-nine Egyptian pounds and sixty-five piasters only');
    expect(values.insured_salary_words_en).toBe('Fifteen thousand Egyptian pounds only');
    expect(values.total_salary_words_en).toBe('Sixteen thousand Egyptian pounds only');
  });
});

describe("the company's address and representative", () => {
  it('print in Arabic and in English, each from its own field of the company profile', async () => {
    const { resolveValues, missingTags } = await import('./values.js');
    const sources = {
      language: 'bilingual',
      employee: { employeeCode: 'EMP-1', fullNameEn: 'A', fullNameAr: 'أ' },
      identity: null,
      bank: null,
      employment: null,
      contract: null,
      ending: null,
      company: { nameEn: 'TrendLIX', nameAr: 'تريندلكس', addressAr: 'القاهرة', addressEn: '5 Street, Nasr City, Cairo', repName: 'حازم مجدي', repTitle: 'المدير التنفيذي', repNameEn: 'Hazem Magdy', repTitleEn: 'Chief Executive Officer' },
      documentDate: '2026-10-15',
      inputs: {},
    } as unknown as Parameters<typeof resolveValues>[0];
    const values = resolveValues(sources, ['company_address_ar', 'company_address_en', 'company_rep_name', 'company_rep_name_en', 'company_rep_title', 'company_rep_title_en']);
    expect(values).toEqual({
      company_address_ar: 'القاهرة',
      company_address_en: '5 Street, Nasr City, Cairo',
      company_rep_name: 'حازم مجدي',
      company_rep_name_en: 'Hazem Magdy',
      company_rep_title: 'المدير التنفيذي',
      company_rep_title_en: 'Chief Executive Officer',
    });
    const empty = resolveValues({ ...sources, company: { ...sources.company!, addressEn: null } }, ['company_address_en']);
    expect(missingTags(empty, ['company_address_en'])).toEqual([{ tag: 'company_address_en', label: 'Company address (English)', where: { tab: 'company', key: 'addressEn' } }]);
  });
});

describe('the national ID in Arabic digits', () => {
  it('prints {{national_id_ar}} with ٠-٩ and {{national_id}} with 0-9, for each side of a bilingual document', async () => {
    const { resolveValues } = await import('./values.js');
    const sources = {
      language: 'bilingual',
      employee: { employeeCode: 'EMP-1', fullNameEn: 'A', fullNameAr: 'أ' },
      identity: { nationalId: '29001011234567', printedNo: null, issueDate: null },
      bank: null,
      employment: null,
      contract: null,
      ending: null,
      company: { nameEn: 'TrendLIX', repNationalId: '28501011234567' },
      documentDate: '2026-10-15',
      inputs: {},
    } as unknown as Parameters<typeof resolveValues>[0];
    expect(resolveValues(sources, ['national_id', 'national_id_ar', 'company_rep_national_id_ar'])).toEqual({
      national_id: '29001011234567',
      national_id_ar: '٢٩٠٠١٠١١٢٣٤٥٦٧',
      company_rep_national_id_ar: '٢٨٥٠١٠١١٢٣٤٥٦٧',
    });
  });
});
