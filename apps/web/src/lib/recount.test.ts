import { describe, expect, it } from 'vitest';
import { monthLabel, monthsAfter, previewText, recountMonths, recountRangeProblem, resultText, skippedText, type RecountView } from './recount';

// Recount past days (owner, 26 October 2026: "i want to recount previous payrolls on the new shift run").

const view: RecountView = {
  from: '2026-08',
  to: '2026-10',
  shiftId: null,
  months: ['2026-09', '2026-10'],
  skipped: [{ month: '2026-08', status: 'paid' }],
  days: 412,
  people: 57,
  zohoDays: 300,
  daysChanged: 57,
  hoursChanged: 50,
  peopleChanged: 20,
  hoursBefore: 401.5,
  hoursAfter: 418.25,
  correctedDays: 2,
  linesRefilled: 23,
};

describe('the months to choose', () => {
  it('names a month and moves across years', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthsAfter('2026-01', -1)).toBe('2025-12');
    expect(monthsAfter('2026-11', 2)).toBe('2027-01');
  });

  it('lists this month first, back so many', () => {
    const list = recountMonths('2026-10', 24);
    expect(list[0]).toBe('2026-10');
    expect(list[1]).toBe('2026-09');
    expect(list).toHaveLength(25);
  });

  it('tells a range that is not allowed', () => {
    expect(recountRangeProblem('2026-08', '2026-10', '2026-10')).toBeNull();
    expect(recountRangeProblem('2025-11', '2026-10', '2026-10')).toBeNull();
    expect(recountRangeProblem('2025-10', '2026-10', '2026-10')).toContain('at most 12');
    expect(recountRangeProblem('2026-10', '2026-09', '2026-10')).toContain('can’t be after');
    expect(recountRangeProblem('2026-09', '2026-11', '2026-10')).toContain('up to this month');
    expect(recountRangeProblem('', '2026-10', '2026-10')).toContain('Choose');
  });
});

describe('what the preview and the result say', () => {
  it('lists the months left as they are with their payroll', () => {
    expect(skippedText([{ month: '2026-09', status: 'approved' }, { month: '2026-08', status: 'pending_ceo' }])).toBe('September 2026 (approved), August 2026 (with the CEO)');
  });

  it('says the preview', () => {
    expect(previewText(view)).toBe('412 days in 2 months for 57 people: 57 days would change (401:30 → 418:15 hours). Months skipped: August 2026 (paid).');
    expect(previewText({ ...view, daysChanged: 0, skipped: [], days: 1, months: ['2026-10'], people: 1 })).toBe('1 day in 1 month for 1 person: nothing would change.');
  });

  it('says the result as the owner asked', () => {
    expect(resultText(view)).toBe('Recounted 412 days (57 changed: 401:30 → 418:15 hours), 23 draft lines refilled. Skipped: August 2026 (paid).');
    expect(resultText({ ...view, daysChanged: 0, linesRefilled: 0, skipped: [] })).toBe('Recounted 412 days (none changed), 0 draft lines refilled.');
  });
});
