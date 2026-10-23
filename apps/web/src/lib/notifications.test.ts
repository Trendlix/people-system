import { PUSH_TOKEN_MAX } from '@trendlix/shared';
import { describe, expect, it, vi } from 'vitest';
import { formatDateTime } from './format';
import type { PushRegistration } from './native';
import {
  badgeText,
  bellLabel,
  clearPushToken,
  dismissPushOffer,
  inboxHref,
  inboxPage,
  kindLabel,
  notificationHref,
  notificationTime,
  notLoadedText,
  pageCount,
  PUSH_OFFER_KEY,
  PUSH_TEXT,
  PUSH_TOKEN_KEY,
  pushHref,
  pushOfferDismissed,
  pushTokenOf,
  readPushToken,
  turnOnPushFlow,
  unreadOf,
  unreadText,
  writePushToken,
  type PushTurnOnSteps,
} from './notifications';

// Notifications on the web's side (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): where each opens, the bell, the inbox's pages and
// times, Home's offer and the token kept on the phone, and turning push on.

const ID = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

describe('where a notification opens', () => {
  it('opens its link as it is on the site', () => {
    expect(notificationHref(`/leave/${ID}`, 'leave_decided', 'site')).toBe(`/leave/${ID}`);
    expect(notificationHref('/raise-requests?status=with_hr', 'raise_request_waiting', 'site')).toBe('/raise-requests?status=with_hr');
    expect(notificationHref('/my-attendance', 'check_in_reminder', 'site')).toBe('/my-attendance');
    expect(notificationHref('/app/payslips/line-1', 'payslip_issued', 'site')).toBe('/app/payslips/line-1');
    expect(notificationHref(null, 'leave_decided', 'site')).toBeNull();
  });

  it('opens nothing that isn’t one address on this site', () => {
    for (const link of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', 'leave/1', '', '   ', '/a\\b', '/a\nb', `/${'x'.repeat(400)}`]) {
      expect(notificationHref(link, 'leave_decided', 'site')).toBeNull();
      expect(notificationHref(link, 'leave_decided', 'app')).toBeNull();
    }
    expect(notificationHref(undefined, 'leave_decided', 'app')).toBeNull();
  });

  it('keeps a phone page’s link on the phone pages', () => {
    expect(notificationHref('/app/payslips/line-1', 'payslip_issued', 'app')).toBe('/app/payslips/line-1');
    expect(notificationHref('/app', 'leave_decided', 'app')).toBe('/app');
    expect(notificationHref('/app?x=1', 'leave_decided', 'app')).toBe('/app?x=1');
    // not under /app: a site page, as the section's list
    expect(notificationHref('/appendix', 'leave_decided', 'app')).toBe('/app/requests');
  });

  it('opens My custody and a custody record in the phone layout (Assets step 3, 21 October 2026)', () => {
    expect(notificationHref('/my-custody', 'custody_handover', 'app')).toBe('/app/custody');
    expect(notificationHref('/my-custody', 'custody_overdue', 'site')).toBe('/my-custody');
    expect(notificationHref('/assets/custody/CUS-0042', 'custody_overdue', 'app')).toBe('/app/assets/custody/CUS-0042');
    expect(notificationHref('/assets/custody/cus-0042?x=1', 'custody_unsigned', 'app')).toBe('/app/assets/custody/CUS-0042');
    expect(notificationHref('/assets/custody/CUS-0042', 'custody_unsigned', 'site')).toBe('/assets/custody/CUS-0042');
  });

  it('opens the Hold page as it is, in the app too (23 October 2026: on Hold "Check-in/out only")', () => {
    expect(notificationHref('/hold', 'access_hold', 'app')).toBe('/hold');
    expect(notificationHref('/hold', 'access_hold', 'site')).toBe('/hold');
    expect(notificationHref('/holdings', 'access_hold', 'app')).toBe('/app/requests');
  });

  it('opens the reminders on Home, where the check-in is', () => {
    expect(notificationHref('/my-attendance', 'check_in_reminder', 'app')).toBe('/app');
    expect(notificationHref(null, 'check_out_reminder', 'app')).toBe('/app');
  });

  it('opens My Attendance as the phone’s Attendance, its month kept', () => {
    expect(notificationHref('/my-attendance', 'correction_decided', 'app')).toBe('/app/attendance');
    expect(notificationHref('/my-attendance?month=2026-09', 'correction_decided', 'app')).toBe('/app/attendance?month=2026-09');
    expect(notificationHref('/my-attendance?month=nope#days', 'correction_decided', 'app')).toBe('/app/attendance');
  });

  it('opens a request in To Approve when it waits for the person, else in their own requests', () => {
    expect(notificationHref(`/leave/${ID}`, 'leave_waiting', 'app')).toBe(`/app/approve/leave/${ID}`);
    expect(notificationHref(`/leave/${ID}`, 'leave_decided', 'app')).toBe(`/app/requests/leave/${ID}`);
    expect(notificationHref(`/leave/permissions/${ID}`, 'permission_waiting', 'app')).toBe(`/app/approve/permission/${ID}`);
    expect(notificationHref(`/leave/permissions/${ID}`, 'permission_decided', 'app')).toBe(`/app/requests/permission/${ID}`);
    expect(notificationHref(`/reimbursements/${ID}`, 'reimbursement_paid', 'app')).toBe(`/app/requests/reimbursement/${ID}`);
    expect(notificationHref(`/attendance/corrections/${ID}`, 'correction_waiting', 'app')).toBe(`/app/approve/correction/${ID}`);
    // working from home (owner, 21 October 2026: "Manager, then HR"): waiting for the approver, decided for the employee
    expect(notificationHref(`/attendance/wfh/${ID}`, 'wfh_waiting', 'app')).toBe(`/app/approve/wfh/${ID}`);
    expect(notificationHref(`/attendance/wfh/${ID}`, 'wfh_decided', 'app')).toBe(`/app/requests/wfh/${ID}`);
    expect(notificationHref(`/attendance/wfh/${ID}`, 'wfh_waiting', 'site')).toBe(`/attendance/wfh/${ID}`);
    // official duty (owner, 23 October 2026: "Manager, then HR"): the same way
    expect(notificationHref(`/attendance/official-duty/${ID}`, 'od_waiting', 'app')).toBe(`/app/approve/od/${ID}`);
    expect(notificationHref(`/attendance/official-duty/${ID}`, 'od_decided', 'app')).toBe(`/app/requests/od/${ID}`);
    expect(notificationHref(`/attendance/official-duty/${ID}`, 'od_waiting', 'site')).toBe(`/attendance/official-duty/${ID}`);
    expect(notificationHref('/raise-requests?status=with_hr', 'raise_request_waiting', 'app')).toBe('/app/approve');
    expect(notificationHref('/approvals', 'pay_raise_waiting', 'app')).toBe('/app/approve');
    // a kind from a newer API: the person's own requests
    expect(notificationHref(`/leave/${ID}`, 'something_new', 'app')).toBe(`/app/requests/leave/${ID}`);
  });

  it('opens a notification tapped on the phone at its page, else the inbox', () => {
    expect(pushHref({ link: `/leave/${ID}`, kind: 'leave_waiting', id: 'n1' })).toBe(`/app/approve/leave/${ID}`);
    expect(pushHref({ link: '/app/payslips/line-1', kind: 'payslip_issued' })).toBe('/app/payslips/line-1');
    expect(pushHref({ kind: 'check_in_reminder' })).toBe('/app');
    expect(pushHref({ link: '//evil.example', kind: 'leave_decided' })).toBe('/app/notifications');
    expect(pushHref({})).toBe('/app/notifications');
    expect(pushHref(null)).toBe('/app/notifications');
  });

  it('labels each kind, and one it doesn’t know', () => {
    expect(kindLabel('leave_waiting')).toBe('Leave');
    expect(kindLabel('correction_decided')).toBe('Attendance correction');
    expect(kindLabel('check_in_reminder')).toBe('Reminder');
    expect(kindLabel('something_new')).toBe('Notification');
  });
});

