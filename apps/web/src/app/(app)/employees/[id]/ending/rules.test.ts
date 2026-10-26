import { describe, expect, it } from 'vitest';
import { ENDING_RULE_DEFAULTS, ENDING_RULES } from '@trendlix/shared';
import type { EndingRule } from '../../../../../lib/types';
import { agreedLastDayHint, agreedLastDayProblem, endingRulesFor, lastDayText, trainingLastDay } from './rules';

// Training completed for interns (owner, 19 October 2026), the others as before; the paid trainee went on 25 October 2026.

const rules: EndingRule[] = ENDING_RULES.map((key) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true }));
const keys = (list: EndingRule[]) => list.map((r) => r.key);

describe('the ways of ending an employment offered', () => {
  it('offers an intern Training completed, never Non-renewal or Probation', () => {
    for (const status of ['active', 'probation']) {
      const offered = keys(endingRulesFor(rules, { status, employmentType: 'intern' }, true));
      expect(offered).toContain('training_completed');
      expect(offered).not.toContain('non_renewal');
      expect(offered).not.toContain('probation');
      expect(offered).toContain('resignation');
    }
  });

  it('never offers anyone else Training completed, and the others as before', () => {
    const fixedTerm = keys(endingRulesFor(rules, { status: 'probation', employmentType: 'full_time' }, true));
    expect(fixedTerm).not.toContain('training_completed');
    expect(fixedTerm).toContain('non_renewal');
    expect(fixedTerm).toContain('probation');
    const openEnded = keys(endingRulesFor(rules, { status: 'active', employmentType: 'part_time' }, false));
    expect(openEnded).not.toContain('non_renewal');
    expect(openEnded).not.toContain('probation');
    expect(openEnded).not.toContain('training_completed');
  });

  it('leaves out the rules turned off', () => {
    const off = rules.map((r) => (r.key === 'training_completed' ? { ...r, active: false } : r));
    expect(keys(endingRulesFor(off, { status: 'active', employmentType: 'intern' }, true))).not.toContain('training_completed');
  });
});

describe('Training completed’s last working day', () => {
  it('is the agreement’s end date, or the day recorded when that is after it', () => {
    expect(trainingLastDay('2027-03-31', '2027-03-20')).toBe('2027-03-31');
    expect(trainingLastDay('2027-03-31', '2027-03-31')).toBe('2027-03-31');
    expect(trainingLastDay('2027-03-31', '2027-04-05')).toBe('2027-04-05');
    expect(trainingLastDay('2027-03-31', null)).toBe('2027-03-31');
  });
});

// "let me add agreed on last working date only by admin and HR" (owner, 26 October 2026)
const show = (ymd: string) => ymd.split('-').reverse().join('/');

describe('the last working day shown', () => {
  it('is the day alone unless it was agreed', () => {
    expect(lastDayText({ lastWorkingDay: '2027-01-26', noticeEndsOn: '2027-01-26', lastDayAgreed: false }, show)).toBe('26/01/2027');
    expect(lastDayText({ lastWorkingDay: '2027-01-26' }, show)).toBe('26/01/2027');
  });

  it('shows both days when agreed', () => {
    expect(lastDayText({ lastWorkingDay: '2026-11-30', noticeEndsOn: '2027-01-26', lastDayAgreed: true }, show)).toBe(
      'Notice ends 26/01/2027 · agreed last working day 30/11/2026',
    );
    expect(lastDayText({ lastWorkingDay: '2026-11-30', noticeEndsOn: null, lastDayAgreed: true }, show)).toBe('Agreed last working day 30/11/2026');
  });
});

describe('the agreed last working day field', () => {
  it('hints at the notice’s day', () => {
    expect(agreedLastDayHint('2027-01-26', false, show)).toBe(
      'Leave it empty to use the notice: 26/01/2027. Set it when you agreed a different last day with them.',
    );
    expect(agreedLastDayHint('2027-01-26', true, show)).toContain('about 26/01/2027');
    expect(agreedLastDayHint(null, false, show)).toBe('Leave it empty to use the notice. Set it when you agreed a different last day with them.');
  });

  it('refuses a day before the notice day, and nothing while empty', () => {
    expect(agreedLastDayProblem('2026-09-30', '2026-10-01', show)).toBe('The agreed last working day must be on or after the notice date, 01/10/2026.');
    expect(agreedLastDayProblem('2026-10-01', '2026-10-01', show)).toBeNull();
    expect(agreedLastDayProblem('2027-03-01', '2026-10-01', show)).toBeNull();
    expect(agreedLastDayProblem(null, '2026-10-01', show)).toBeNull();
    expect(agreedLastDayProblem('2026-09-30', null, show)).toBeNull();
  });
});
