'use client';

import { useState } from 'react';
import { CHECK_IN_WITHOUT_LOCATION_LABEL, REFUSE_WITHOUT_LOCATION_LABEL } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

// Attendance → Check-in Setup → Check-ins Without a Location (owner, 20 October 2026: "i want a flag to restrict checkin
// and out from unknown locations"; asked, "Company switch + exceptions", "Allow as Office"): the one switch, off to start
// with. On, a website press without a location is refused with how to allow it in the browser, unless HR lets the person
// check in without one on their profile, or it comes from an office network (counted as at the office; only with the
// key in place). In the app a location is always needed. The API checks the role and the value again.

export function LocationRuleForm({ action, on }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; on: boolean }) {
  const fid = useFieldIds();
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
            aria-describedby={fid('rule-hint')}
            className="size-5 accent-accent"
          />
          {REFUSE_WITHOUT_LOCATION_LABEL}
        </label>
        <p id={fid('rule-hint')} className="hint max-w-3xl">
          On: on the website a check-in or check-out without a location is refused; the employee is told to allow the location in the browser, or to
          ask for an attendance correction. A press from an office network (Office Networks, above, with the key in place) counts as at the office
          without one. Someone who can&apos;t share it (no location on their computer) is let through by HR with &ldquo;{CHECK_IN_WITHOUT_LOCATION_LABEL}
          &rdquo; on their profile. In the app a location is always needed. HR recording a day is never refused.
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