describe('the bell', () => {
  it('shows the count, none at 0, 99+ above 99', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(null)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('names itself with the count for screen readers', () => {
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
    expect(bellLabel(250)).toBe('Notifications, 99+ unread');
    expect(bellLabel(0)).toBe('Notifications');
    expect(bellLabel(null)).toBe('Notifications');
  });

  it('reads the API’s count, anything else none known', () => {
    expect(unreadOf({ unread: 4 })).toBe(4);
    expect(unreadOf({ unread: 0 })).toBe(0);
    expect(unreadOf({ unread: '4' })).toBeNull();
    expect(unreadOf({ unread: -1 })).toBeNull();
    expect(unreadOf({})).toBeNull();
    expect(unreadOf(null)).toBeNull();
  });
});

describe('the inbox', () => {
  it('reads ?page=, the first for anything else', () => {
    expect(inboxPage(undefined)).toBe(1);
    expect(inboxPage(null)).toBe(1);
    expect(inboxPage('2')).toBe(2);
    expect(inboxPage(' 3 ')).toBe(3);
    expect(inboxPage(['4', '5'])).toBe(4);
    expect(inboxPage('0')).toBe(1);
    expect(inboxPage('-2')).toBe(1);
    expect(inboxPage('1.5')).toBe(1);
    expect(inboxPage('abc')).toBe(1);
    expect(inboxPage('999999')).toBe(10000);
    expect(inboxPage('99999999999')).toBe(1);
  });

  it('links to its pages on the site and the phone pages', () => {
    expect(inboxHref('site')).toBe('/notifications');
    expect(inboxHref('site', 1)).toBe('/notifications');
    expect(inboxHref('site', 2)).toBe('/notifications?page=2');
    expect(inboxHref('app', 3)).toBe('/app/notifications?page=3');
  });

  it('counts its pages, at least one', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(5, 0)).toBe(1);
  });

  it('says how many are unread', () => {
    expect(unreadText(0)).toBe('All read');
    expect(unreadText(1)).toBe('1 unread');
    expect(unreadText(1200)).toBe('1,200 unread');
  });

  it('says when each came: just now, minutes ago, else the day and the 12-hour time in Cairo', () => {
    const now = new Date('2026-10-20T07:05:30Z');
    expect(notificationTime('2026-10-20T07:05:00Z', now)).toBe('Just now');
    expect(notificationTime('2026-10-20T06:53:00Z', now)).toBe('12 min ago');
    expect(notificationTime('2026-10-20T05:00:00Z', now)).toBe(formatDateTime('2026-10-20T05:00:00Z'));
    // Cairo is two hours ahead in January
    expect(notificationTime('2026-01-15T07:05:00Z', now)).toBe('15/01/2026, 9:05 AM');
    // a clock ahead of the phone's: the day and time
    expect(notificationTime('2026-10-20T07:10:00Z', now)).toBe(formatDateTime('2026-10-20T07:10:00Z'));
    expect(notificationTime('not a date', now)).toBe('');
  });

  it('says what it couldn’t load', () => {
    expect(notLoadedText({ kind: 'unavailable' }, 'notifications')).toBe('Notifications aren’t on the server yet. Please try again after its next update.');
    expect(notLoadedText({ kind: 'unavailable' }, 'reminders')).toBe('Reminder settings aren’t on the server yet. Please try again after its next update.');
    expect(notLoadedText({ kind: 'forbidden' }, 'notifications')).toBe('Your notifications can’t be shown here.');
    expect(notLoadedText({ kind: 'failed', messages: ['Cannot reach the server.'] }, 'reminders')).toBe('Your reminder settings couldn’t be loaded. Cannot reach the server.');
  });
});

