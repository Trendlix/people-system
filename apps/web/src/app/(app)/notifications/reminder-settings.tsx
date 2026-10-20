'use client';

import { NOTIFICATION_SETTING_LABELS, type NotificationSettings } from '@trendlix/shared';
import { useActionState, useId } from 'react';
import { SubmitButton } from '@/components/form';
import { saveReminderSettings, type ReminderSettingsState } from './actions';

// The person's two reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4: "notification settings (which reminders)"), each one on until
// they switch it off, on the site and the phone pages alike. Save says it is saved, or the API's words (while a Super
// Admin views as someone view only, the API refuses it).

const KEYS = Object.keys(NOTIFICATION_SETTING_LABELS) as (keyof NotificationSettings)[];

export function ReminderSettingsForm({ initial, big = false }: { initial: NotificationSettings; big?: boolean }) {
  const [state, action] = useActionState<ReminderSettingsState, FormData>(saveReminderSettings, {});
  const id = useId();
  // the switches as last saved (or as sent, when refused): the form shows them again once Save is done
  const current = state.values ?? initial;
  return (
    <form action={action} className="space-y-3">
      {KEYS.map((key) => (
        <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-3 hover:bg-canvas ${big ? 'min-h-16' : 'min-h-12'}`}>
          <input type="checkbox" name={key} defaultChecked={current[key]} aria-describedby={`${id}-${key}`} className="mt-0.5 size-5 shrink-0 accent-accent" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{NOTIFICATION_SETTING_LABELS[key].label}</span>
            <span id={`${id}-${key}`} className="hint block">
              {NOTIFICATION_SETTING_LABELS[key].hint}
            </span>
          </span>
        </label>
      ))}
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
