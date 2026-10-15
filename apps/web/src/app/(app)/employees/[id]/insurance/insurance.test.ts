import { describe, expect, it } from 'vitest';
import type { DocumentItem, Employment } from '../../../../../lib/types';
import type { MissingLink } from '../documents/wording';
import {
  formsGap,
  formsToCheck,
  hasInsuranceCopy,
  insuranceCopyHref,
  insuranceForms,
  insuredEmployment,
  jobTitleHref,
  occupationText,
  printHref,
  printRequired,
  printStatus,
  readiness,
  withJobTitleLinks,
} from './insurance';

const ID = 'emp-1';

const item = (slotKey: string, over: Partial<DocumentItem> = {}): DocumentItem => ({
  slotKey,
  name: slotKey,
  templateStatus: 'published',
  templateVersion: 1,
  needsInputs: [],
  documents: [],
  ...over,
});

const employment = (over: Partial<Employment> = {}) => ({ employmentType: 'full_time', endDate: null, ...over }) as Employment;

const OCCUPATION: MissingLink = { tag: 'occupation_code', label: 'Occupation code (social insurance)', place: 'Job title, under Organization › Departments & Job Titles', href: '/organization/departments' };
const OFFICE: MissingLink = { tag: 'insurance_office', label: 'Social insurance office', place: 'Company profile', href: '/organization/company' };

describe('the employment the tab is about', () => {
  it('is the current one, else the latest, else none', () => {
    const current = employment();
    const ended = employment({ endDate: '2026-06-30' });
    expect(insuredEmployment({ employment: current, employments: [current, ended] })).toBe(current);
    expect(insuredEmployment({ employment: null, employments: [ended] })).toBe(ended);
    expect(insuredEmployment({ employment: null, employments: [] })).toBeNull();
  });
});

describe('the forms', () => {
  const tab = {
    sections: [
      { key: 'contract' as const, items: [item('contract_full_time'), item('contract_full_time_insurance')] },
      { key: 'hiring' as const, items: [item('offer_full_time')] },
      { key: 'insurance' as const, items: [item('insurance_form_1'), item('insurance_form_6')] },
    ],
  };

  it('are the API’s insurance section, as offered', () => {
    expect(insuranceForms(tab).map((i) => i.slotKey)).toEqual(['insurance_form_1', 'insurance_form_6']);
    expect(insuranceForms({ sections: [] })).toEqual([]);
  });

  it('point to the contract’s social insurance copy on the Contracts tab, when there is one', () => {
    expect(hasInsuranceCopy(tab)).toBe(true);
    expect(hasInsuranceCopy({ sections: [{ key: 'contract', items: [item('contract_part_time')] }] })).toBe(false);
    expect(insuranceCopyHref(ID)).toBe('/employees/emp-1?tab=contracts#contract-documents');
  });

  it('say why one isn’t listed: no employment, not full time, or Form 6 before an ending', () => {
    expect(formsGap(null, [])?.kind).toBe('not_employed');
    expect(formsGap(employment({ employmentType: 'part_time' }), [])).toEqual({
      kind: 'not_full_time',
      text: 'Forms 1 and 6 are for full-time employments. This one is part-time.',
    });
    expect(formsGap(employment(), [item('insurance_form_1')])).toEqual({ kind: 'no_ending', text: 'Form 6 (leaving) comes once an ending is recorded on the Employment tab.' });
    expect(formsGap(employment(), [item('insurance_form_1'), item('insurance_form_6')])).toBeNull();
  });
});

