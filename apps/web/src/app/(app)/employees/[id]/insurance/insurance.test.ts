import { describe, expect, it } from 'vitest';
import type { DocumentItem, Employment } from '../../../../../lib/types';
import type { MissingLink } from '../documents/wording';
import {
  basicPrinted,
  comprehensivePrinted,
  formsGap,
  formsToCheck,
  hasInsuranceCopy,
  insurableLimitsText,
  insuranceCopyHref,
  insuranceForms,
  insuredEmployment,
  insuredPrinted,
  occupationText,
  printHref,
  printRequired,
  printStatus,
  readiness,
  showsWages,
  startPrinted,
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

const OCCUPATION: MissingLink = { tag: 'occupation_code', label: 'Occupation code (social insurance)', place: 'Social Insurance tab', href: '/employees/emp-1?tab=insurance#field-occupationCode' };
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
    expect(readiness(form, { missing: [OCCUPATION, OFFICE] })).toEqual({ state: 'missing', missing: [OCCUPATION, OFFICE] });
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

// The employee's own on this tab (owner's decisions, 16 October 2026), each with what Form 1 prints while none is set.
describe('the occupation, subscription start and wages', () => {
  it('the occupation is written as its code and name, or not at all', () => {
    expect(occupationText({ occupationCode: '194200', occupationName: 'اخصائي موارد بشريه' })).toBe('194200 · اخصائي موارد بشريه');
    expect(occupationText({ occupationCode: '194200', occupationName: null })).toBe('194200');
    expect(occupationText({ occupationCode: null, occupationName: null })).toBeNull();
    // an API from before it
    expect(occupationText({})).toBeNull();
  });

  it('the subscription start: the employee’s own, else the join date, else none', () => {
    expect(startPrinted({ insuranceStartDate: '2026-02-01' }, { joinDate: '2026-01-15' })).toEqual({ text: '01/02/2026', from: null });
    expect(startPrinted({ insuranceStartDate: null }, { joinDate: '2026-09-01' })).toEqual({ text: '01/09/2026', from: 'the join date' });
    expect(startPrinted({ insuranceStartDate: null }, null)).toBeNull();
  });

  it('the wages come only for those who see salaries', () => {
    expect(showsWages({ insuranceBasicDefault: 410 })).toBe(true);
    expect(showsWages({})).toBe(false);
  });

  it('the basic wage: the employee’s own, else the contract settings’ default', () => {
    expect(basicPrinted({ insuranceBasicWage: 2500.5, insuranceBasicDefault: 410 })).toEqual({ text: 'EGP 2,500.50', from: null });
    expect(basicPrinted({ insuranceBasicWage: null, insuranceBasicDefault: 410 })).toEqual({ text: 'EGP 410', from: 'default' });
    expect(basicPrinted({})).toBeNull();
  });

  it('the insured and comprehensive wages: the employee’s own, else the contract’s, else none', () => {
    const contract = { insuredSalary: 14500, totalSalary: 15000, salaryHidden: false };
    expect(insuredPrinted({ insuranceInsuredWage: 9000 }, contract)).toEqual({ text: 'EGP 9,000', from: null });
    expect(insuredPrinted({ insuranceInsuredWage: null }, contract)).toEqual({ text: 'EGP 14,500', from: 'from the contract' });
    expect(insuredPrinted({ insuranceInsuredWage: null }, null)).toBeNull();
    expect(comprehensivePrinted({ insuranceComprehensiveWage: 17250.75 }, contract)).toEqual({ text: 'EGP 17,250.75', from: null });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null }, contract)).toEqual({ text: 'EGP 15,000', from: 'from the contract' });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null }, undefined)).toBeNull();
    // a contract whose salary the caller may not see stands in for nothing
    const hidden = { insuredSalary: null, totalSalary: null, salaryHidden: true };
    expect(insuredPrinted({}, hidden)).toBeNull();
    expect(comprehensivePrinted({}, hidden)).toBeNull();
  });

  it('the insured wage’s limits, of the year or the latest known', () => {
    expect(insurableLimitsText(2026)).toBe('EGP 2,700 to 16,700 in 2026');
    expect(insurableLimitsText(2025)).toBe('EGP 2,300 to 14,500 in 2025');
    expect(insurableLimitsText(2031)).toBe('EGP 2,700 to 16,700 in 2026');
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
