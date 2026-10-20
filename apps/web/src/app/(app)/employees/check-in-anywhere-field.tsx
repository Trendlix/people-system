'use client';

import { CHECK_IN_WITHOUT_LOCATION_LABEL, REFUSE_WITHOUT_LOCATION_LABEL } from '@trendlix/shared';
import type { Employment, FormState } from '@/lib/types';

// "Can check in from anywhere" on the employment form (owner, 20 October 2026: check-ins locked to the office network,
// "Office staff, plus exceptions"): with the lock on (Attendance → Check-in Setup), an Office employee checks in and out
// only on the office network unless HR ticks this. Hybrid, Outdoor, Indoor and outdoor and Work from home staff aren't
// locked anyway. A marker is sent with it, so unticking it is saved as no; the change is in the audit log. Beside it,
// "Can check in without a location" (owner, 20 October 2026: "Company switch + exceptions"): with Check-in Setup's switch
// refusing presses without a location, this person may press on the website without one; sent and audited the same way.

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

export function CheckInWithoutLocationField({ state, fid, employment }: { state: FormState; fid: (name: string) => string; employment: Employment }) {
  return (
    <div>
      <input type="hidden" name="checkInWithoutLocationSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="checkInWithoutLocation"
          defaultChecked={tickedOf(state, 'checkInWithoutLocation', employment.checkInWithoutLocation ?? false)}
          aria-describedby={fid('checkInWithoutLocation-hint')}
          className="size-4 accent-accent"
        />
        {CHECK_IN_WITHOUT_LOCATION_LABEL}
      </label>
      <p id={fid('checkInWithoutLocation-hint')} className="hint">
        With &ldquo;{REFUSE_WITHOUT_LOCATION_LABEL}&rdquo; on (Attendance → Check-in Setup), a check-in on the website without a location is refused;
        ticked, this person&apos;s is kept as location unknown. In the app a location is always needed.
      </p>
    </div>
  );
}
