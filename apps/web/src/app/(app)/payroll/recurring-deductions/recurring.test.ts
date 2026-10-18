import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { RecurringDeductionView } from '../../../../lib/types';
import {
  canSeeRecurring,
  changeRecurringBody,
  changesRecurring,
  deductedText,
  editEndChoices,
  editRecurringBody,
  endChoices,
  fromChoices,
  lastMonth,
  monthlyTotal,
  monthsCounted,
  peopleOf,
  recurringPreview,
  periodText,
  placeOfRecurring,
  recurringBody,
  splitByStatus,
  startChoices,
  stopRecurringBody,
} from './recurring';

// Recurring Deductions (owner, 18 October 2026: a medical subscription is an ongoing monthly share). Today is 18
// October 2026. Everyone here is invented.

const TODAY = '2026-10-18';
const as = (...roles: Role[]) => ({ roles });

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const recurring = (over: Partial<RecurringDeductionView> = {}): RecurringDeductionView => ({
  id: 'r1',
  employee: { id: 'e1', fullNameEn: 'Nour Adel', department: 'Marketing', team: 'Content Team' },
  name: 'Medical subscription (family)',
  amount: 350,
  startMonth: '2026-08',
  endMonth: null,
  stoppedFrom: null,
  stopNote: null,
  status: 'running',
  deducted: [],
  createdAt: '2026-08-01T10:00:00Z',
  ...over,
});

describe('who sees them', () => {
  it('is HR, Finance and the CEO; HR changes them', () => {
    expect(canSeeRecurring(as('finance'))).toBe(true);
    expect(canSeeRecurring(as('ceo'))).toBe(true);
    expect(canSeeRecurring(as('employee', 'manager', 'admin'))).toBe(false);
    expect(changesRecurring(as('hr'))).toBe(true);
    expect(changesRecurring(as('finance', 'ceo'))).toBe(false);
  });
});

