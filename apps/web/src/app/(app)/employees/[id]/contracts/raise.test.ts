import { describe, expect, it } from 'vitest';
import type { ContractRaise } from '../../../../../lib/raise-types';
import type { JobTitleSummary } from '../../../../../lib/types';
import {
  changeLabel,
  changeOf,
  decisionText,
  defaultEffectiveDate,
  editHref,
  form2Body,
  fromToText,
  insuredFromText,
  insuredWageText,
  jobTitleGroups,
  payChangeWarning,
  pendingKindLabel,
  promotionText,
  raiseBody,
  stageOf,
  stageTone,
  versionBefore,
  versionPay,
} from './raise';

/** A submitted form: each entry once, or a list for repeated fields. */
function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  return fd;
}

const raise: ContractRaise = {
  reason: 'annual',
  approval: 'draft',
  sentAt: null,
  approvedBy: null,
  approvedAt: null,
  returnedReason: null,
  newJobTitle: null,
  newGrade: null,
  form2From: null,
  insuredWageFrom: '2027-01-01',
  requestId: null,
};

describe('the date a raise takes effect', () => {
  it('starts on the next 1st of a month, after the contract in force started', () => {
    expect(defaultEffectiveDate('2026-10-16', { startDate: '2026-01-01' })).toBe('2026-11-01');
    expect(defaultEffectiveDate('2026-12-01', { startDate: '2026-01-01' })).toBe('2027-01-01');
    // a contract starting on the 1st of next month: a raise takes effect on a later 1st
    expect(defaultEffectiveDate('2026-10-16', { startDate: '2026-11-01' })).toBe('2026-12-01');
    expect(defaultEffectiveDate('2026-10-16', { startDate: '2026-11-15' })).toBe('2026-12-01');
  });
});

describe('the insured wage after a raise', () => {
  it('stays as before until the next January, unless Form 2 is filed', () => {
    expect(insuredWageText('2026-11-01', null)).toBe('Insured wage stays as before until January 2027 unless Form 2 is filed.');
    expect(insuredWageText('2026-11-01', '2026-12-01')).toBe('Insured wage follows the new pay from December 2026, with Form 2 filed.');
    expect(insuredWageText('2027-01-01', null)).toBe('Insured wage follows the new pay at once: it is set each January.');
  });

  it('says from when, and whether by Form 2', () => {
    expect(insuredFromText({ insuredWageFrom: '2027-01-01', form2From: null })).toBe('01/01/2027');
    expect(insuredFromText({ insuredWageFrom: '2026-12-01', form2From: '2026-12-01' })).toBe('01/12/2026 (Form 2)');
  });

  it('takes the Form 2 date on the 1st of a month from the raise, or none', () => {
    const errors: string[] = [];
    expect(form2Body(form({ form2From: '1/12/2026' }), '2026-11-01', errors)).toEqual({ form2From: '2026-12-01' });
    expect(form2Body(form({ form2From: '' }), '2026-11-01', errors)).toEqual({ form2From: null });
    expect(errors).toEqual([]);
    const early: string[] = [];
    form2Body(form({ form2From: '01/10/2026' }), '2026-11-01', early);
    expect(early).toEqual(["Form 2 can't change the insured wage before the raise takes effect, on 01/11/2026."]);
    const notFirst: string[] = [];
    form2Body(form({ form2From: '15/12/2026' }), '2026-11-01', notFirst);
    expect(notFirst).toEqual(['Form 2 changes the insured wage from the 1st of a month: choose the 1st, e.g. 01/11/2026.']);
  });
});

