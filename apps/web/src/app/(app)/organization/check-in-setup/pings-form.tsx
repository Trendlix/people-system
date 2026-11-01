'use client';

import { useState } from 'react';
import { FormErrors, SubmitButton, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

// Organization → Check-in Setup → Hourly Location (owner, 1 November 2026: "can the devices ping every 1 hour their
// location? and flag if someone is not in the checked in location?"; chose "Silent automatic ping"): the switch, off
// to start with. On, the app reads each person's location every hour while they are checked in, and a ping away from
// where they checked in is flagged on the day's records. The API checks the role again.

export function PingsForm({ action, on }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; on: boolean }) {
  const [checked, setChecked] = useState(on);
  const { state, pending, form } = useKeptForm(action);
  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <div>
        {/* a hidden "false" so turning it off is sent too */}
        <input type="hidden" name="enabled" value="false" />
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input type="checkbox" role="switch" name="enabled" value="true" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="size-5 accent-accent" />
          Read the location every hour while checked in (app)
        </label>
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
