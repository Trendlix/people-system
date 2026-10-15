import { Prisma } from '../generated/prisma/client.js';
import { missingTags, resolveValues, rightFor, type ValueSources } from './values.js';

// The values a document prints, from its sources: here the role's duties (owner's request, 15 October 2026), which keep
// their formatting, alongside the plain values.

const DUTIES = '<p>Leads the <strong>sales</strong> team.</p><ul><li><p>Plans the targets</p></li></ul>';

function sources(jobTitle: { titleEn: string; titleAr: string | null; jdDuties: string | null } | null, language: ValueSources['language'] = 'ar'): ValueSources {
  return {
    language,
    employee: {
      employeeCode: 'TL-001',
      fullNameEn: 'Omar Khaled',
      fullNameAr: 'عمر خالد',
      displayName: null,
      nationality: null,
      dateOfBirth: null,
      addressAr: null,
      city: null,
      governorate: null,
      mobile: null,
      workEmail: null,
      personalEmail: null,
      qualificationAr: null,
      insuranceNo: null,
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

describe('amounts in English words', () => {
  it('prints the gross, net, insured and total salary in English words beside the Arabic', async () => {
    const { resolveValues } = await import('./values.js');
    const { Prisma } = await import('../generated/prisma/client.js');
    const d = (n: number) => new Prisma.Decimal(n);
    const sources = {
      language: 'en',
      employee: { employeeCode: 'EMP-1', fullNameEn: 'A', fullNameAr: 'أ', displayName: null, nationality: null, dateOfBirth: null, addressAr: null, city: null, governorate: null, mobile: null, workEmail: null, personalEmail: null, qualificationAr: null, insuranceNo: null },
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
