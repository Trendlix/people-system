'use client';

import { useState } from 'react';
import { GPS_LOCK_LABEL, GPS_ROUGH_DEFAULT } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

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
            className="size-5 accent-accent"
          />
          {GPS_LOCK_LABEL}
        </label>
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
          className="input w-32 tabular-nums"
        />
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
