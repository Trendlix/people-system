import { describe, expect, it } from 'vitest';
import { groupsText, languageText, messageBadge, personWhatsAppLines, recipientText, seesWhatsAppLog, seesWhatsAppSettings, templateBadge } from './whatsapp';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"): who sees the settings and the
// log, and the words the pages share.

describe('who sees what', () => {
  it('the settings: a Super Admin, never a developer', () => {
    expect(seesWhatsAppSettings({ roles: ['super_admin'] })).toBe(true);
    expect(seesWhatsAppSettings({ roles: ['super_admin', 'hr'], developer: true })).toBe(false);
    for (const role of ['hr', 'ceo', 'admin', 'finance', 'employee'] as const) expect(seesWhatsAppSettings({ roles: [role] }), role).toBe(false);
  });

  it('the log: HR and a Super Admin, never a developer', () => {
    expect(seesWhatsAppLog({ roles: ['hr'] })).toBe(true);
    expect(seesWhatsAppLog({ roles: ['super_admin'] })).toBe(true);
    expect(seesWhatsAppLog({ roles: ['hr'], developer: true })).toBe(false);
    for (const role of ['ceo', 'admin', 'finance', 'employee', 'manager'] as const) expect(seesWhatsAppLog({ roles: [role] }), role).toBe(false);
  });
});

describe('the badges', () => {
  it('say a template’s status at Meta in words', () => {
    expect(templateBadge('approved')).toEqual({ text: 'Approved', tone: 'ok' });
    expect(templateBadge('pending')).toEqual({ text: 'Pending review', tone: 'neutral' });
    expect(templateBadge('rejected')).toEqual({ text: 'Rejected', tone: 'danger' });
    expect(templateBadge('not_submitted')).toEqual({ text: 'Not submitted', tone: 'muted' });
  });

  it('say a message’s status in words', () => {
    expect(messageBadge('read')).toEqual({ text: 'Read', tone: 'ok' });
    expect(messageBadge('queued')).toEqual({ text: 'Waiting', tone: 'warn' });
    expect(messageBadge('failed')).toEqual({ text: 'Failed', tone: 'danger' });
    expect(messageBadge('cancelled')).toEqual({ text: 'Not sent', tone: 'muted' });
  });
});

describe('the texts', () => {
  it('list the groups chosen, Approvals waiting only for an approver', () => {
    const all = { approvals: true, decisions: true, check_in: true, interviews: true };
    expect(groupsText(all)).toBe('Approvals waiting, Request decisions, Check-in reminders, Interviews');
    expect(groupsText(all, { approver: false })).toBe('Request decisions, Check-in reminders, Interviews');
    expect(groupsText({ decisions: true })).toBe('Request decisions');
    expect(groupsText(null)).toBe('none');
  });

  it('name the language and the recipient', () => {
    expect(languageText('ar')).toBe('العربية (Arabic)');
    expect(languageText(null)).toBe('—');
    expect(recipientText({ kind: 'candidate', name: 'Sara Ali' })).toBe('Sara Ali');
    expect(recipientText({ kind: 'number', name: null })).toBe('A number');
  });
});

describe('what HR sees on the Access tab', () => {
  const when = () => '24/10/2026, 2:05 PM';
  const base = { on: false, mobile: '+201001234567', language: null, groups: null, optedInAt: null, stoppedAt: null, stoppedBy: null, noAccount: false } as const;

  it('says on, since when, at which number, in which language and for what', () => {
    const lines = personWhatsAppLines(
      { ...base, on: true, language: 'ar', optedInAt: '2026-10-24T11:05:00.000Z', groups: { approvals: false, decisions: true, check_in: true, interviews: false } },
      'Mona Adel',
      when,
    );
    expect(lines).toEqual({
      status: 'On',
      details: ['On since 24/10/2026, 2:05 PM, at +201001234567.', 'In العربية (Arabic): Request decisions, Check-in reminders.'],
      note: 'Only Mona Adel turns this on or off, from their own Notifications page (or by replying STOP).',
    });
  });

  it('says off, a STOP reply, and no account', () => {
    expect(personWhatsAppLines(base, 'Mona', when).details).toEqual(['They haven’t turned WhatsApp messages on.']);
    expect(personWhatsAppLines({ ...base, stoppedBy: 'stop', stoppedAt: '2026-10-24T11:05:00.000Z' }, 'Mona', when).details).toEqual(['They replied STOP on 24/10/2026, 2:05 PM.']);
    expect(personWhatsAppLines({ ...base, noAccount: true }, 'Mona', when).details[0]).toMatch(/no account yet/);
  });
});