describe('a version against the one before it', () => {
  const v1 = { version: 1, kind: 'contract' as const, startDate: '2026-01-01', endDate: '2026-12-31' };
  const v2 = { version: 2, kind: 'amendment' as const, startDate: '2026-06-01', endDate: '2026-12-31' };
  const v3 = { version: 3, kind: 'contract' as const, startDate: '2027-01-01', endDate: '2027-12-31' };
  const v4 = { version: 4, kind: 'contract' as const, startDate: '2027-06-01', endDate: '2028-05-31' };
  const all = [v4, v3, v2, v1];

  it('is the hire, an amendment, a renewal or a new contract to the one before', () => {
    expect([v1, v2, v3, v4].map((v) => changeLabel(changeOf(v, all)))).toEqual(['Hired', 'Amendment', 'Renewal', 'New contract']);
    // a version from before kinds is a whole contract
    expect(changeOf({ version: 3, startDate: '2027-01-01' }, all)).toBe('renewal');
    expect(versionBefore(v3, all)).toBe(v2);
    expect(versionBefore(v1, all)).toBeNull();
  });

  it('is named on its card, and changed on the raise page or the draft page', () => {
    expect(['amendment', 'new_contract', 'renewal'].map((c) => pendingKindLabel(c as never))).toEqual(['Salary amendment', 'New contract', 'Renewal']);
    expect(editHref('e-1', 'c-2', 'amendment')).toBe('/employees/e-1/contracts/c-2/raise');
    expect(editHref('e-1', 'c-2', 'new_contract')).toBe('/employees/e-1/contracts/c-2/raise');
    expect(editHref('e-1', 'c-2', 'renewal')).toBe('/employees/e-1/contracts/c-2/edit');
  });

  it('stands where the API says, or as it works it out', () => {
    expect(stageOf({ status: 'draft', stage: 'pending_ceo', raise })).toBe('pending_ceo');
    expect(stageOf({ status: 'draft', raise: { ...raise, returnedReason: 'Too high' } })).toBe('returned');
    expect(stageOf({ status: 'draft', raise: null })).toBe('draft');
    expect(stageOf({ status: 'active', raise })).toBe('signed');
    expect(stageTone('pending_ceo')).toBe('bg-warn-soft text-warn');
    expect(stageTone('signed')).toBe('bg-ok-soft text-ok');
  });

  it("says the CEO's step", () => {
    expect(decisionText(null)).toBeNull();
    expect(decisionText(raise)).toBe('Not sent to the CEO yet');
    expect(decisionText({ ...raise, returnedReason: 'Too high' })).toBe('Returned to HR');
    expect(decisionText({ ...raise, approval: 'pending_ceo', sentAt: '2026-10-16T08:00:00.000Z' })).toBe('With the CEO since 16/10/2026');
    expect(decisionText({ ...raise, approval: 'approved', approvedBy: { email: 'ceo@trendlix.com' }, approvedAt: '2026-10-17T09:00:00.000Z' })).toBe(
      'Approved by ceo@trendlix.com on 17/10/2026',
    );
  });

  it('names a promotion', () => {
    expect(promotionText(raise)).toBeNull();
    expect(promotionText({ newJobTitle: { id: 'j', titleEn: 'Senior Designer', titleAr: null }, newGrade: { id: 'g', code: 'G5' } })).toBe(
      'Senior Designer · grade G5',
    );
    expect(promotionText({ newJobTitle: null, newGrade: { id: 'g', code: 'G5' } })).toBe('grade G5');
  });
});

describe('the pay before and after', () => {
  it('shows the change in pounds and percent', () => {
    expect(fromToText(15000, 17000)).toBe('EGP 15,000.00 → EGP 17,000.00 (+EGP 2,000.00, +13.3%)');
    expect(fromToText(15000, 14500)).toBe('EGP 15,000.00 → EGP 14,500.00 (−EGP 500.00, −3.3%)');
    expect(fromToText(15000, 15000)).toBe('EGP 15,000.00 (no change)');
    expect(fromToText(0, 1000)).toBe('EGP 0.00 → EGP 1,000.00 (+EGP 1,000.00)');
    expect(fromToText(null, 15000)).toBe('EGP 15,000.00');
    expect(fromToText(15000, null)).toBeNull();
  });

  const before = versionPay({
    payBasis: 'monthly',
    grossSalary: 15000,
    hourlyRate: null,
    hoursPerWeek: null,
    basicPercent: 80,
    allowances: [{ allowanceTypeId: 'a-1', nameEn: 'Transport', nameAr: 'بدل انتقال', taxable: true, insured: false, amount: 1000 }],
  });

  it("warns when a renewal's answer and its pay disagree", () => {
    expect(payChangeWarning('same', before, before, 1)).toBeNull();
    expect(payChangeWarning('changes', { ...before, grossSalary: 16000 }, before, 1)).toBeNull();
    expect(payChangeWarning('same', { ...before, grossSalary: 16000 }, before, 1)).toBe(
      "The pay typed isn't version 1's: choose “The pay changes” and why, or put the pay back as it was.",
    );
    expect(payChangeWarning('changes', before, before, 1)).toBe('The pay typed is still version 1\'s: change it, or choose “Same pay”.');
    // nothing to say while the pay isn't valid yet
    expect(payChangeWarning('same', null, before, 1)).toBeNull();
  });

  it('compares the rate and the hours by the hour, not the monthly estimate', () => {
    const hourly = { ...before, payBasis: 'hourly', grossSalary: 13000, hourlyRate: 150, hoursPerWeek: 20 };
    expect(payChangeWarning('same', { ...hourly, grossSalary: 13000.01 }, hourly, 2)).toBeNull();
    expect(payChangeWarning('same', { ...hourly, hourlyRate: 160 }, hourly, 2)).not.toBeNull();
  });
});

