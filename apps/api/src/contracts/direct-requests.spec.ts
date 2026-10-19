import { directRequestFields, PREPARED_DIRECTLY_COMMENT, RAISE_REQUEST_HISTORY_STATUSES, RAISE_REQUEST_ORIGIN_LABELS } from '@trendlix/shared';
import { directStatusOf } from './direct-requests.js';
import { ceoReasonChange } from './raises.service.js';

// A raise HR prepares directly has its raise request (owner, 19 October 2026: "when a raise request was sent to the CEO,
// is showed in approvals not raise requests, and after approved, it was not shown in the raise request history too"),
// and the CEO may change the reason when approving ("i might want to ammend the raise reason, not only the money").

describe('a request prepared directly by HR, from its raise', () => {
  const raise = { raiseReason: 'annual', note: 'For the new year', grossSalary: 12500, startDate: '2026-11-01' };

  it('the raise’s reason, its note as the comment, the increase over the version before and the gross, from its date', () => {
    expect(directRequestFields(raise, 10000)).toEqual({
      raiseReason: 'annual',
      comment: 'For the new year',
      suggestedIncrease: 2500,
      suggestedPercent: null,
      suggestedGross: 12500,
      effectiveFrom: '2026-11-01',
    });
    // to the piaster
    expect(directRequestFields({ ...raise, grossSalary: 10750.55 }, 10000.25).suggestedIncrease).toBe(750.3);
  });

  it('without a note, says it was prepared directly by HR; the gross alone when it doesn’t go up', () => {
    expect(directRequestFields({ ...raise, note: null }, 10000).comment).toBe(PREPARED_DIRECTLY_COMMENT);
    expect(directRequestFields({ ...raise, note: '   ' }, 10000).comment).toBe('Prepared directly by HR');
    // an allowance changed, or a cut: no increase to suggest
    expect(directRequestFields({ ...raise, grossSalary: 10000 }, 10000)).toMatchObject({ suggestedIncrease: null, suggestedGross: 10000 });
    expect(directRequestFields({ ...raise, grossSalary: 9500 }, 10000)).toMatchObject({ suggestedIncrease: null, suggestedGross: 9500 });
    // a renewal from the day after the version before ends, and a reason kept from before (adjustment)
    expect(directRequestFields({ ...raise, raiseReason: 'adjustment', startDate: '2027-06-15' }, 10000)).toMatchObject({ raiseReason: 'adjustment', effectiveFrom: '2027-06-15' });
  });

  it('stands where its raise does, as an asked one would', () => {
    expect(directStatusOf('draft')).toBe('with_hr');
    expect(directStatusOf('pending_ceo')).toBe('with_ceo');
    expect(directStatusOf('approved')).toBe('approved');
    expect(directStatusOf(null)).toBe('with_hr');
  });

  it('says so, and the history is what the CEO approved, what is done and what was rejected', () => {
    expect(RAISE_REQUEST_ORIGIN_LABELS).toEqual({ request: 'Asked for', direct: 'Prepared directly by HR' });
    expect(RAISE_REQUEST_HISTORY_STATUSES).toEqual(['approved', 'done', 'declined']);
  });
});

describe('the CEO’s other reason when approving', () => {
  it('none when none is sent or it is the same', () => {
    expect(ceoReasonChange('performance', undefined)).toBeNull();
    expect(ceoReasonChange('performance', 'performance')).toBeNull();
    // adjustment, kept from before, may be sent back as it is
    expect(ceoReasonChange('adjustment', 'adjustment')).toBeNull();
  });

  it('from → to, one from the list only', () => {
    expect(ceoReasonChange('performance', 'annual')).toEqual({ from: 'performance', to: 'annual' });
    expect(ceoReasonChange('adjustment', 'market_adjustment')).toEqual({ from: 'adjustment', to: 'market_adjustment' });
    expect(() => ceoReasonChange('annual', 'adjustment')).toThrow(/Choose the reason from the list/);
  });
});
