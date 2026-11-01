'use client';

import { CHECK_IN_WITHOUT_LOCATION_LABEL } from '@trendlix/shared';
import type { Employment, FormState } from '@/lib/types';

// "Can check in from anywhere" on the employment form (owner, 20 October 2026: check-ins locked to the office network,
// "Office staff, plus exceptions"): with the lock on (Organization → Check-in Setup), an Office employee checks in and out
// only on the office network unless HR ticks this. Hybrid, Outdoor, Indoor and outdoor and Work from home staff aren't
// locked anyway. A marker is sent with it, so unticking it is saved as no; the change is in the audit log. Beside it,
// "Can check in without a location" (owner, 20 October 2026: "Company switch + exceptions"): with Check-in Setup's switch
// refusing presses without a location, this person may press on the website without one; sent and audited the same way.
// Both texts name both locks since 24 October 2026 (owner, on a profile with both unticked: "while these aare not checked,
// people can still check in and out from anywhere"; asked, "Yes, add a GPS lock too"): the office network's, and the
// check-in locations' by GPS.

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/** After a refused save, ticked if it was sent; otherwise as saved. */
const tickedOf = (state: FormState, key: string, saved: boolean) => (state.values ? key in state.values : saved);

export function CheckInAnywhereField({ state, employment }: { state: FormState; employment: Employment }) {
  return (
    <div>
      <input type="hidden" name="checkInAnywhereSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="checkInAnywhere"
          defaultChecked={tickedOf(state, 'checkInAnywhere', employment.checkInAnywhere ?? false)}
          className="size-4 accent-accent"
        />
        Can check in from anywhere
      </label>
    </div>
  );
}

export function CheckInWithoutLocationField({ state, employment }: { state: FormState; employment: Employment }) {
  return (
    <div>
      <input type="hidden" name="checkInWithoutLocationSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="checkInWithoutLocation"
          defaultChecked={tickedOf(state, 'checkInWithoutLocation', employment.checkInWithoutLocation ?? false)}
          className="size-4 accent-accent"
        />
        {CHECK_IN_WITHOUT_LOCATION_LABEL}
      </label>
    </div>
  );
}
