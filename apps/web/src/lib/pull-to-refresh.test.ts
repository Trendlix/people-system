import { describe, expect, it } from 'vitest';
import { PULL_MAX, PULL_SLOP, PULL_TRIGGER, pullDistance, refreshes, touchKind } from './pull-to-refresh';

describe('a touch at the top of the page', () => {
  it('is undecided until the finger moves past the slop', () => {
    expect(touchKind(0, 0)).toBe('undecided');
    expect(touchKind(3, PULL_SLOP)).toBe('undecided');
    expect(touchKind(0, -2)).toBe('undecided');
  });

  it('is a pull once it goes clearly down', () => {
    expect(touchKind(0, PULL_SLOP + 1)).toBe('pull');
    expect(touchKind(8, 40)).toBe('pull');
    expect(touchKind(-8, 40)).toBe('pull');
  });

  it('is not ours once it goes up (the page scrolls) or sideways first (a row of chips, a swipe)', () => {
    expect(touchKind(0, -PULL_SLOP)).toBe('not-ours');
    expect(touchKind(PULL_SLOP + 1, 4)).toBe('not-ours');
    expect(touchKind(-30, 20)).toBe('not-ours');
  });

  it('stays undecided when it goes down and sideways alike', () => {
    expect(touchKind(9, 12)).toBe('undecided');
  });
});

describe('the circle and letting go', () => {
  it('doesn’t move within the slop, then follows the finger at a little more than half', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(PULL_SLOP)).toBe(0);
    expect(pullDistance(PULL_SLOP + 100)).toBe(55);
  });

  it('reaches the refresh at about 125 px of finger, then comes harder, never past the most', () => {
    expect(refreshes(pullDistance(120))).toBe(false);
    expect(refreshes(pullDistance(127))).toBe(true);
    expect(pullDistance(200)).toBeLessThan(PULL_MAX);
    expect(pullDistance(200)).toBeGreaterThan(PULL_TRIGGER);
    expect(pullDistance(2000)).toBe(PULL_MAX);
  });

  it('only refreshes from the trigger on', () => {
    expect(refreshes(PULL_TRIGGER - 0.1)).toBe(false);
    expect(refreshes(PULL_TRIGGER)).toBe(true);
  });
});
