import { readFileSync } from 'node:fs';
import {
  clippedText,
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationKind,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_KINDS,
  notificationSection,
  PUSH_CHANNEL,
  PUSH_PLATFORMS,
  REMINDER_KINDS,
  REMINDER_SETTING,
  safeNotificationLink,
  WAITING_KINDS,
} from '@trendlix/shared';

// The shared rules of notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; packages/shared notifications.ts): the API keeps and sends them, the web shows them.

const MIGRATION = new URL('../../prisma/migrations/20261020140000_notifications/migration.sql', import.meta.url);

describe('notifications (shared)', () => {
  it('has the kinds the database allows, each labelled', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const listed = /"notifications_kind_check" CHECK \("kind" IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    expect([...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...NOTIFICATION_KINDS]);
    expect(Object.keys(NOTIFICATION_KIND_LABELS).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(isNotificationKind('leave_waiting')).toBe(true);
    expect(isNotificationKind('salary_changed')).toBe(false);
    // the reminders the database keeps as sent, and the switch of each
    const reminders = /"reminders_sent_kind_check" CHECK \("kind" IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    expect([...reminders.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...REMINDER_KINDS]);
    expect(REMINDER_SETTING).toEqual({ check_in_reminder: 'checkInReminder', check_out_reminder: 'checkOutReminder' });
    expect(DEFAULT_NOTIFICATION_SETTINGS).toEqual({ checkInReminder: true, checkOutReminder: true });
    expect(PUSH_PLATFORMS).toEqual(['android', 'ios']);
    expect(PUSH_CHANNEL.id).toBe('general');
  });

  it('opens what waits for the person under To approve, and their own news under their requests', () => {
    for (const kind of WAITING_KINDS) expect(notificationSection(kind)).toBe('approve');
    for (const kind of ['leave_decided', 'reimbursement_paid', 'payslip_issued', 'check_in_reminder', 'home_location_decided']) expect(notificationSection(kind)).toBe('requests');
  });

  it('keeps a link only on the site', () => {
    expect(safeNotificationLink('/leave/0b5c1d36-6d0e-4f43-9a55-6f6b3a5c2e11')).toBe('/leave/0b5c1d36-6d0e-4f43-9a55-6f6b3a5c2e11');
    expect(safeNotificationLink(' /raise-requests?status=with_hr ')).toBe('/raise-requests?status=with_hr');
    for (const bad of ['https://evil.example/', '//evil.example/x', 'leave/1', '/a\\b', '/a\nb', `/${'x'.repeat(300)}`, null, undefined, 42]) {
      expect(safeNotificationLink(bad)).toBeNull();
    }
  });

  it('cuts a text to its limit, with an ellipsis', () => {
    expect(clippedText('  Leave   request  approved ', 100)).toBe('Leave request approved');
    expect(clippedText('abcdefghij', 5)).toBe('abcd…');
    expect(clippedText('abcde', 5)).toBe('abcde');
  });
});
