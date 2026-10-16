import { describe, expect, it } from 'vitest';
import { advanceTotals } from './advances';

// The employee's advances and loans on the Salary sub-tab (owner, 17 October 2026). Every figure is invented.

describe('advanceTotals', () => {
  it('adds what was given, and what is outstanding on the open ones only', () => {
    expect(
      advanceTotals([
        { amount: 6000, outstanding: 4000.5, status: 'open' },
        { amount: 500, outstanding: 0, status: 'settled' },
        // settled by HR with something left (paid back in cash): nothing outstanding any more
        { amount: 1000, outstanding: 300, status: 'settled' },
      ]),
    ).toEqual({ amount: 7500, outstanding: 4000.5, open: 1 });
    expect(advanceTotals([])).toEqual({ amount: 0, outstanding: 0, open: 0 });
  });
});
