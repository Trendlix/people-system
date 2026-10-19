import { describe, expect, it } from 'vitest';
import type { AdvanceInstallment } from '../../../../lib/types';
import {
  changeablePlan,
  changeBody,
  changePreview,
  changesInstallment,
  firstMonthChoices,
  installmentsOf,
  installmentStatusText,
  limitHref,
  limitText,
  monthsText,
  nextText,
  NO_WAGE_INSTALLMENTS,
  parseCount,
  planPreview,
  planProblem,
  postponeConfirm,
  SETTLE_CHOICES,
  settleAdvanceBody,
  settledText,
} from './installments';

// Installments (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or something
// that needs to be deducted as installments on the employee. how will it be managed?"). Today is 18 October 2026.
// Every figure is invented.

const TODAY = '2026-10-18';

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/** A loan of 6,000 in 6 from November 2026, November's deducted (applied, so locked). */
const loan: AdvanceInstallment[] = [
  { id: 'i1', month: '2026-11', amount: 1000, status: 'applied', locked: true },
  { id: 'i2', month: '2026-12', amount: 1000, status: 'pending', locked: false },
  { id: 'i3', month: '2027-01', amount: 1000, status: 'pending', locked: false },
  { id: 'i4', month: '2027-02', amount: 1000, status: 'pending', locked: false },
  { id: 'i5', month: '2027-03', amount: 1000, status: 'pending', locked: false },
  { id: 'i6', month: '2027-04', amount: 1000, status: 'pending', locked: false },
];

