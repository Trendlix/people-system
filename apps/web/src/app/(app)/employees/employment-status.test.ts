import { describe, expect, it } from 'vitest';
import { isChosenStatus, statusField } from './employment-status';

describe('the employment’s status field', () => {
  it('is set by the system for a new employment', () => {
    expect(statusField()).toEqual({ kind: 'shown', value: 'Set by the system', hint: 'Probation until the probation end (Active for a rehire).' });
  });

  it('offers only Active and On leave while the employment is one of them', () => {
    for (const status of ['active', 'on_leave'] as const) {
      expect(statusField({ status, endDate: null })).toEqual({ kind: 'choose', options: ['active', 'on_leave'] });
    }
  });

  it('shows Probation and Notice period read-only, with what changes them', () => {
    expect(statusField({ status: 'probation', endDate: null })).toEqual({
      kind: 'shown',
      value: 'Probation',
      hint: 'Set by the system: it becomes Active with Confirm probation on the Employment tab.',
    });
    expect(statusField({ status: 'notice_period', endDate: null })).toEqual({
      kind: 'shown',
      value: 'Notice period',
      hint: 'Set by the approved ending: it follows the ending.',
    });
  });

  it('follows why an ended employment ended', () => {
    const hint = 'Follows why the employment ended.';
    expect(statusField({ status: 'resigned', endDate: '2026-05-31' })).toEqual({ kind: 'shown', value: 'Resigned', hint });
    expect(statusField({ status: 'terminated', endDate: '2026-05-31' })).toEqual({ kind: 'shown', value: 'Terminated', hint });
  });

  it('knows which statuses HR chooses', () => {
    expect(['active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated', ''].filter(isChosenStatus)).toEqual(['active', 'on_leave']);
  });
});
