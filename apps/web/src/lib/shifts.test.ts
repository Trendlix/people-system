import { describe, expect, it } from 'vitest';
import { HOURS_TO_WORK_ERROR, hoursADayText, hoursToWorkFrom, hoursToWorkShown, shiftHint, shiftTimesText, typedShiftHint } from './shifts';

// A shift's window and its hours to work a day (owner, 16 October 2026, on the MORNING shift of 9:00 AM to 7:00 PM:
// "my company shift is to maintain 9 hours within the shift window, its like flexible shift").

const morning = { startTime: '09:00', endTime: '19:00', graceMinutes: 15 };

describe('the hours to work a day as typed', () => {
  it('reads hours as 9, 9:00, 8:30 or 8.5, Arabic digits too; empty is the whole window', () => {
    expect(['9', '9:00', ' 9:00 ', '٩', '٩:٠٠'].map(hoursToWorkFrom)).toEqual([9, 9, 9, 9, 9]);
    expect(['8:30', '8.5', '٨٫٥', '0:30', '24'].map(hoursToWorkFrom)).toEqual([8.5, 8.5, 8.5, 0.5, 24]);
    expect(hoursToWorkFrom('')).toBeNull();
    expect(hoursToWorkFrom('  ')).toBeNull();
  });

  it('takes half hours only, from 0:30 to 24:00', () => {
    for (const typed of ['8:20', '8.25', '0', '0:15', '24:30', '25', 'nine', '9h', '-9']) expect(hoursToWorkFrom(typed)).toBeNaN();
  });

  it('shows them back as hours and minutes, empty when not set', () => {
    expect([hoursToWorkShown(9), hoursToWorkShown(8.5), hoursToWorkShown(null), hoursToWorkShown(undefined)]).toEqual(['9:00', '8:30', '', '']);
  });
});

describe('a shift as the screens say it', () => {
  it('its times and hours a day, flexible when fewer than the window', () => {
    expect(shiftTimesText({ ...morning, hoursPerDay: 9 })).toBe('9:00 AM – 7:00 PM · 9:00 hours, flexible');
    expect(shiftTimesText({ startTime: '09:00', endTime: '18:00', hoursPerDay: null })).toBe('9:00 AM – 6:00 PM · 9:00 hours');
    expect(shiftTimesText({ startTime: '09:00', endTime: '18:00' })).toBe('9:00 AM – 6:00 PM · 9:00 hours');
    // the times alone when the hours can't be told
    expect(shiftTimesText({ startTime: '09:00', endTime: '09:00' })).toBe('9:00 AM – 9:00 AM');
    expect([hoursADayText({ ...morning, hoursPerDay: 8.5 }), hoursADayText({ startTime: '09:00', endTime: '09:00' })]).toEqual(['8:30 a day', '—']);
  });
});

describe('the shift form’s hint', () => {
  it('a fixed shift: check-in after the start plus the grace minutes is late', () => {
    expect(shiftHint({ ...morning, hoursPerDay: null })).toEqual({ problem: false, text: 'Check-in after 9:15 AM counts as late.' });
    expect(shiftHint({ ...morning, hoursPerDay: 10 }).text).toBe('Check-in after 9:15 AM counts as late.');
  });

  it('a flexible shift: its hours anywhere in the window, and the latest check-in that leaves them (the end less the hours, plus the grace)', () => {
    expect(shiftHint({ ...morning, hoursPerDay: 9 })).toEqual({
      problem: false,
      text: 'Flexible: 9:00 hours anywhere between 9:00 AM and 7:00 PM. Check-in after 10:15 AM leaves too little of the window to work them.',
    });
    expect(shiftHint({ ...morning, graceMinutes: 0, hoursPerDay: 7.5 }).text).toBe(
      'Flexible: 7:30 hours anywhere between 9:00 AM and 7:00 PM. Check-in after 11:30 AM leaves too little of the window to work them.',
    );
    // past midnight: 10:00 PM to 6:00 AM, 7 hours: the latest check-in 11:15 PM
    expect(shiftHint({ startTime: '22:00', endTime: '06:00', graceMinutes: 15, hoursPerDay: 7 }).text).toContain('Check-in after 11:15 PM');
  });

  it('says when the hours are more than the window, and the general rule while the times can’t be read', () => {
    expect(shiftHint({ ...morning, hoursPerDay: 10.5 })).toEqual({ problem: true, text: "The hours to work can't be more than the shift's window, 10:00." });
    expect(shiftHint({ startTime: null, endTime: '19:00', graceMinutes: 15, hoursPerDay: 9 }).text).toBe('Check-in after the start time plus the grace minutes counts as late.');
  });

  it('follows what is typed on the form', () => {
    const typed = { startTime: '9:00 AM', endTime: '7:00 PM', graceMinutes: '15', hoursPerDay: '9:00' };
    expect(typedShiftHint(typed).text).toBe('Flexible: 9:00 hours anywhere between 9:00 AM and 7:00 PM. Check-in after 10:15 AM leaves too little of the window to work them.');
    expect(typedShiftHint({ ...typed, hoursPerDay: '' }).text).toBe('Check-in after 9:15 AM counts as late.');
    expect(typedShiftHint({ ...typed, graceMinutes: '' }).text).toContain('Check-in after 10:00 AM');
    expect(typedShiftHint({ ...typed, hoursPerDay: '8:20' })).toEqual({ problem: true, text: HOURS_TO_WORK_ERROR });
    expect(typedShiftHint({ ...typed, endTime: '7' }).text).toBe('Check-in after the start time plus the grace minutes counts as late.');
  });
});