describe('the record form', () => {
  it('reads how many installments, Arabic digits too', () => {
    expect(parseCount('6')).toBe(6);
    expect(parseCount(' ١٢ ')).toBe(12);
    expect(parseCount('')).toBeNull();
    expect(parseCount('2.5')).toBeNaN();
    expect(parseCount('six')).toBeNaN();
  });

  it('offers the first month from last month to a year ahead, oldest first', () => {
    const months = firstMonthChoices(TODAY);
    expect(months).toHaveLength(14);
    expect(months[0]).toEqual({ value: '2026-09', label: 'September 2026' });
    expect(months[1].value).toBe('2026-10');
    expect(months.at(-1)).toEqual({ value: '2027-10', label: 'October 2027' });
  });

  it('shows the plan as it is typed: equal installments, the last taking the rounding', () => {
    expect(planPreview('6,000', '6', '2026-11')).toMatchObject({ ok: true, text: '6 installments of EGP 1,000.00', months: 'November 2026 to April 2027' });
    const odd = planPreview('10000', '3', '2026-10');
    expect(odd).toMatchObject({ ok: true, text: '3 installments: EGP 3,333.33 … 3,333.34', months: 'October 2026 to December 2026' });
    expect(odd?.ok && odd.plan.map((p) => p.amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(planPreview('500', '1', '2026-11')).toMatchObject({ ok: true, text: '1 installment of EGP 500.00', months: 'November 2026' });
    expect(monthsText([])).toBe('');
  });

  it('shows nothing until the amount and how many are typed, then what is wrong', () => {
    expect(planPreview('', '6', '2026-11')).toBeNull();
    expect(planPreview('6000', '', '2026-11')).toBeNull();
    expect(planPreview('6000', '0', '2026-11')).toEqual({ ok: false, problems: ['Enter how many monthly installments, 1 to 60.'] });
    expect(planPreview('6000', '61', '2026-11')).toEqual({ ok: false, problems: ['Enter how many monthly installments, 1 to 60.'] });
    expect(planPreview('abc', '6', '2026-11')).toEqual({ ok: false, problems: ['Enter the total to recover, more than 0, e.g. 6000 or 6000.50.'] });
    expect(planPreview('0.05', '6', '2026-11')).toEqual({ ok: false, problems: ['The total is too small to split into that many installments.'] });
    expect(planPreview('6000', '6', '')).toEqual({ ok: false, problems: ['Choose the month of the first installment.'] });
  });

  it('refuses a plan that takes a month, with the installments already planned, past 10% of the gross (owner, 18 October 2026: "Block above 10%")', () => {
    const preview = planPreview('6000', '6', '2026-11');
    const plan = preview?.ok ? preview.plan : [];
    // 1,000.00 a month is within 10% of 20,000.00
    expect(planProblem(plan, { gross: 20000, percent: 10, byMonth: {} })).toBeNull();
    // 1,500.00 already planned in November: 2,500.00 there, more than 2,000.00
    expect(planProblem(plan, { gross: 20000, percent: 10, byMonth: { '2026-11': 1500 } })).toBe(
      'In November 2026 the installments of advances and loans would be EGP 2,500.00, more than 10% of the gross pay of EGP 20,000.00 (EGP 2,000.00), the most the law allows (Labour Law Art. 113). Spread it over more months: 12 monthly installments would keep every month within the limit.',
    );
    // on 8,000.00, at most 800.00 a month: 8 months
    expect(planProblem(plan, { gross: 8000, percent: 10, byMonth: {} })).toMatch(/8 monthly installments would keep every month within the limit\.$/);
    // a lower limit set in Payroll Setup
    expect(planProblem(plan, { gross: 20000, percent: 4, byMonth: {} })).toMatch(/more than 4% of the gross pay of EGP 20,000\.00 \(EGP 800\.00\), the limit set in Payroll Setup/);
    // no figures (not read yet) or no current contract: nothing to check against, the API checks it
    expect(planProblem(plan, null)).toBeNull();
    expect(planProblem(plan, { gross: null, percent: 10, byMonth: {} })).toBeNull();
    // an unpaid internship: any installment is refused, with the plain reason
    expect(planProblem(plan, { gross: 0, percent: 10, byMonth: {} })).toBe(NO_WAGE_INSTALLMENTS);
    expect(planProblem([], { gross: 0, percent: 10, byMonth: {} })).toBeNull();
  });

  it('says what the law’s limit is worked out with', () => {
    expect(limitText({ gross: 20000, percent: 10, byMonth: {} })).toBe(
      'The current gross is EGP 20,000.00 a month: a month’s installments of all their advances and loans may take at most 10% of it (EGP 2,000.00), the most the law allows (Labour Law Art. 113).',
    );
    expect(limitText({ gross: 20000, percent: 7.5, byMonth: {} })).toBe(
      'The current gross is EGP 20,000.00 a month: a month’s installments of all their advances and loans may take at most 7.5% of it (EGP 1,500.00), the limit set in Payroll Setup (the law’s is 10%).',
    );
    expect(limitText({ gross: null, percent: 10, byMonth: {} })).toBe('No current contract, so the law’s limit on installments can’t be checked.');
    // an unpaid internship (19 October 2026): no pay to take installments from, not the 10% of EGP 0.00
    expect(limitText({ gross: 0, percent: 10, byMonth: {} })).toBe(NO_WAGE_INSTALLMENTS);
    expect(NO_WAGE_INSTALLMENTS).toMatch(/^The current contract pays no wage \(an unpaid internship\), so there is no pay to take installments/);
    expect(limitText(null)).toBeNull();
    expect(limitHref('e1')).toBe('/payroll/unsettled/installments-limit?employeeId=e1');
  });
});

describe('each installment', () => {
  it('may be moved or changed while pending and its month’s run isn’t approved', () => {
    expect(changesInstallment(loan[1])).toBe(true);
    expect(changesInstallment(loan[0])).toBe(false);
    expect(changesInstallment({ status: 'pending', locked: true })).toBe(false);
    expect(changesInstallment({ status: 'cancelled', locked: false })).toBe(false);
    expect(changeablePlan(loan).map((p) => p.month)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(installmentsOf({})).toEqual([]);
  });

  it('says where it stands, and the next one', () => {
    expect(installmentStatusText(loan[0])).toBe('Applied');
    expect(installmentStatusText(loan[1])).toBe('Pending');
    expect(installmentStatusText({ status: 'pending', locked: true })).toBe('Pending, its month’s run locked');
    expect(nextText({ month: '2026-12', amount: 1000 })).toBe('Next: December 2026, EGP 1,000.00');
    expect(nextText(null)).toBeNull();
    expect(nextText(undefined)).toBeNull();
    expect(postponeConfirm('2026-12')).toBe(
      'Move the December 2026 installment, and every later one, a month on? Nothing of it is deducted in December 2026; the plan ends a month later.',
    );
  });

  it('shows what a change does to the later ones as it is typed', () => {
    expect(changePreview(loan, '2026-12', '2000')).toEqual({ text: 'After it: 4 installments of EGP 750.00, the last in April 2027.' });
    expect(changePreview(loan, '2026-12', '5000')).toEqual({ text: 'Nothing is left to deduct after it.' });
    // a last one lowered: the difference a month after
    expect(changePreview(loan, '2027-04', '500')).toEqual({ text: 'After it: 1 installment of EGP 500.00, the last in May 2027.' });
    expect(changePreview(loan, '2026-12', '6000')).toEqual({ problem: 'The installment can be at most EGP 5,000.00, what is left from that month on.' });
    expect(changePreview(loan, '2026-12', '0')).toEqual({ problem: 'Enter the installment, more than 0, e.g. 1000 or 1000.50.' });
    expect(changePreview(loan, '2026-11', '500')).toEqual({ problem: 'That installment is no longer waiting to be deducted.' });
    expect(changePreview(loan, '2026-12', '')).toBeNull();
  });

  it('a change sends the month and the new amount', () => {
    expect(changeBody(form({ month: '2026-12', amount: '1,250.50' }))).toEqual({ body: { month: '2026-12', amount: 1250.5 }, errors: [] });
    expect(changeBody(form({ month: 'December', amount: '0' })).errors).toEqual([
      'This installment was not found. Reload the page and try again.',
      'Enter the installment in EGP, more than 0, e.g. 1000 or 1000.50.',
    ]);
  });
});

describe('settled', () => {
  it('offers the three ways, paid back first', () => {
    expect(SETTLE_CHOICES.map((c) => [c.value, c.label])).toEqual([
      ['paid_back', 'Paid back'],
      ['final_settlement', 'Deducted from the final settlement'],
      ['waived', 'Waived'],
    ]);
  });

  it('says how, with the note', () => {
    expect(settledText({ settledHow: 'waived', settledNote: 'Hardship, agreed by the CEO' })).toBe('Waived: Hardship, agreed by the CEO');
    expect(settledText({ settledHow: 'final_settlement', settledNote: null })).toBe('Deducted from the final settlement');
    expect(settledText({ settledHow: 'recovered', settledNote: null })).toBe('Recovered from the pay');
    // an API from before settledHow: the note, else recovered
    expect(settledText({ settledNote: 'Paid back in cash' })).toBe('Paid back in cash');
    expect(settledText({ settledHow: null, settledNote: null })).toBe('Recovered from the pay');
  });

  it('the settle form sends how, needing a note to waive it or say how it was paid back', () => {
    expect(settleAdvanceBody(form({ how: 'paid_back', note: ' In cash on 20/10/2026 ' }))).toEqual({ body: { how: 'paid_back', note: 'In cash on 20/10/2026' }, errors: [] });
    expect(settleAdvanceBody(form({ how: 'final_settlement' }))).toEqual({ body: { how: 'final_settlement', note: null }, errors: [] });
    expect(settleAdvanceBody(form({ how: 'waived', note: '' })).errors).toEqual(['Say why it is waived.']);
    expect(settleAdvanceBody(form({ how: 'paid_back' })).errors).toEqual(['Say how it was paid back, e.g. in cash on 20/10/2026.']);
    expect(settleAdvanceBody(form({})).errors).toEqual(['Choose how it was settled.']);
  });
});
