'use client';

import { useState } from 'react';
import { CHECK_IN_WITHOUT_LOCATION_LABEL, GPS_LOCK_LABEL, GPS_ROUGH_DEFAULT, GPS_ROUGH_MAX, GPS_ROUGH_MIN } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { GPS_ALLOWANCE_TEXT } from './setup';

// Organization → Check-in Setup → Check-ins Outside the Check-in Locations (owner, 24 October 2026, on a profile with both
// exceptions unticked: "while these aare not checked, people can still check in and out from anywhere"; asked, "Yes, add a
// GPS lock too"): the switch, off to start with, and the accuracy past which a reading is too rough (200 m to start with,
// 50 to 500 m). On, an Office person's check-in or check-out outside every circle they may press in is refused, with how
// far they are and the way out (an attendance correction). The API checks the role and the values again, and switches it
// on only with the main office set.

export function GpsLockForm({ action, on, roughMetres }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; on: boolean; roughMetres: number }) {
  const fid = useFieldIds();
  const [checked, setChecked] = useState(on);
  const { state, pending, form } = useKeptForm(action);
  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <div>
        {/* a hidden "false" so turning it off is sent too */}
        <input type="hidden" name="lock" value="false" />
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            name="lock"
            value="true"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            aria-describedby={fid('lock-hint')}
            className="size-5 accent-accent"
          />
          {GPS_LOCK_LABEL}
        </label>
        <div id={fid('lock-hint')} className="hint max-w-3xl space-y-1">
          <p>
            On: an Office person&apos;s check-in or check-out outside every check-in location is refused, with how far they are and a link to ask for an
            attendance correction; nothing is kept. Hybrid, Outdoor, Indoor and outdoor and Work from home staff aren&apos;t held to it, and HR recording a day
            never is.
          </p>
          <p>
            It passes inside the main office, the sub-locations they are linked to, the client locations, and their own approved home and remote sites; and never
            applies to someone with &ldquo;Can check in from anywhere&rdquo;, on an approved work from home day, or within an approved official duty.
          </p>
          <p>
            Without a location the press is refused too, on the website as well, unless HR ticks &ldquo;{CHECK_IN_WITHOUT_LOCATION_LABEL}&rdquo; on the
            person&apos;s profile. A location the phone says is made up still passes inside a circle, and is flagged &ldquo;Fake GPS suspected&rdquo; as before.
            The app reads the location more precisely than a browser.
          </p>
        </div>
      </div>
      <div>
        <label htmlFor={fid('roughMetres')} className="label">
          Too rough past (m)
        </label>
        <input
          id={fid('roughMetres')}
          name="roughMetres"
          inputMode="numeric"
          defaultValue={valueOf(state, 'roughMetres', String(roughMetres || GPS_ROUGH_DEFAULT))}
          aria-describedby={fid('rough-hint')}
          className="input w-32 tabular-nums"
        />
        <p id={fid('rough-hint')} className="hint max-w-3xl">
          {GPS_ALLOWANCE_TEXT} A reading less accurate than this, in whole metres from {GPS_ROUGH_MIN} to {GPS_ROUGH_MAX} ({GPS_ROUGH_DEFAULT} to start with), is
          refused as too rough, with &ldquo;use the app, or turn on precise location&rdquo;.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
