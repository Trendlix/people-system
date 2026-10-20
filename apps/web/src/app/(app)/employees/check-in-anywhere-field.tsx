'use client';

import type { Employment, FormState } from '@/lib/types';

// "Can check in from anywhere" on the employment form (owner, 20 October 2026: check-ins locked to the office network,
// "Office staff, plus exceptions"): with the lock on (Attendance → Check-in Setup), an Office employee checks in and out
// only on the office network unless HR ticks this. Hybrid, Outdoor, Indoor and outdoor and Work from home staff aren't
// locked anyway. A marker is sent with it, so unticking it is saved as no; the change is in the audit log.

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/** After a refused save, ticked if it was sent; otherwise as saved. */
const tickedOf = (state: FormState, key: string, saved: boolean) => (state.values ? key in state.values : saved);

export function CheckInAnywhereField({ state, fid, employment, arrangement }: { state: FormState; fid: (name: string) => string; employment: Employment; arrangement: string }) {
  return (
    <div>
      <input type="hidden" name="checkInAnywhereSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="checkInAnywhere"
          defaultChecked={tickedOf(state, 'checkInAnywhere', employment.checkInAnywhere ?? false)}
          aria-describedby={fid('checkInAnywhere-hint')}
          className="size-4 accent-accent"
        />
        Can check in from anywhere
      </label>
      <p id={fid('checkInAnywhere-hint')} className="hint">
        {arrangement === 'office'
          ? 'With check-ins locked to the office network (Attendance → Check-in Setup), Office staff check in and out only there; ticked, this person checks in from anywhere.'
          : 'Only Office staff are locked to the office network; this work arrangement checks in from anywhere already.'}
      </p>
    </div>
  );
}
