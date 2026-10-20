'use client';

import { NOTIFICATION_SETTING_LABELS, type NotificationSettings } from '@trendlix/shared';
import { useActionState, useId } from 'react';
import { SubmitButton } from '@/components/form';
import { saveReminderSettings, type ReminderSettingsState } from './actions';

// The person's two reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4: "notification settings (which reminders)"), on the site and the
// phone pages alike: "Still checked in?" on until they switch it off; "You haven't checked in" always on (owner, 20
// October 2026, asked whether people may switch it off: "No, always on"), shown ticked and greyed out with why. Save says
// it is saved, or the API's words (while a Super Admin views as someone view only, the API refuses it).

const KEYS = Object.keys(NOTIFICATION_SETTING_LABELS) as (keyof NotificationSettings)[];

export function ReminderSettingsForm({ initial, big = false }: { initial: NotificationSettings; big?: boolean }) {
  const [state, action] = useActionState<ReminderSettingsState, FormData>(saveReminderSettings, {});
  const id = useId();
  // the switches as last saved (or as sent, when refused): the form shows them again once Save is done
  const current = state.values ?? initial;
  return (
    <form action={action} className="space-y-3">
      {KEYS.map((key) => {
        const { label, hint, alwaysOn } = NOTIFICATION_SETTING_LABELS[key];
        // always on: ticked and greyed out (not sent with the form), with why
        return (
          <label
            key={key}
            className={`flex items-start gap-3 rounded-lg border border-line px-3 py-3 ${alwaysOn ? 'bg-canvas/60' : 'cursor-pointer hover:bg-canvas'} ${big ? 'min-h-16' : 'min-h-12'}`}
          >
            <input
              type="checkbox"
              name={key}
              {...(alwaysOn ? { checked: true, disabled: true, readOnly: true } : { defaultChecked: current[key] })}
              aria-describedby={`${id}-${key}`}
              className="mt-0.5 size-5 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                {label}
                {alwaysOn && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Always on</span>}
              </span>
              <span id={`${id}-${key}`} className="hint block">
                {hint}
                {alwaysOn && <span className="mt-1 block">{alwaysOn}</span>}
              </span>
            </span>
          </label>
        );
      })}
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          Saved.
        </p>
      )}
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
