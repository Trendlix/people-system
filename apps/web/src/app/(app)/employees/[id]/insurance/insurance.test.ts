import { describe, expect, it } from 'vitest';
import type { DocumentItem, Employment } from '../../../../../lib/types';
import type { MissingLink } from '../documents/wording';
import {
  asBeforeRaiseNote,
  basicPrinted,
  comprehensivePrinted,
  formsGap,
  formsToCheck,
  hasInsuranceCopy,
  insurableLimitsText,
  insuranceCopyHref,
  insuranceForms,
  insuredEmployment,
  insuredNote,
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

  it('point to the contract’s social insurance copy with the contract on the Employment tab, when there is one', () => {
    expect(hasInsuranceCopy(tab)).toBe(true);
    expect(hasInsuranceCopy({ sections: [{ key: 'contract', items: [item('contract_part_time')] }] })).toBe(false);
    expect(insuranceCopyHref(ID)).toBe('/employees/emp-1?tab=employment#contract-documents');
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
    expect(basicPrinted({ insuranceBasicWage: null, insuranceBasicDefault: 410 })).toEqual({ text: 'EGP 410.00', from: 'default' });
    expect(basicPrinted({})).toBeNull();
  });

  it('the comprehensive wage: the employee’s own, else the contract’s gross and allowances, else none', () => {
    const contract = { totalSalary: 15000, salaryHidden: false };
    expect(comprehensivePrinted({ insuranceComprehensiveWage: 17250.75 }, contract)).toEqual({ text: 'EGP 17,250.75', from: null });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null }, contract)).toEqual({ text: 'EGP 15,000.00', from: 'from the contract' });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null }, undefined)).toBeNull();
    // a contract whose salary is hidden from this viewer stands in for nothing
    expect(comprehensivePrinted({}, { totalSalary: null, salaryHidden: true })).toBeNull();
  });

  // the insured wage isn't edited: the comprehensive wage within the year's limits, as the API worked it out (owner's
  // decision, 16 October 2026), shown with how
  describe('the insured wage', () => {
    const LIMITS = { year: 2026, min: 2700, max: 16700 };

    it('the comprehensive wage as it is, within the limits', () => {
      expect(insuredPrinted({ insuredWage: { amount: 15200, comprehensive: 15200, adjusted: null, limits: LIMITS } })).toEqual({
        text: 'EGP 15,200.00',
        from: 'the comprehensive wage',
      });
      expect(insuredPrinted({ insuredWage: { amount: 16700, comprehensive: 16700, adjusted: null, limits: LIMITS } })?.text).toBe('EGP 16,700.00');
    });

    it('capped at the year’s maximum, or raised to its minimum, saying from what', () => {
      expect(insuredPrinted({ insuredWage: { amount: 16700, comprehensive: 20000, adjusted: 'max', limits: LIMITS } })).toEqual({
        text: 'EGP 16,700.00',
        from: "the comprehensive wage (EGP 20,000.00) capped at 2026's maximum",
      });
      expect(insuredPrinted({ insuredWage: { amount: 2700, comprehensive: 2000.5, adjusted: 'min', limits: LIMITS } })).toEqual({
        text: 'EGP 2,700.00',
        from: "the comprehensive wage (EGP 2,000.50) raised to 2026's minimum",
      });
      // the year of the limits the API used
      expect(insuredPrinted({ insuredWage: { amount: 14500, comprehensive: 17250.75, adjusted: 'max', limits: { year: 2025, min: 2300, max: 14500 } } })?.from).toBe(
        "the comprehensive wage (EGP 17,250.75) capped at 2025's maximum",
      );
    });

    it('not set without a comprehensive wage, or for an API that sends none', () => {
      expect(insuredPrinted({ insuredWage: null })).toBeNull();
      expect(insuredPrinted({})).toBeNull();
    });

    it('the note says what sets it, and the year’s limits', () => {
      expect(insurableLimitsText(LIMITS)).toBe('EGP 2,700.00 to 16,700.00 in 2026');
      expect(insurableLimitsText({ year: 2025, min: 2300, max: 14500 })).toBe('EGP 2,300.00 to 14,500.00 in 2025');
      expect(insuredNote(LIMITS)).toBe('Set by the comprehensive wage, within EGP 2,700.00 to 16,700.00 in 2026.');
    });
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

describe('the insured wage after a raise', () => {
  const LIMITS = { year: 2026, min: 2700, max: 16700 };
  const insuredWage = { amount: 10500, comprehensive: 10500, adjusted: null, limits: LIMITS };

  it('says it stays as before the raise until January, or the Form 2 date once filed (owner’s decision, 16 October 2026)', () => {
    expect(asBeforeRaiseNote({ insuredWageAsBefore: { until: '2027-01-01', form2Filed: false } })).toBe('As before the raise until January 2027; Form 2 not filed.');
    expect(asBeforeRaiseNote({ insuredWageAsBefore: { until: '2026-12-01', form2Filed: true } })).toBe('As before the raise until December 2026; Form 2 filed.');
    expect(asBeforeRaiseNote({ insuredWageAsBefore: null })).toBeNull();
    expect(asBeforeRaiseNote({})).toBeNull();
  });

  it('the comprehensive wage is the contract’s before the raise meanwhile; the employee’s own stands', () => {
    const contract = { totalSalary: 13500, salaryHidden: false };
    const asBefore = { until: '2027-01-01', form2Filed: false };
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null, insuredWage, insuredWageAsBefore: asBefore }, contract)).toEqual({
      text: 'EGP 10,500.00',
      from: 'from the contract before the raise',
    });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: 11000, insuredWage, insuredWageAsBefore: null }, contract)).toEqual({ text: 'EGP 11,000.00', from: null });
    expect(comprehensivePrinted({ insuranceComprehensiveWage: null, insuredWage, insuredWageAsBefore: null }, contract)).toEqual({ text: 'EGP 13,500.00', from: 'from the contract' });
  });
});
