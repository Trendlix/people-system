import { describe, expect, it } from 'vitest';
import { ENDING_RULE_DEFAULTS, ENDING_RULES } from '@trendlix/shared';
import type { EndingRule } from '../../../../../lib/types';
import { endingRulesFor, trainingLastDay } from './rules';

// Training completed for trainees and interns (owner, 19 October 2026), the others as before.

const rules: EndingRule[] = ENDING_RULES.map((key) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true }));
const keys = (list: EndingRule[]) => list.map((r) => r.key);

describe('the ways of ending an employment offered', () => {
  it('offers a trainee or an intern Training completed, never Non-renewal or Probation', () => {
    for (const employmentType of ['trainee', 'intern']) {
      for (const status of ['active', 'probation']) {
        const offered = keys(endingRulesFor(rules, { status, employmentType }, true));
        expect(offered).toContain('training_completed');
        expect(offered).not.toContain('non_renewal');
        expect(offered).not.toContain('probation');
        expect(offered).toContain('resignation');
      }
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
