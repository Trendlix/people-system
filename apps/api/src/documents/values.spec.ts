import { Prisma } from '../generated/prisma/client.js';
import { missingTags, resolveValues, type ValueSources } from './values.js';

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
      qualificationAr: null,
      insuranceNo: null,
    },
    identity: null,
    bank: null,
    employment: { employmentType: 'full_time', joinDate: new Date('2026-01-15T00:00:00Z'), jobTitle, department: null, grade: null },
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
