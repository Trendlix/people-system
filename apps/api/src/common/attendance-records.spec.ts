import {
  dropsForChoice,
  monthDays,
  recordLockRefusal,
  recordReasonProblem,
  removedText,
  withoutRemovedPresses,
  zohoDayFromPresses,
  zohoDayPresses,
  type AttendanceSource,
  type ImportedDay,
} from '@trendlix/shared';

// A person's attendance records put right by a Super Admin (owner, 31 October 2026: "is there a way to check the checkin
// records? even if imported from zoho and delete one of them?" — "as a super admin"; "Stays removed", "Block locked
// months"; "zoho or system"): packages/shared attendance-records.ts. Cairo is UTC+3 on these days; every day invented.

const iso = (time: string, date = '2026-10-18') => new Date(`${date}T${time}:00+03:00`).toISOString();
const fetched: ImportedDay = {
  date: '2026-10-18',
  checkIn: iso('08:58'),
  checkOut: iso('17:00'),
  place: 'office',
  zohoStatus: 'Present',
  permissionHours: 0,
  pairs: [
    { in: iso('08:58'), out: iso('14:58') },
    { in: iso('15:00'), out: iso('17:00') },
  ],
};

describe('a Zoho day’s records', () => {
  it('are its pairs’ check-ins and check-outs and an open last check-in, else its first check-in and last check-out', () => {
    expect(zohoDayPresses({ ...fetched, openAt: iso('17:30') }).map((p) => `${p.kind} ${p.at}`)).toEqual([
      `in ${iso('08:58')}`,
      `out ${iso('14:58')}`,
      `in ${iso('15:00')}`,
      `out ${iso('17:00')}`,
      `in ${iso('17:30')}`,
    ]);
    expect(zohoDayPresses({ checkIn: iso('09:00'), checkOut: iso('18:00'), pairs: null })).toEqual([
      { kind: 'in', at: iso('09:00') },
      { kind: 'out', at: iso('18:00') },
    ]);
  });

  it('are worked out again without one removed: the pairs, the first check-in and last check-out follow', () => {
    // the 2:58 PM check-out removed: one pair 8:58 AM to 5:00 PM
    const out = withoutRemovedPresses(fetched, null, [{ kind: 'out', at: iso('14:58') }]);
    expect(out.day.pairs).toEqual([{ in: iso('08:58'), out: iso('17:00') }]);
    expect([out.day.checkIn, out.day.checkOut, out.openAt]).toEqual([iso('08:58'), iso('17:00'), null]);
    // the last check-out removed: the 3:00 PM check-in left open
    const open = withoutRemovedPresses(fetched, null, [{ kind: 'out', at: iso('17:00') }]);
    expect(open.day.pairs).toEqual([{ in: iso('08:58'), out: iso('14:58') }]);
    expect([open.day.checkOut, open.openAt]).toEqual([iso('14:58'), iso('15:00')]);
    // nothing removed, or a record not on the day: as it was
    expect(withoutRemovedPresses(fetched, null, [])).toEqual({ day: fetched, openAt: null });
    expect(withoutRemovedPresses(fetched, null, [{ kind: 'in', at: iso('07:00') }]).day.pairs).toEqual(fetched.pairs);
  });

  it('keeps an Excel import’s day by its first check-in and last check-out', () => {
    const excel: ImportedDay = { ...fetched, pairs: null };
    expect(withoutRemovedPresses(excel, null, [{ kind: 'in', at: iso('08:58') }]).day).toMatchObject({ checkIn: null, checkOut: iso('17:00'), pairs: null });
  });

  it('come back on Restore from the records as they were: the pairs after a removal can hide one', () => {
    const original = zohoDayPresses(fetched);
    const without = withoutRemovedPresses(fetched, null, [{ kind: 'out', at: iso('14:58') }]);
    // the 3:00 PM check-in isn't in the pairs kept any more (a check-in while checked in starts nothing)
    expect(zohoDayPresses(without.day).map((p) => p.at)).not.toContain(iso('15:00'));
    expect(zohoDayFromPresses(without.day, original, true).day.pairs).toEqual(fetched.pairs);
  });
});

describe('the source a day uses', () => {
  it('leaves the other source’s day out, never a correction', () => {
    expect(['system', 'device', 'zoho', 'correction'].filter((s) => dropsForChoice(s, 'zoho'))).toEqual(['system', 'device']);
    expect(['system', 'device', 'zoho', 'correction'].filter((s) => dropsForChoice(s, 'system'))).toEqual(['zoho']);
    expect(dropsForChoice('zoho', null)).toBe(false);
  });

  it('takes Zoho’s day over the system’s on the day chosen, the usual order on the others', () => {
    const row = (date: string, source: AttendanceSource, hours: number) => ({ date, source, status: 'worked' as const, checkIn: iso('09:00', date), checkOut: null, place: 'office' as const, zohoStatus: null, permissionHours: 0, hoursCounted: hours, flags: [] });
    const rows = [row('2026-10-18', 'zoho', 8), row('2026-10-18', 'system', 0.35), row('2026-10-19', 'zoho', 9), row('2026-10-19', 'system', 9.2)];
    const ctx = { month: '2026-10', today: '2026-10-31', checkInFrom: null, workingDays: null, holidays: [], leaveDays: [], employedFrom: null, employedTo: null };
    expect(monthDays(rows, ctx).map((d) => `${d.date} ${d.source}`)).toEqual(['2026-10-18 system', '2026-10-19 system']);
    expect(monthDays(rows, { ...ctx, chosen: new Map([['2026-10-18', 'zoho' as const]]) }).map((d) => `${d.date} ${d.source}`)).toEqual(['2026-10-18 zoho', '2026-10-19 system']);
  });
});

describe('the words', () => {
  it('refuse a month whose payroll is with the CEO, approved or paid; ask for a reason', () => {
    expect(recordLockRefusal('2026-10-18', 'approved')).toBe("The October 2026 payroll is approved, so its days can't change any more.");
    expect(recordLockRefusal('2026-10-18', 'paid')).toBe("The October 2026 payroll is paid, so its days can't change any more.");
    expect(recordLockRefusal('2026-10-18', 'pending_ceo')).toContain('is with the CEO');
    expect(recordLockRefusal('2026-10-18', 'draft')).toBeNull();
    expect(recordLockRefusal('2026-10-18', null)).toBeNull();
    expect(recordReasonProblem(' ')).toBe('Write why, e.g. A double press at the door.');
    expect(recordReasonProblem('x'.repeat(501))).toBe('Keep the reason to 500 characters; it has 501.');
    expect(recordReasonProblem('A double press')).toBeNull();
    expect(removedText({ removedBy: 'Mona', removedAt: '2026-10-31T12:00:00.000Z', reason: 'A double press at the door.' })).toBe('Removed by Mona on 31/10/2026: A double press at the door.');
  });
});
