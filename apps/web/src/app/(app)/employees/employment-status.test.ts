import { describe, expect, it } from 'vitest';
import { isChosenStatus, statusField } from './employment-status';

describe('the employment’s status field', () => {
  it('is set by the system for a new employment', () => {
    expect(statusField()).toEqual({ kind: 'shown', value: 'Set by the system' });
  });

  it('offers only Active and On leave while the employment is one of them', () => {
    for (const status of ['active', 'on_leave'] as const) {
      expect(statusField({ status, endDate: null })).toEqual({ kind: 'choose', options: ['active', 'on_leave'] });
    }
  });

  it('shows Probation and Notice period read-only', () => {
    expect(statusField({ status: 'probation', endDate: null })).toEqual({ kind: 'shown', value: 'Probation' });
    expect(statusField({ status: 'notice_period', endDate: null })).toEqual({ kind: 'shown', value: 'Notice period' });
  });

  it('follows why an ended employment ended', () => {
    expect(statusField({ status: 'resigned', endDate: '2026-05-31' })).toEqual({ kind: 'shown', value: 'Resigned' });
    expect(statusField({ status: 'terminated', endDate: '2026-05-31' })).toEqual({ kind: 'shown', value: 'Terminated' });
    // an ended employment's status is never chosen, even one that ended on leave
    expect(statusField({ status: 'on_leave', endDate: '2026-05-31' })).toEqual({ kind: 'shown', value: 'On leave' });
  });

  it('knows which statuses HR chooses', () => {
    expect(['active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated', ''].filter(isChosenStatus)).toEqual(['active', 'on_leave']);
  });
});
