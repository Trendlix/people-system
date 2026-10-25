import { describe, expect, it } from 'vitest';
import { COVERING_HREF, coverDaysText, coveringCountText, coveringLine, coveringToCome, coverStateText, coverWhenText } from './covering';

// "I'm Covering" (owner, 25 October 2026: "Required over 2 days", "Names, no leave types"): the words of the leave a
// colleague named someone to cover, never its type.

const omar = { requestId: 'r1', employee: { id: 'e1', fullNameEn: 'Omar Khaled' }, startDate: '2026-11-12', endDate: '2026-11-14', halfDay: false, waiting: false, handoverNote: null };

describe('I’m covering', () => {
  it('says whom and on which days, one day and a half day too', () => {
    expect(coverDaysText(omar)).toBe('12/11/2026–14/11/2026');
    expect(coverDaysText({ ...omar, endDate: '2026-11-12' })).toBe('12/11/2026');
    expect(coverDaysText({ ...omar, endDate: '2026-11-12', halfDay: true })).toBe('12/11/2026 (half day)');
    expect(coveringLine(omar)).toBe('You’re covering Omar Khaled on 12/11/2026–14/11/2026.');
  });

  it('says whether the leave is approved or still waiting, never its type', () => {
    expect(coverStateText(omar)).toBe('Approved');
    expect(coverStateText({ waiting: true })).toBe('Waiting for approval');
    expect(coveringLine(omar)).not.toMatch(/annual|sick|casual/i);
  });

  it('says when, from today', () => {
    expect(coverWhenText(omar, '2026-11-11')).toBe('Starts tomorrow');
    expect(coverWhenText(omar, '2026-11-02')).toBe('Starts in 10 days');
    expect(coverWhenText(omar, '2026-11-12')).toBe('Now, until 14/11/2026');
    expect(coverWhenText(omar, '2026-11-14')).toBe('Now, until 14/11/2026');
    expect(coverWhenText({ ...omar, endDate: '2026-11-12' }, '2026-11-12')).toBe('Today');
    expect(coverWhenText(omar, '2026-11-15')).toBe('Ended');
    // across a month's end
    expect(coverWhenText({ ...omar, startDate: '2026-12-02', endDate: '2026-12-03' }, '2026-11-30')).toBe('Starts in 2 days');
  });

  it('lists those current or to come, the nearest first', () => {
    const later = { ...omar, requestId: 'r2', startDate: '2026-12-01', endDate: '2026-12-02' };
    const over = { ...omar, requestId: 'r3', startDate: '2026-10-01', endDate: '2026-10-02' };
    expect(coveringToCome([later, over, omar], '2026-11-12').map((a) => a.requestId)).toEqual(['r1', 'r2']);
    expect(coveringToCome([], '2026-11-12')).toEqual([]);
  });

  it('counts them, and opens on My Requests', () => {
    expect(coveringCountText(1)).toBe('1 colleague’s leave');
    expect(coveringCountText(3)).toBe('3 colleagues’ leave');
    expect(COVERING_HREF).toBe('/my-requests#covering');
  });
});