describe('whether a form can be generated', () => {
  it('checks only the forms with a published template', () => {
    const forms = [item('insurance_form_1'), item('insurance_form_6', { templateStatus: 'missing', templateVersion: null })];
    expect(formsToCheck(forms).map((f) => f.slotKey)).toEqual(['insurance_form_1']);
  });

  it('is ready, or lists what is missing, or says why it couldn’t be checked', () => {
    const form = item('insurance_form_1');
    expect(readiness(form, { missing: [], usesRestricted: false })).toEqual({ state: 'ready' });
    expect(readiness(form, { missing: [OFFICE] })).toEqual({ state: 'missing', missing: [OFFICE] });
    expect(readiness(form, { errors: ['Not available yet.'] })).toEqual({ state: 'unchecked', errors: ['Not available yet.'] });
  });

  it('says where the template stands when it isn’t published', () => {
    expect(readiness(item('insurance_form_6', { templateStatus: 'missing', templateVersion: null }), null)).toEqual({ state: 'template', text: 'No template yet' });
    expect(readiness(item('insurance_form_6', { templateStatus: 'draft', templateVersion: null }), null)).toEqual({
      state: 'template',
      text: 'Draft template only, publish it first',
    });
  });
});

describe('the job title’s occupation', () => {
  const job = { id: 'job-1', departmentId: 'dep-1', titleEn: 'Sales Manager', titleAr: null, jdVersion: 1 };

  it('is written as its code and name, or not at all', () => {
    expect(occupationText({ ...job, occupationCode: '212300', occupationName: 'مدير مبيعات' })).toBe('212300 · مدير مبيعات');
    expect(occupationText({ ...job, occupationCode: '212300', occupationName: null })).toBe('212300');
    expect(occupationText({ ...job, occupationCode: null })).toBeNull();
    expect(occupationText(null)).toBeNull();
  });

  it('is set on the job title’s page, at Edit job title; on the list when the department isn’t known', () => {
    expect(jobTitleHref(job)).toBe('/organization/departments/dep-1/job-titles/job-1#edit');
    expect(jobTitleHref({ id: 'job-1' })).toBe('/organization/departments');
  });

  it('a missing occupation links to the employee’s job title itself; the other details as they were', () => {
    expect(withJobTitleLinks([OCCUPATION, OFFICE], job)).toEqual([{ ...OCCUPATION, href: '/organization/departments/dep-1/job-titles/job-1#edit' }, OFFICE]);
    expect(withJobTitleLinks([OCCUPATION, OFFICE], null)).toEqual([OCCUPATION, OFFICE]);
    expect(withJobTitleLinks([OCCUPATION], { id: 'job-1' })).toEqual([OCCUPATION]);
  });
});

describe('the social insurance print', () => {
  const print = (uploadedAt: string, documentNo: string | null = null) => ({ kind: 'insurance_print' as const, uploadedAt, documentNo });

  it('is needed in a full-time employee’s file, and a never employed one’s, but not a part-timer’s', () => {
    expect(printRequired({ employment: employment(), employments: [employment()], gender: 'male' })).toBe(true);
    expect(printRequired({ employment: null, employments: [], gender: 'female' })).toBe(true);
    const partTime = employment({ employmentType: 'part_time' });
    expect(printRequired({ employment: partTime, employments: [partTime], gender: 'male' })).toBe(false);
    // a former employee's file stays as their last employment's
    expect(printRequired({ employment: null, employments: [partTime], gender: 'male' })).toBe(false);
  });

  it('is uploaded (the newest file, and how many) or missing', () => {
    const items = [
      { kind: 'birth_certificate' as const, uploadedAt: '2026-10-10T08:00:00.000Z', documentNo: null },
      print('2026-09-01T08:00:00.000Z'),
      print('2026-10-12T08:00:00.000Z', '7788'),
    ];
    expect(printStatus(items, true)).toEqual({ state: 'uploaded', uploadedAt: '2026-10-12T08:00:00.000Z', files: 2, documentNo: '7788' });
    expect(printStatus(items.slice(0, 1), true)).toEqual({ state: 'missing', required: true });
    expect(printStatus([], false)).toEqual({ state: 'missing', required: false });
  });

  it('is viewed or uploaded on the Documents tab, at its row when the checklist has one', () => {
    expect(printHref(ID, true)).toBe('/employees/emp-1?tab=documents#paper-insurance_print');
    expect(printHref(ID, false)).toBe('/employees/emp-1?tab=documents');
  });
});
