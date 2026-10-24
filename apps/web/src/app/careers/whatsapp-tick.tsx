import { WHATSAPP_CANDIDATE_TICK, WHATSAPP_CANDIDATE_TICK_HINT } from '@trendlix/shared';
import { useId } from 'react';
import { WHATSAPP_FIELD } from './careers';

// The tick "Send me updates about my application on WhatsApp" on both careers forms (owner, 24 October 2026: "how to make
// whatsapp notifications?"; asked whom, "Employees and candidates": candidates who tick it on the careers form), off
// unless ticked, as Meta asks for each person's own opt-in. Ticked, the application (or the CV) and its candidate keep
// it with the time, and the person gets "application received" and their interviews on WhatsApp too; replying STOP
// stops them. HR's Add a CV has no tick.

export function WhatsAppTick({ defaultChecked }: { defaultChecked: boolean }) {
  const id = useId();
  return (
    <label className="flex items-start gap-3 text-sm leading-relaxed text-white/85">
      <input type="checkbox" name={WHATSAPP_FIELD} defaultChecked={defaultChecked} aria-describedby={`${id}-hint`} className="mt-1 size-4 shrink-0" />
      <span>
        <span className="block">{WHATSAPP_CANDIDATE_TICK}</span>
        <span id={`${id}-hint`} className="block text-white/60">
          {WHATSAPP_CANDIDATE_TICK_HINT}
        </span>
      </span>
    </label>
  );
}
