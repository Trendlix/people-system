import { describe, expect, it } from 'vitest';
import { latestShown, nextCycleText, nextOpeningDay, ordinalDay, reviewSteps, ringShare } from './mine';

describe('the next scorecards', () => {
  it('open on the 1st of the next month', () => {
    expect(nextOpeningDay('2026-10-30')).toBe('2026-11-01');
    expect(nextOpeningDay('2026-12-15')).toBe('2027-01-01');
  });

  it('are a month away on the 1st itself, as that day’s opened already', () => {
    expect(nextOpeningDay('2026-11-01')).toBe('2026-12-01');
  });

  it('are worded as the design’s badge', () => {
    expect(nextCycleText('2026-10-30')).toBe('Next cycle · 01 November');
    expect(nextCycleText('2026-12-31')).toBe('Next cycle · 01 January');
  });
});

describe('ordinalDay', () => {
  it('words a day of the month', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 28].map(ordinalDay)).toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th']);
  });
});

describe('latestShown', () => {
  const card = (finalPercent: number | null, level: 'meets' | null) => ({ finalPercent, level });

  it('is the newest scorecard with its score shown', () => {
    const list = [card(null, null), card(92, 'meets'), card(95, 'meets')];
    expect(latestShown(list)).toBe(list[1]);
  });

  it('is null while none is shown', () => {
    expect(latestShown([card(null, null)])).toBeNull();
    expect(latestShown([])).toBeNull();
  });
});

describe('ringShare', () => {
  it('fills up to the 110% cap, as the bars', () => {
    expect(ringShare(55)).toBe(0.5);
    expect(ringShare(110)).toBe(1);
    expect(ringShare(130)).toBe(1);
    expect(ringShare(-5)).toBe(0);
  });
});

describe('reviewSteps', () => {
  it('are the four steps, each with the day it is due by', () => {
    const steps = reviewSteps({ selfRatingDay: 3, managerDay: 6, hrDay: 8, signOffDay: 10 });
    expect(steps.map((s) => s.title)).toEqual(['Self-rating', 'Manager’s scoring', 'HR calibration', 'Sign-off']);
    expect(steps.map((s) => s.due)).toEqual(['By the 3rd', 'By the 6th', 'By the 8th', 'By the 10th']);
  });

  it('leave the days out when the settings couldn’t be read', () => {
    expect(reviewSteps(null).every((s) => s.due === null)).toBe(true);
  });
});