describe('each one in words', () => {
  it('says its months: until stopped, to its last month, or stopped', () => {
    expect(periodText({ startMonth: '2026-11', endMonth: null, stoppedFrom: null })).toBe('From November 2026, until stopped');
    expect(periodText({ startMonth: '2026-11', endMonth: '2027-10', stoppedFrom: null })).toBe('November 2026 to October 2027');
    expect(periodText({ startMonth: '2026-11', endMonth: '2026-11', stoppedFrom: null })).toBe('November 2026');
    expect(periodText({ startMonth: '2026-11', endMonth: null, stoppedFrom: '2027-03' })).toBe('November 2026 to February 2027, then stopped');
    expect(periodText({ startMonth: '2026-11', endMonth: null, stoppedFrom: '2026-12' })).toBe('November 2026, then stopped');
    // stopped after its last month: it had ended anyway
    expect(periodText({ startMonth: '2026-11', endMonth: '2027-01', stoppedFrom: '2027-06' })).toBe('November 2026 to January 2027');
    expect(periodText({ startMonth: '2026-11', endMonth: null, stoppedFrom: '2026-11' })).toBe('Stopped before it began (November 2026)');
  });

  it('knows its last month', () => {
    expect(lastMonth({ endMonth: null, stoppedFrom: null })).toBeNull();
    expect(lastMonth({ endMonth: '2027-10', stoppedFrom: '2027-03' })).toBe('2027-02');
    expect(lastMonth({ endMonth: '2027-01', stoppedFrom: '2027-03' })).toBe('2027-01');
    expect(lastMonth({ endMonth: null, stoppedFrom: '2027-01' })).toBe('2026-12');
  });

  it('says what was deducted, the cancelled left out, and what waits for its run', () => {
    expect(
      deductedText({
        deducted: [
          { month: '2026-08', amount: 350, status: 'cancelled' },
          { month: '2026-09', amount: 350, status: 'applied' },
          { month: '2026-10', amount: 350.5, status: 'applied' },
          { month: '2026-11', amount: 350, status: 'pending' },
        ],
      }),
    ).toEqual({ applied: '2 months, EGP 700.50', pending: '1 waiting for its run' });
    expect(deductedText({ deducted: [{ month: '2026-09', amount: 350, status: 'applied' }] })).toEqual({ applied: '1 month, EGP 350.00', pending: null });
    expect(deductedText({ deducted: [] })).toEqual({ applied: 'None yet', pending: null });
  });

  it('groups them by where the employee works, and splits off those ended', () => {
    expect(placeOfRecurring(recurring())).toBe('Marketing › Content Team');
    expect(placeOfRecurring(recurring({ employee: { id: 'e2', fullNameEn: 'Omar Ali', department: 'Sales', team: null } }))).toBe('Sales');
    const rows = [recurring(), recurring({ id: 'r2', status: 'upcoming', amount: 200 }), recurring({ id: 'r3', status: 'ended', employee: { id: 'e3', fullNameEn: 'Mai Samir', department: null, team: null } })];
    const { current, ended } = splitByStatus(rows);
    expect(current.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(ended.map((r) => r.id)).toEqual(['r3']);
    // a month: those running only
    expect(monthlyTotal(rows)).toBe(350);
    expect(peopleOf(rows)).toBe(2);
  });
});

describe('the months the forms offer', () => {
  it('a new one starts from last month to a year ahead; its last month up to three years ahead', () => {
    const starts = startChoices(TODAY);
    expect(starts[0]).toEqual({ value: '2026-09', label: 'September 2026' });
    expect(starts.at(-1)?.value).toBe('2027-10');
    const ends = endChoices(TODAY);
    expect(ends[0].value).toBe('2026-09');
    expect(ends.at(-1)?.value).toBe('2029-10');
  });

  it('a change or a stop is from the first month not yet deducted, not before last month, up to its last month', () => {
    const r = recurring({
      endMonth: '2026-12',
      deducted: [
        { month: '2026-08', amount: 350, status: 'applied' },
        { month: '2026-09', amount: 350, status: 'applied' },
      ],
    });
    expect(fromChoices(r, TODAY).map((m) => m.value)).toEqual(['2026-10', '2026-11', '2026-12']);
    // nothing deducted yet: from last month, whose run may still be made
    expect(fromChoices(recurring({ startMonth: '2026-05' }), TODAY)[0].value).toBe('2026-09');
    // one still to start: from its first month
    const upcoming = fromChoices(recurring({ startMonth: '2027-02', status: 'upcoming' }), TODAY);
    expect(upcoming[0].value).toBe('2027-02');
    expect(upcoming).toHaveLength(37);
    // its last month passed: none
    expect(fromChoices(recurring({ startMonth: '2026-01', endMonth: '2026-06' }), TODAY)).toEqual([]);
  });

  it('a changed last month keeps its own among the choices', () => {
    expect(editEndChoices({ endMonth: '2026-03' }, TODAY)[0]).toEqual({ value: '2026-03', label: 'March 2026' });
    expect(editEndChoices({ endMonth: '2027-03' }, TODAY)[0].value).toBe('2026-09');
  });
});

describe('what the forms send', () => {
  it('a new one: the employee, what for, the amount a month, the first month and the last (empty: until stopped)', () => {
    expect(recurringBody(form({ employeeId: 'e1', name: ' Medical subscription (family) ', amount: '350', startMonth: '2026-11', endMonth: '' }))).toEqual({
      body: { employeeId: 'e1', name: 'Medical subscription (family)', amount: 350, startMonth: '2026-11', endMonth: null },
      errors: [],
    });
    expect(recurringBody(form({ employeeId: 'e1', name: 'Gym', amount: '1,200.50', startMonth: '2026-11', endMonth: '2027-10' })).body).toMatchObject({
      amount: 1200.5,
      endMonth: '2027-10',
    });
    expect(recurringBody(form({})).errors).toEqual([
      'Choose the employee.',
      'Say what it is for, e.g. Medical subscription (family).',
      'Enter the amount a month, more than 0, e.g. 350 or 350.50.',
      'Choose the first month it is deducted.',
    ]);
    expect(recurringBody(form({ employeeId: 'e1', name: 'x'.repeat(101), amount: '350', startMonth: '2026-11', endMonth: '2026-10' })).errors).toEqual([
      'Keep the name to 100 characters or fewer.',
      "The last month can't be before the first.",
    ]);
  });

  it('a change of amount: the new amount and the month it starts', () => {
    expect(changeRecurringBody(form({ amount: '400', fromMonth: '2027-01' }))).toEqual({ body: { amount: 400, fromMonth: '2027-01' }, errors: [] });
    expect(changeRecurringBody(form({ amount: '0', fromMonth: '' })).errors).toEqual([
      'Enter the amount a month, more than 0, e.g. 350 or 350.50.',
      'Choose the month the new amount starts.',
    ]);
  });

  it('a stop: the first month no longer deducted, and why if given', () => {
    expect(stopRecurringBody(form({ fromMonth: '2027-03', note: ' Left the plan ' }))).toEqual({ body: { fromMonth: '2027-03', note: 'Left the plan' }, errors: [] });
    expect(stopRecurringBody(form({ fromMonth: '2027-03' }))).toEqual({ body: { fromMonth: '2027-03' }, errors: [] });
    expect(stopRecurringBody(form({})).errors).toEqual(['Choose the first month it is no longer deducted.']);
  });

  it('an edit: the name and the last month (empty: until stopped)', () => {
    expect(editRecurringBody(form({ name: 'Medical subscription (single)', endMonth: '' }))).toEqual({ body: { name: 'Medical subscription (single)', endMonth: null }, errors: [] });
    expect(editRecurringBody(form({ name: '', endMonth: '2027-13' })).errors).toEqual([
      'Say what it is for, e.g. Medical subscription (family).',
      'Choose the last month it is deducted, or leave it empty to deduct it until stopped.',
    ]);
  });
});

describe('what a new one comes to', () => {
  // owner, 18 October 2026, on the add form: "view assumed numbers"
  it('counts the months, both ends included', () => {
    expect(monthsCounted('2026-10', '2027-07')).toBe(10);
    expect(monthsCounted('2026-10', '2026-10')).toBe(1);
    expect(monthsCounted('2026-12', '2027-01')).toBe(2);
  });

  it('says what it comes to in all, or a year while it runs until stopped', () => {
    expect(recurringPreview('15000', '2026-10', '2027-07', undefined)).toEqual({
      period: '10 months, October 2026 to July 2027: EGP 15,000.00 a month, EGP 150,000.00 in all.',
      share: null,
      overGross: false,
    });
    expect(recurringPreview('350', '2026-11', '', undefined)?.period).toBe('From November 2026 until stopped: EGP 350.00 a month, EGP 4,200.00 a year.');
    expect(recurringPreview('350', '2026-11', '2026-11', undefined)?.period).toBe('1 month, November 2026: EGP 350.00 a month, EGP 350.00 in all.');
  });

  it('gives its share of the current gross, and warns past it', () => {
    expect(recurringPreview('15000', '2026-10', '2027-07', { gross: 50_000 })?.share).toBe(
      '30% of the current gross pay of EGP 50,000.00 a month, leaving EGP 35,000.00 before tax, insurance and other deductions.',
    );
    const over = recurringPreview('60000', '2026-10', '', { gross: 50_000 });
    expect(over?.overGross).toBe(true);
    expect(over?.share).toBe('More than the current gross pay of EGP 50,000.00 a month: the run would have nothing left to pay.');
    expect(recurringPreview('500', '2026-10', '', { gross: null })?.share).toBe('No current contract, so its share of the pay can’t be shown.');
    expect(recurringPreview('500', '2026-10', '', null)?.share).toBe('No current contract, so its share of the pay can’t be shown.');
  });

  it('shows nothing until it can be read, or when the rules refuse it', () => {
    expect(recurringPreview('', '2026-10', '', undefined)).toBeNull();
    expect(recurringPreview('abc', '2026-10', '', undefined)).toBeNull();
    expect(recurringPreview('0', '2026-10', '', undefined)).toBeNull();
    expect(recurringPreview('500', '2026-10', '2026-09', undefined)).toBeNull();
  });
});