/** A browser storage in memory, or one that refuses everything (a private window). */
function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const kept = new Map<string, string>();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v), removeItem: (k) => void kept.delete(k) };
}
const blocked: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the phone: Home’s offer and the token kept', () => {
  it('is offered until Not now, then remembered on the phone', () => {
    const storage = memory();
    expect(pushOfferDismissed(storage)).toBe(false);
    dismissPushOffer(storage);
    expect(pushOfferDismissed(storage)).toBe(true);
    expect(storage.getItem(PUSH_OFFER_KEY)).toBe('not-now');
    expect(PUSH_OFFER_KEY).toBe('trendlix-people:push-offer');
  });

  it('is offered, never fails, without storage', () => {
    expect(pushOfferDismissed(null)).toBe(false);
    expect(pushOfferDismissed(blocked)).toBe(false);
    expect(() => dismissPushOffer(blocked)).not.toThrow();
    expect(() => dismissPushOffer(undefined)).not.toThrow();
  });

  it('keeps the token registered, gives it back, and forgets it', () => {
    const storage = memory();
    expect(readPushToken(storage)).toBeNull();
    writePushToken(storage, ' fcm-token-1 ');
    expect(storage.getItem(PUSH_TOKEN_KEY)).toBe('fcm-token-1');
    expect(readPushToken(storage)).toBe('fcm-token-1');
    clearPushToken(storage);
    expect(readPushToken(storage)).toBeNull();
    // nothing to keep
    writePushToken(storage, '   ');
    expect(storage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it('never fails without storage', () => {
    expect(readPushToken(blocked)).toBeNull();
    expect(readPushToken(null)).toBeNull();
    expect(() => writePushToken(blocked, 'fcm-token-1')).not.toThrow();
    expect(() => clearPushToken(blocked)).not.toThrow();
    expect(() => clearPushToken(undefined)).not.toThrow();
  });

  it('takes a token only as one the API takes', () => {
    expect(pushTokenOf(' fcm-token-1 ')).toBe('fcm-token-1');
    expect(pushTokenOf('x'.repeat(PUSH_TOKEN_MAX))).toHaveLength(PUSH_TOKEN_MAX);
    expect(pushTokenOf('x'.repeat(PUSH_TOKEN_MAX + 1))).toBeNull();
    expect(pushTokenOf('')).toBeNull();
    expect(pushTokenOf('   ')).toBeNull();
    expect(pushTokenOf(null)).toBeNull();
    expect(pushTokenOf(42)).toBeNull();
  });
});

describe('turning push on', () => {
  function steps(registered: PushRegistration | Error, saved: { error?: string } | Error = {}) {
    return {
      register: vi.fn(async () => {
        if (registered instanceof Error) throw registered;
        return registered;
      }),
      save: vi.fn(async () => {
        if (saved instanceof Error) throw saved;
        return saved;
      }),
      keep: vi.fn(),
    } satisfies PushTurnOnSteps;
  }

  it('registers the token with the API, then keeps it on the phone', async () => {
    const s = steps({ token: 'fcm-token-1', platform: 'android' });
    await expect(turnOnPushFlow(s)).resolves.toEqual({ kind: 'on' });
    expect(s.save).toHaveBeenCalledWith({ token: 'fcm-token-1', platform: 'android' });
    expect(s.keep).toHaveBeenCalledWith('fcm-token-1');
  });

  it('says how to allow them when the phone refused, and registers nothing', async () => {
    for (const reason of ['denied', 'not_asked'] as const) {
      const s = steps({ reason });
      await expect(turnOnPushFlow(s)).resolves.toEqual({ kind: 'denied' });
      expect(s.save).not.toHaveBeenCalled();
    }
    expect(PUSH_TEXT.denied).toContain('Settings → Apps → Trendlix People → Notifications');
  });

  it('goes quietly when the app can’t', async () => {
    await expect(turnOnPushFlow(steps({ reason: 'unavailable' }))).resolves.toEqual({ kind: 'unavailable' });
  });

  it('says what went wrong on the phone', async () => {
    await expect(turnOnPushFlow(steps({ reason: 'timeout' }))).resolves.toEqual({ kind: 'error', message: PUSH_TEXT.timeout });
    await expect(turnOnPushFlow(steps({ reason: 'failed' }))).resolves.toEqual({ kind: 'error', message: PUSH_TEXT.failed });
    await expect(turnOnPushFlow(steps(new Error('x')))).resolves.toEqual({ kind: 'error', message: PUSH_TEXT.failed });
  });

  it('says the API’s words when it refuses, and keeps no token', async () => {
    const refused = steps({ token: 'fcm-token-1', platform: 'android' }, { error: 'Viewing as Nour Adel: view only.' });
    await expect(turnOnPushFlow(refused)).resolves.toEqual({ kind: 'error', message: 'Viewing as Nour Adel: view only.' });
    expect(refused.keep).not.toHaveBeenCalled();
    const thrown = steps({ token: 'fcm-token-1', platform: 'android' }, new Error('network'));
    await expect(turnOnPushFlow(thrown)).resolves.toEqual({ kind: 'error', message: PUSH_TEXT.failed });
    expect(thrown.keep).not.toHaveBeenCalled();
  });
});
