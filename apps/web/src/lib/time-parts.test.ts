import { describe, expect, it } from 'vitest';
import { parseTime } from './format';
import { HOURS, minuteOptions, NO_TIME, noneChosen, QUARTERS, timeParts, timeText, type TimeParts } from './time-parts';

const parts = (hour: string, minute: string, period: TimeParts['period']): TimeParts => ({ hour, minute, period });

describe('a time in three parts', () => {
  it('offers the hours 1 to 12, the quarter hours, AM and PM', () => {
    expect(HOURS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(QUARTERS).toEqual(['00', '15', '30', '45']);
  });

  it('writes the field as the forms read it, "h:mm AM"', () => {
    expect(timeText(parts('5', '00', 'PM'))).toBe('5:00 PM');
    expect(timeText(parts('9', '30', 'AM'))).toBe('9:30 AM');
    expect(parseTime(timeText(parts('5', '00', 'PM')))).toBe('17:00');
    expect(parseTime(timeText(parts('9', '45', 'AM')))).toBe('09:45');
  });

  it('reads a time back into its parts', () => {
    expect(timeParts('5:00 PM')).toEqual(parts('5', '00', 'PM'));
    expect(timeParts('9:30 AM')).toEqual(parts('9', '30', 'AM'));
    // as parseTime reads them: 24-hour, without a space, in lower case, with Arabic digits
    expect(timeParts('17:15')).toEqual(parts('5', '15', 'PM'));
    expect(timeParts('5pm')).toEqual(parts('5', '00', 'PM'));
    expect(timeParts('٩:٠٠ am')).toEqual(parts('9', '00', 'AM'));
  });

  it('keeps 12 AM as midnight and 12 PM as noon', () => {
    expect(timeParts('12:00 AM')).toEqual(parts('12', '00', 'AM'));
    expect(timeParts('00:30')).toEqual(parts('12', '30', 'AM'));
    expect(timeParts('12:15 PM')).toEqual(parts('12', '15', 'PM'));
    expect(timeParts('12:00')).toEqual(parts('12', '00', 'PM'));
    expect(parseTime(timeText(parts('12', '00', 'AM')))).toBe('00:00');
    expect(parseTime(timeText(parts('12', '45', 'PM')))).toBe('12:45');
    expect(timeParts('11:45 PM')).toEqual(parts('11', '45', 'PM'));
    expect(timeParts('1:00 AM')).toEqual(parts('1', '00', 'AM'));
  });

  it('keeps a minute off the quarter hours as it is', () => {
    expect(timeParts('9:07 AM')).toEqual(parts('9', '07', 'AM'));
    expect(timeText(timeParts('9:10 AM'))).toBe('9:10 AM');
    expect(minuteOptions('07')).toEqual(['00', '07', '15', '30', '45']);
    expect(minuteOptions('10', '50')).toEqual(['00', '10', '15', '30', '45', '50']);
    // a quarter hour, or none, adds nothing
    expect(minuteOptions('30', '')).toEqual(['00', '15', '30', '45']);
    expect(minuteOptions()).toEqual(['00', '15', '30', '45']);
  });

  it('has nothing chosen for an empty field, or one that can’t be read', () => {
    expect(timeParts('')).toEqual(NO_TIME);
    expect(timeParts('   ')).toEqual(NO_TIME);
    expect(timeParts('soon')).toEqual(NO_TIME);
    expect(timeParts('25:00')).toEqual(NO_TIME);
    expect(timeText(NO_TIME)).toBe('');
    expect(noneChosen(NO_TIME)).toBe(true);
    expect(noneChosen(parts('5', '', ''))).toBe(false);
  });

  it('writes a time partly chosen as one the forms refuse, and reads it back', () => {
    expect(timeText(parts('5', '', 'PM'))).toBe('5:-- PM');
    expect(timeText(parts('', '30', ''))).toBe('--:30 --');
    expect(timeText(parts('9', '15', ''))).toBe('9:15 --');
    for (const text of ['5:-- PM', '--:30 --', '9:15 --', '--:-- AM']) {
      // the forms' checks and actions say a time is missing, as for a badly typed one
      expect(parseTime(text)).toBeNull();
      expect(timeText(timeParts(text))).toBe(text);
    }
    expect(timeParts('5:-- PM')).toEqual(parts('5', '', 'PM'));
    expect(timeParts('--:07 --')).toEqual(parts('', '07', ''));
  });
});
