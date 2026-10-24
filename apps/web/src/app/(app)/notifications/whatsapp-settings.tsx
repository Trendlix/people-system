'use client';

import { WHATSAPP_GROUP_LABELS, WHATSAPP_LANGUAGE_LABELS, WHATSAPP_LANGUAGES, type MyWhatsAppView, type WhatsAppGroup, type WhatsAppLanguage } from '@trendlix/shared';
import { useActionState, useId, useState } from 'react';
import { SubmitButton } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import { saveMyWhatsApp } from './actions';
import { blockedText, choiceNotes, offeredGroups, startingGroups, type WhatsAppChoiceState } from './whatsapp-choice';

// The person's own WhatsApp messages (owner, 24 October 2026: "how to make whatsapp notifications?"; asked whom,
// "Employees and candidates", and what, "Approvals waiting, Request decisions, Check-in reminders, Interviews"), on the
// site's and the phone pages' Notifications alike: "Notify me on WhatsApp at +20…" (their mobile), off until they turn
// it on (Meta asks for each person's own opt-in, so nobody else can: HR sees it, never changes it), the language, and
// the groups, all ticked when they turn it on; Approvals waiting only for those who approve. Replying STOP on WhatsApp
// turns it off too. WhatsApp is added to the bell and push, never in their place.

export function WhatsAppSettingsForm({ initial, viewingAs, big = false }: { initial: MyWhatsAppView; viewingAs: boolean; big?: boolean }) {
  const [state, action] = useActionState<WhatsAppChoiceState, FormData>(saveMyWhatsApp, {});
  const id = useId();
  const view = state.view ?? initial;
  const [on, setOn] = useState(view.on);
  const [language, setLanguage] = useState<WhatsAppLanguage>(view.language);
  const [groups, setGroups] = useState<Record<WhatsAppGroup, boolean>>(() => startingGroups(view));
  // the answer of a save that went through: the form shows the choice as it now stands
  const [seen, setSeen] = useState(state.view);
  if (state.view !== seen) {
    setSeen(state.view);
    if (state.view) {
      setOn(state.view.on);
      setLanguage(state.view.language);
      setGroups(startingGroups(state.view));
    }
  }

  const blocked = blockedText(view, viewingAs);
  const offered = offeredGroups(view);
  const notes = choiceNotes(view, formatDateTime);
  const locked = !!blocked;

  function switchTo(next: boolean) {
    setOn(next);
    // turning them on starts with every group (owner's brief: "all on when they opt in")
    if (next && !view.on) setGroups(startingGroups({ on: false, groups: view.groups }));
  }

  const row = `flex items-start gap-3 rounded-lg border border-line px-3 py-3 ${big ? 'min-h-16' : 'min-h-12'}`;

  return (
    <form action={action} className="space-y-3">
      {blocked && <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted">{blocked}</p>}
      <input type="hidden" name="on" value="false" />
      <label className={`${row} ${locked ? 'bg-canvas/60' : 'cursor-pointer hover:bg-canvas'}`}>
        <input
          type="checkbox"
          role="switch"
          name="on"
          value="true"
          checked={on}
          disabled={viewingAs || (locked && !view.on)}
          onChange={(e) => switchTo(e.target.checked)}
          aria-describedby={`${id}-on`}
          className="mt-0.5 size-5 shrink-0 accent-accent"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium break-words">
            Notify me on WhatsApp{view.mobile ? ' at ' : ''}
            {view.mobile && (
              <span dir="ltr" className="tabular-nums">
                {view.mobile}
              </span>
            )}
          </span>
          <span id={`${id}-on`} className="hint block">
            Besides the bell and your phone’s notifications, never instead. Your mobile on your profile; ask HR to change it. Reply STOP to any message
            to turn them off.
          </span>
        </span>
      </label>

      {on && (
        <fieldset className="space-y-3" disabled={viewingAs}>
          <legend className="sr-only">What to get on WhatsApp</legend>
          <div className="max-w-xs">
            <label htmlFor={`${id}-language`} className="label">
              Language
            </label>
            <Select id={`${id}-language`} name="language" value={language} onChange={(e) => setLanguage(e.target.value as WhatsAppLanguage)} className="input">
              {WHATSAPP_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {WHATSAPP_LANGUAGE_LABELS[l]}
                </option>
              ))}
            </Select>
          </div>
          {offered.map((g) => {
            const { label, hint } = WHATSAPP_GROUP_LABELS[g];
            return (
              <label key={g} className={`${row} cursor-pointer hover:bg-canvas`}>
                <input type="hidden" name="offered" value={g} />
                <input
                  type="checkbox"
                  name={`group-${g}`}
                  checked={groups[g]}
                  onChange={(e) => setGroups((now) => ({ ...now, [g]: e.target.checked }))}
                  aria-describedby={`${id}-${g}`}
                  className="mt-0.5 size-5 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span id={`${id}-${g}`} className="hint block">
                    {hint}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {/* switched off, the language and the groups stay as they were */}
      {!on && <input type="hidden" name="language" value={language} />}

      {notes.map((n) => (
        <p key={n} className="text-sm text-muted">
          {n}
        </p>
      ))}
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          {view.on ? 'Saved. WhatsApp messages are on.' : 'Saved. WhatsApp messages are off.'}
        </p>
      )}
      {!viewingAs && (!locked || view.on) && <SubmitButton>Save</SubmitButton>}
    </form>
  );
}
