import {
  ALL_WHATSAPP_GROUPS,
  isWhatsAppGroup,
  isWhatsAppLanguage,
  WHATSAPP_GROUPS,
  type MyWhatsAppInput,
  type MyWhatsAppView,
  type WhatsAppGroup,
} from '@trendlix/shared';

// The person's own WhatsApp messages (owner, 24 October 2026: "how to make whatsapp notifications?"; asked whom,
// "Employees and candidates": employees who opt in, for "Approvals waiting, Request decisions, Check-in reminders,
// Interviews"): what the form on the Notifications page sends, and what it says. Pure code, tested
// (whatsapp-choice.test.ts); the API decides (PUT /me/whatsapp).

/** What saving came to: the choice as it now stands (the API's answer), or why not. */
export interface WhatsAppChoiceState {
  saved?: boolean;
  error?: string;
  view?: MyWhatsAppView;
}

/** The groups the form offers this person: Approvals waiting only to someone who approves. */
export const offeredGroups = (view: Pick<MyWhatsAppView, 'approver'>): WhatsAppGroup[] => WHATSAPP_GROUPS.filter((g) => g !== 'approvals' || view.approver);

/**
 * PUT /me/whatsapp's body from the form: the switch, the language, and each group the form offered (its hidden
 * "offered" fields) as ticked or not.
 */
export function myWhatsAppBody(fd: FormData): MyWhatsAppInput {
  const lang = fd.get('language');
  const groups: Partial<Record<WhatsAppGroup, boolean>> = {};
  for (const g of fd.getAll('offered')) if (isWhatsAppGroup(g)) groups[g] = fd.get(`group-${g}`) !== null;
  return { on: fd.getAll('on').includes('true'), language: isWhatsAppLanguage(lang) ? lang : 'en', groups };
}

/** The groups the form starts with: those chosen when it is on, else all (opting in starts with all of them). */
export function startingGroups(view: Pick<MyWhatsAppView, 'on' | 'groups'>): Record<WhatsAppGroup, boolean> {
  return view.on ? { ...ALL_WHATSAPP_GROUPS, ...view.groups } : { ...ALL_WHATSAPP_GROUPS };
}

/** Why the switch can't be turned on now, in words; null when it can. */
export function blockedText(view: Pick<MyWhatsAppView, 'available' | 'mobile' | 'on'>, viewingAs: boolean): string | null {
  if (viewingAs) return 'Only the person themself turns WhatsApp messages on or off, from their own account.';
  if (!view.mobile) return 'There is no mobile number on your profile. Ask HR to add it, then turn WhatsApp messages on here.';
  if (!view.available && !view.on) return 'The company hasn’t switched WhatsApp messages on yet. You can turn them on here once it does.';
  return null;
}

/** The lines under the switch: since when, a changed number, a STOP reply, the company having switched it off. */
export function choiceNotes(view: MyWhatsAppView, when: (iso: string) => string): string[] {
  const out: string[] = [];
  if (view.on && view.optedInAt) out.push(`On since ${when(view.optedInAt)}.`);
  if (view.on && !view.available) out.push('The company has WhatsApp messages switched off for now: nothing is sent until it switches them on again.');
  if (view.mobileChanged) out.push('Your mobile number changed since you turned them on, so they are off: turn them on again for your number now.');
  if (!view.on && view.stoppedBy === 'stop' && view.stoppedAt) out.push(`You replied STOP on WhatsApp on ${when(view.stoppedAt)}, so they are off. Turn them on again here if you like.`);
  return out;
}
