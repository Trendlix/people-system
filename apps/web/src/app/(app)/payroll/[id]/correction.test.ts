import { EMPTY_PAYROLL_INPUTS, type PayrollTerms } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { PayrollLineView } from '../../../../lib/types';
import { CORRECTION_FIELDS, correctionHint, correctionOf, correctionStart, correctionText } from './correction';

// Correcting an approved line (owner, 5 November 2026: "if there was a problem in the employee calculation and has been
// edited"; asked, "Payslip and register too"). Every name is invented.

type Line = Pick<PayrollLineView, 'inputs' | 'terms' | 'attendanceImport'>;
const line = (inputs: Partial<typeof EMPTY_PAYROLL_INPUTS> = {}, more: Partial<Line> = {}): Line => ({
  inputs: { ...EMPTY_PAYROLL_INPUTS, ...inputs },
  terms: { leave: { paidDays: 2, unpaidDays: 0 }, permissionHours: null } as unknown as PayrollTerms,
  attendanceImport: null,
  ...more,
});

describe('correcting an approved line', () => {
  it('offers the figures the draft’s grid types, never the expected hours', () => {
    expect(CORRECTION_FIELDS.map((c) => c.field)).toEqual(['workedHours', 'permissionHours', 'noShowDays', 'leaveDays', 'unpaidLeaveDays', 'released']);
  });

  it('starts each figure as the line has it, as the grid shows it', () => {
    expect(correctionStart(line({ workedHours: 150.5, noShowDays: 1, released: 1500 }))).toMatchObject({
      workedHours: '150:30',
      noShowDays: '1',
      leaveDays: '',
      released: '1500.00',
    });
  });

  it('says where an empty figure comes from, and that a correction replaces an imported one', () => {
    const leaveDays = CORRECTION_FIELDS.find((c) => c.field === 'leaveDays')!;
    const worked = CORRECTION_FIELDS.find((c) => c.field === 'workedHours')!;
    expect(correctionHint(line(), leaveDays)).toBe('Empty: 2 from leave');
    expect(correctionHint(line({ leaveDays: 1 }), leaveDays)).toBeNull();
    const imported = line({ workedHours: 160 }, { attendanceImport: { source: 'zoho', at: '2026-11-01T10:00:00Z', fields: ['workedHours'] } as unknown as Line['attendanceImport'] });
    expect(correctionHint(imported, worked)).toBe('from Zoho: a correction here replaces it');
  });

  it('sends only the figures changed (an emptied one as none), with why; refuses what the grid refuses', () => {
    const l = line({ workedHours: 150, noShowDays: 1 });
    const typed = { ...correctionStart(l), workedHours: '160:00', noShowDays: '' };
    expect(correctionOf(l, typed, '  Overtime missed  ')).toEqual({ ok: true, inputs: { workedHours: 160, noShowDays: null }, reason: 'Overtime missed' });
    expect(correctionOf(l, correctionStart(l), 'Nothing really')).toEqual({ ok: false, errors: ['Change at least one figure to correct the line.'] });
    expect(correctionOf(l, typed, ' ')).toEqual({ ok: false, errors: ['Write why the line is corrected.'] });
    const bad = correctionOf(l, { ...typed, noShowDays: '1.3' }, 'Days');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors[0]).toMatch(/^No-show days: Type the days/);
    expect(correctionOf(l, typed, 'x'.repeat(501))).toEqual({ ok: false, errors: ['Keep the reason to 500 characters or fewer.'] });
  });

  it('says a correction under its line', () => {
    expect(correctionText({ at: '2026-11-05T12:00:00Z', by: 'Sara Ali', reason: 'Overtime missed', transferFrom: 9000, transferTo: 10000 })).toBe(
      'Corrected 05/11/2026 by Sara Ali: Overtime missed · transfer EGP 9,000.00 → EGP 10,000.00',
    );
    expect(correctionText({ at: '2026-11-05T12:00:00Z', by: null, reason: 'Fix', transferFrom: 1, transferTo: 2 })).toBe('Corrected 05/11/2026: Fix · transfer EGP 1.00 → EGP 2.00');
  });
});