describe('the promotion with a raise', () => {
  const title = (id: string, titleEn: string, department: string, parent: string | null): JobTitleSummary =>
    ({ id, titleEn, department: { id: department, nameEn: department, nameAr: null, parent: parent && { id: parent, nameEn: parent, nameAr: null } } }) as JobTitleSummary;

  it('lists the job titles by department or team', () => {
    expect(
      jobTitleGroups([title('j-1', 'Designer', 'Creative', null), title('j-2', 'Content Writer', 'Content Team', 'Marketing'), title('j-3', 'Art Director', 'Creative', null)]),
    ).toEqual([
      {
        label: 'Creative',
        options: [
          { id: 'j-1', label: 'Designer' },
          { id: 'j-3', label: 'Art Director' },
        ],
      },
      { label: 'Marketing › Content Team', options: [{ id: 'j-2', label: 'Content Writer' }] },
    ]);
  });
});

describe('a raise as the API takes it', () => {
  const amendment = {
    way: 'amendment',
    effectiveDate: '1/12/2026',
    reason: 'annual',
    payBasis: 'monthly',
    salaryBasis: 'gross',
    grossSalary: '17,000',
    basicPercent: '80',
    daysPerWeek: '',
    netSalary: '14100.5',
    newJobTitleId: '',
    newGradeId: '',
    note: ' Yearly review ',
  };

  it('sends an amendment, without a length; from a request, with HR’s comment approving it', () => {
    const errors: string[] = [];
    expect(raiseBody(form({ ...amendment, durationMonths: '12', requestId: 'r-1', comment: ' As asked ' }), errors, false)).toEqual({
      way: 'amendment',
      effectiveDate: '2026-12-01',
      reason: 'annual',
      payBasis: 'monthly',
      grossSalary: 17000,
      basicPercent: 80,
      netSalary: 14100.5,
      allowances: [],
      note: 'Yearly review',
      requestId: 'r-1',
      comment: 'As asked',
    });
    expect(errors).toEqual([]);
  });

  it("sends a new contract's length and a promotion", () => {
    const errors: string[] = [];
    const body = raiseBody(form({ ...amendment, way: 'contract', durationMonths: '12', reason: 'promotion', newJobTitleId: 'j-2', newGradeId: 'g-5' }), errors, false);
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ way: 'contract', durationMonths: 12, reason: 'promotion', newJobTitleId: 'j-2', newGradeId: 'g-5' });
  });

  it('clears a promotion emptied on a draft, and never sends the request again', () => {
    const errors: string[] = [];
    const body = raiseBody(form({ ...amendment, requestId: 'r-1' }), errors, true);
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ newJobTitleId: null, newGradeId: null, daysPerWeek: null });
    expect(body).not.toHaveProperty('requestId');
    expect(body).not.toHaveProperty('comment');
    const fresh = raiseBody(form(amendment), errors, false);
    expect(fresh).not.toHaveProperty('newJobTitleId');
    expect(fresh).not.toHaveProperty('newGradeId');
  });

  it('asks for the way, the date and why', () => {
    const errors: string[] = [];
    raiseBody(form({ ...amendment, way: '', effectiveDate: '', reason: '' }), errors, false);
    expect(errors).toEqual([
      'Choose how the raise is made: an amendment to the contract in force, or a new contract.',
      'Enter the date the raise takes effect, e.g. 01/12/2026.',
      'Choose why the pay changes: annual raise, performance raise, counter-offer raise, promotion, market adjustment, cost of living or other.',
    ]);
    const badDate: string[] = [];
    raiseBody(form({ ...amendment, effectiveDate: '31/02/2026' }), badDate, false);
    expect(badDate).toEqual(['Enter the date the raise takes effect as DD/MM/YYYY, e.g. 14/10/2026.']);
    const badLength: string[] = [];
    raiseBody(form({ ...amendment, way: 'contract', durationMonths: '0' }), badLength, false);
    expect(badLength).toEqual(['A fixed term runs for 1 to 60 months.']);
  });
});
