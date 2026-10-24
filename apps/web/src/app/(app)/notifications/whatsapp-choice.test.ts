import type { MyWhatsAppView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { blockedText, choiceNotes, myWhatsAppBody, offeredGroups, startingGroups } from './whatsapp-choice';

// The person's own WhatsApp messages (owner, 24 October 2026: "how to make whatsapp notifications?"; employees who opt
// in, for "Approvals waiting, Request decisions, Check-in reminders, Interviews"): what the form sends and says.

const view = (over: Partial<MyWhatsAppView> = {}): MyWhatsAppView => ({
  available: true,
  mobile: '+201001234567',
  on: false,
  language: 'en',
  groups: { approvals: false, decisions: true, check_in: false, interviews: false },
  approver: true,
  optedInAt: null,
  mobileChanged: false,
  stoppedAt: null,
  stoppedBy: null,
  ...over,
});

const when = () => '24/10/2026, 2:05 PM';

describe('the form', () => {
  it('offers Approvals waiting only to someone who approves', () => {
    expect(offeredGroups(view())).toEqual(['approvals', 'decisions', 'check_in', 'interviews']);
    expect(offeredGroups(view({ approver: false }))).toEqual(['decisions', 'check_in', 'interviews']);
  });

  it('sends the switch, the language and each group offered as ticked', () => {
    const fd = new FormData();
    fd.append('on', 'false');
    fd.append('on', 'true');
    fd.set('language', 'ar');
    for (const g of ['decisions', 'check_in', 'interviews']) fd.append('offered', g);
    fd.set('group-decisions', 'on');
    fd.set('group-interviews', 'on');
    // a group not offered, or not a group, is never sent
    fd.set('group-approvals', 'on');
    fd.append('offered', 'marketing');
    expect(myWhatsAppBody(fd)).toEqual({ on: true, language: 'ar', groups: { decisions: true, check_in: false, interviews: true } });
  });

  it('sends off, and English for a language that isn’t one', () => {
    const fd = new FormData();
    fd.append('on', 'false');
    fd.set('language', 'fr');
    expect(myWhatsAppBody(fd)).toEqual({ on: false, language: 'en', groups: {} });
  });

  it('starts with every group when they turn it on, and their own choice once on', () => {
    expect(startingGroups(view())).toEqual({ approvals: true, decisions: true, check_in: true, interviews: true });
    expect(startingGroups(view({ on: true }))).toEqual({ approvals: false, decisions: true, check_in: false, interviews: false });
  });
});

describe('what it says', () => {
  it('says why it can’t be turned on: viewing as them, no mobile, or not switched on by the company', () => {
    expect(blockedText(view(), true)).toMatch(/^Only the person themself/);
    expect(blockedText(view({ mobile: null }), false)).toMatch(/^There is no mobile number on your profile/);
    expect(blockedText(view({ available: false }), false)).toMatch(/^The company hasn’t switched WhatsApp messages on yet/);
    // already on: it can always be turned off
    expect(blockedText(view({ available: false, on: true }), false)).toBeNull();
    expect(blockedText(view(), false)).toBeNull();
  });

  it('says since when, a changed number and a STOP reply', () => {
    expect(choiceNotes(view({ on: true, optedInAt: '2026-10-24T11:05:00.000Z' }), when)).toEqual(['On since 24/10/2026, 2:05 PM.']);
    expect(choiceNotes(view({ mobileChanged: true }), when)[0]).toMatch(/^Your mobile number changed/);
    expect(choiceNotes(view({ stoppedBy: 'stop', stoppedAt: '2026-10-24T11:05:00.000Z' }), when)).toEqual([
      'You replied STOP on WhatsApp on 24/10/2026, 2:05 PM, so they are off. Turn them on again here if you like.',
    ]);
    expect(choiceNotes(view({ on: true, available: false }), when)[0]).toMatch(/switched off for now/);
  });
});
