import { describe, expect, it } from 'vitest';
import { countsWords, hoursWords, isDay, myRecordsHref, recordsHref, recordWhere, recordWords } from './attendance-records';

// A day's attendance records on the website (owner, 31 October 2026: "is there a way to check the checkin records? even
// if imported from zoho and delete one of them?" — "as a super admin"; "zoho or system"). Cairo is UTC+3 on these days.

describe('a day’s records', () => {
  it('links from the month’s rows, the person’s and one’s own', () => {
    expect(recordsHref('e 1', '2026-10-20')).toBe('/attendance/e%201/records/2026-10-20');
    expect(myRecordsHref('2026-10-20')).toBe('/my-attendance/records/2026-10-20');
    expect([isDay('2026-10-20'), isDay('2026-13-01'), isDay('x')]).toEqual([true, false, false]);
  });

  it('says each record, where it was and its flags', () => {
    expect(recordWords({ kind: 'in', at: '2026-10-20T14:31:00.000Z' })).toBe('Check-in 5:31 PM');
    expect(recordWhere({ place: 'office', locationName: 'Studio', flags: ['fake_gps', 'nonsense'] })).toMatch(/^Office · Studio · /);
    expect(recordWhere({ place: null, locationName: null, flags: [] })).toBeNull();
  });

  it('says which records the day uses: a correction, the one chosen, the usual order', () => {
    expect(countsWords({ counts: 'correction', chosen: null, usual: 'system' })).toBe('An approved correction counts for this day, over its records.');
    expect(countsWords({ counts: 'system', chosen: null, usual: 'system' })).toBe('Checked in on the system counts for this day: the system’s check-ins come before Zoho’s.');
    expect(countsWords({ counts: 'zoho', chosen: { source: 'zoho', reason: 'The reader missed the day', by: 'Mona', at: '2026-10-31T10:00:00.000Z' }, usual: 'system' })).toBe(
      'Zoho People counts for this day: chosen by Mona, “The reader missed the day”.',
    );
    expect(countsWords({ counts: null, chosen: null, usual: null })).toBe('No records kept for this day.');
    expect([hoursWords(8.5), hoursWords(0.35), hoursWords(null)]).toEqual(['8:30', '0:21', null]);
  });
});
