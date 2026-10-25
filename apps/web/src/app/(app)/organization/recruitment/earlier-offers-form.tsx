'use client';

import { useActionState } from 'react';
import { EARLIER_OFFERS_SWITCH, type EarlierOffersSetting } from '@trendlix/shared';
import { FormErrors } from '@/components/form';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';

// Recruitment Settings' "Earlier Offers" (owner, 25 October 2026: "allow the HR to add for now job offers with a past
// duedate to enter the previous data"): the switch "Entering earlier offers", on for now, HR's and a Super Admin's to
// change; audited by the API.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function EarlierOffersForm({ action, setting }: { action: Action; setting: EarlierOffersSetting }) {
  const [state, formAction, pending] = useActionState(action, {});
  const checked = state.values ? state.values.on === 'on' : setting.on;
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
        <input type="checkbox" role="switch" name="on" defaultChecked={checked} className="size-5 shrink-0 accent-accent" />
        {EARLIER_OFFERS_SWITCH}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
      {setting.updatedAt && (
        <p className="text-xs text-muted">
          Recruitment Settings last changed {formatDateTime(setting.updatedAt)}
          {setting.updatedBy ? ` by ${setting.updatedBy.name ?? setting.updatedBy.email}` : ''}.
        </p>
      )}
    </form>
  );
}
