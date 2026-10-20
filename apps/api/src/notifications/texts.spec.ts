import { NOTIFICATION_BODY_MAX, NOTIFICATION_TITLE_MAX, zonedMoment } from '@trendlix/shared';
import { keptNotification } from './notifications.service.js';
import {
  cancelledByHrText,
  checkInReminderText,
  checkOutReminderText,
  claimDecidedText,
  claimPaidText,
  daysText,
  decidedText,
  payRaiseDecidedText,
  payRaiseWaitingText,
  payslipText,
  raiseRequestWaitingText,
  TEXT_KINDS,
  waitingText,
} from './texts.js';

// What the notifications say (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md, Phase 4): short
// and general, names and dates (DD/MM/YYYY, 12-hour times), never a salary, an amount, a reason or a comment.

describe('notification texts', () => {
  it('says the days of a request', () => {
    expect(daysText('2026-10-22', '2026-10-23')).toBe('22/10/2026–23/10/2026');
    expect(daysText('2026-10-22', '2026-10-22')).toBe('22/10/2026');
    expect(daysText('2026-10-22', '2026-10-22', true)).toBe('22/10/2026 (half day)');
  });

  it('tells the one in charge what waits for them, by whom and when', () => {
    expect(waitingText('leave', 'Mona Adel', '22/10/2026–23/10/2026', '/leave/1')).toEqual({
      kind: 'leave_waiting',
      title: 'A leave request is waiting for you',
      body: 'Mona Adel, 22/10/2026–23/10/2026',
      link: '/leave/1',
    });
    expect(waitingText('permission', 'Mona Adel', '22/10/2026', '/l').title).toBe('A permission request is waiting for you');
    expect(waitingText('correction', 'Mona Adel', '19/10/2026', '/l').title).toBe('An attendance correction is waiting for you');
    expect(waitingText('reimbursement', 'Mona Adel', '18/10/2026', '/l')).toMatchObject({ kind: 'reimbursement_waiting', title: 'A reimbursement claim is waiting for you' });
    expect(raiseRequestWaitingText('Mona Adel', '/raise-requests?status=with_hr')).toEqual({
      kind: 'raise_request_waiting',
      title: 'A raise request is waiting for you',
      body: 'Mona Adel',
      link: '/raise-requests?status=with_hr',
    });
    expect(payRaiseWaitingText('Mona Adel', '/approvals')).toMatchObject({ kind: 'pay_raise_waiting', title: 'A raise is waiting for your approval', body: 'Mona Adel' });
  });

  it('tells the employee their own news', () => {
    expect(decidedText('leave', 'approved', '22/10/2026', '/leave/1')).toEqual({ kind: 'leave_decided', title: 'Leave request approved', body: '22/10/2026', link: '/leave/1' });
    expect(decidedText('permission', 'rejected', '22/10/2026', '/l').title).toBe('Permission request rejected');
    expect(decidedText('correction', 'approved', '19/10/2026', '/l')).toMatchObject({ kind: 'correction_decided', title: 'Attendance correction approved' });
    expect(cancelledByHrText('leave', '22/10/2026', '/l')).toMatchObject({ kind: 'leave_decided', title: 'Leave cancelled by HR' });
    expect(cancelledByHrText('permission', '22/10/2026', '/l').title).toBe('Permission cancelled by HR');
    expect(claimDecidedText({ approved: true, payMonth: '2026-10-01' }, '/r')).toEqual({
      kind: 'reimbursement_decided',
      title: 'Reimbursement claim approved',
      body: 'To be paid with the October 2026 payroll',
      link: '/r',
    });
    expect(claimDecidedText({ approved: false, expenseDate: '2026-10-18' }, '/r')).toMatchObject({ title: 'Reimbursement claim rejected', body: 'Your claim of 18/10/2026' });
    expect(claimPaidText('2026-10', '/r')).toMatchObject({ kind: 'reimbursement_paid', title: 'Reimbursement paid', body: 'Paid with the October 2026 payroll' });
    expect(payslipText('2026-10', '2026-10-31', '/app/payslips/l1')).toEqual({ kind: 'payslip_issued', title: 'Your October 2026 payslip is ready', body: 'Paid on 31/10/2026', link: '/app/payslips/l1' });
    expect(payRaiseDecidedText('approved', 'Mona Adel', '/x').title).toBe('Raise approved by the CEO');
    expect(payRaiseDecidedText('rejected', 'Mona Adel', '/x').title).toBe('Raise rejected by the CEO');
    expect(payRaiseDecidedText('returned', 'Mona Adel', '/x').title).toBe('Raise returned to HR by the CEO');
  });

  it('reminds on the 12-hour clock, in Cairo', () => {
    expect(checkInReminderText('09:00', '/my-attendance')).toEqual({
      kind: 'check_in_reminder',
      title: 'You haven’t checked in',
      body: 'Your shift started at 9:00 AM. Check in when you start work.',
      link: '/my-attendance',
    });
    expect(checkOutReminderText(new Date(zonedMoment('2026-10-20', '09:05')), '/my-attendance')).toMatchObject({
      kind: 'check_out_reminder',
      title: 'Still checked in?',
      body: 'You checked in at 9:05 AM. Check out when you leave.',
    });
  });

  it('every text fits what the inbox keeps, its kind is one the database takes, and it carries no figure', () => {
    const all = [
      waitingText('leave', 'A Very Long Name '.repeat(20), daysText('2026-10-22', '2026-10-23'), '/leave/1'),
      decidedText('leave', 'approved', '22/10/2026', '/l'),
      claimDecidedText({ approved: true, payMonth: '2026-10-01' }, '/r'),
      claimPaidText('2026-10', '/r'),
      payslipText('2026-10', null, '/app/payslips/l1'),
      checkInReminderText('21:30', '/my-attendance'),
    ];
    for (const n of all) {
      const kept = keptNotification(n)!;
      expect(TEXT_KINDS).toContain(kept.kind);
      expect(kept.title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
      expect(kept.body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
      expect(`${kept.title} ${kept.body}`).not.toMatch(/EGP|\d+\.\d{2}|salary/i);
    }
    expect(keptNotification({ kind: 'salary' as never, title: 't', body: 'b' })).toBeNull();
    expect(keptNotification({ kind: 'leave_waiting', title: '  ', body: 'b' })).toBeNull();
    expect(keptNotification({ kind: 'leave_waiting', title: 't', body: 'b', link: 'https://evil.example' })?.link).toBeNull();
  });
});
