'use client';

import { useState } from 'react';
import { REFUSE_WITHOUT_LOCATION_LABEL } from '@trendlix/shared';
import { FormErrors, SubmitButton, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

// Attendance → Check-in Setup → Check-ins Without a Location (owner, 20 October 2026: "i want a flag to restrict checkin
// and out from unknown locations"; asked, "Company switch + exceptions", "Allow as Office"): the one switch, off to start
// with. On, a website press without a location is refused with how to allow it in the browser, unless HR lets the person
// check in without one on their profile, or it comes from an office network (counted as at the office; only with the
// key in place). In the app a location is always needed. The API checks the role and the value again.

export function LocationRuleForm({ action, on }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; on: boolean }) {
  const [checked, setChecked] = useState(on);
  const { state, pending, form } = useKeptForm(action);
  return (
    <form {...form} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        {/* a hidden "false" so turning it off is sent too */}
        <input type="hidden" name="refuseWithoutLocation" value="false" />
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            name="refuseWithoutLocation"
            value="true"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="size-5 accent-accent"
          />
          {REFUSE_WITHOUT_LOCATION_LABEL}
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
