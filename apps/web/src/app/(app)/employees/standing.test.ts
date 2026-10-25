import { describe, expect, it } from 'vitest';
import { STANDINGS } from '@trendlix/shared';
import type { EmployeeProfile, Employment } from '../../../lib/types';
import { reportStanding, STANDING_STYLE, standingOf, STATUS_STYLE, trainingStanding } from './standing';

// Interns labelled as such rather than Probation (owner, 19 October 2026); the paid trainee gone (25 October 2026).

type Profile = Pick<EmployeeProfile, 'employment' | 'employments'>;
const employment = (status: Employment['status'], employmentType: Employment['employmentType']) => ({ status, employmentType }) as Employment;
const profile = (e: Employment | null, past = 0): Profile => ({ employment: e, employments: [...(e ? [e] : []), ...Array.from({ length: past }, () => ({}) as Employment)] });

describe('the standing badge’s colours', () => {
  it('has colours for every standing, Intern apart from Active and Probation', () => {
    for (const s of STANDINGS) expect(typeof STANDING_STYLE[s]).toBe('string');
    expect(STANDINGS).not.toContain('trainee');
    expect(STANDING_STYLE.intern).not.toBe(STANDING_STYLE.active);
    expect(STANDING_STYLE.intern).not.toBe(STANDING_STYLE.probation);
    expect(STANDING_STYLE.active).toBe(STATUS_STYLE.active);
    expect(STANDING_STYLE.on_leave).toBe(STATUS_STYLE.on_leave);
  });
});

describe('standingOf', () => {
  it('is Intern for an intern’s Active, or an older Probation', () => {
    expect(standingOf(profile(employment('active', 'intern')))).toBe('intern');
    expect(standingOf(profile(employment('probation', 'intern')))).toBe('intern');
  });

  it('keeps On leave and Notice period, and the others’ status', () => {
    expect(standingOf(profile(employment('on_leave', 'intern')))).toBe('on_leave');
    expect(standingOf(profile(employment('notice_period', 'intern')))).toBe('notice_period');
    expect(standingOf(profile(employment('probation', 'full_time')))).toBe('probation');
    expect(standingOf(profile(employment('active', 'freelance')))).toBe('active');
  });

  it('is Former employee or Not employed yet without a current employment', () => {
    expect(standingOf(profile(null, 1))).toBe('former');
    expect(standingOf(profile(null))).toBe('not_employed');
  });
});

describe('trainingStanding', () => {
  it('shows an intern’s status as Intern, and nothing for anyone else (a trainee is no type of its own any more)', () => {
    expect(trainingStanding('active', 'intern')).toBe('intern');
    expect(trainingStanding('probation', 'intern')).toBe('intern');
    expect(trainingStanding('active', 'trainee')).toBeNull();
    expect(trainingStanding('on_leave', 'intern')).toBeNull();
    expect(trainingStanding('active', 'full_time')).toBeNull();
    expect(trainingStanding('active', undefined)).toBeNull();
    expect(trainingStanding('resigned', 'intern')).toBeNull();
  });
});

describe('reportStanding', () => {
  it('takes a direct report’s standing from the API, else their status', () => {
    expect(reportStanding({ status: 'active', standing: 'intern' })).toBe('intern');
    expect(reportStanding({ status: 'probation', standing: 'intern' })).toBe('intern');
    // an older API
    expect(reportStanding({ status: 'on_leave' })).toBe('on_leave');
    expect(reportStanding({ status: 'terminated' })).toBe('former');
  });
});
