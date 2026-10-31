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
  homeDecidedText,
  homeWaitingText,
  kpiManagerSignText,
  kpiOpenText,
  kpiReadyToSignText,
  kpiReminderText,
  kpiWaitingText,
  payRaiseDecidedText,
  payRaiseWaitingText,
  payslipText,
  photoRequestDecidedText,
  photoRequestWaitingText,
  raiseRequestWaitingText,
  TEXT_KINDS,
  waitingText,
} from './texts.js';

// What the notifications say (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md, Phase 4): short
// and general, names and dates (DD/MM/YYYY, 12-hour times), never a salary, an amount, a reason or a comment.

describe('notification texts', () => {
  it('says a KPI step in a few words, never a score (21 October 2026)', () => {
    expect(kpiOpenText('2026-10', '2026-11-03', '/k')).toMatchObject({ kind: 'kpi_self_rating', title: 'Your October KPI is open', body: 'Rate yourself by 03/11/2026' });
    expect(kpiReadyToSignText('2026-10', '2026-11-10', '/k')).toMatchObject({ kind: 'kpi_ready_to_sign', title: 'Your October KPI is ready to sign', body: 'Sign by 10/11/2026' });
    expect(kpiWaitingText('Mona Adel', '2026-10', '/k')).toMatchObject({ kind: 'kpi_waiting', title: 'A KPI scorecard is waiting for you', body: 'Mona Adel, October 2026' });
    expect(kpiManagerSignText('Mona Adel', '2026-10', '/k')).toMatchObject({ kind: 'kpi_waiting', title: 'A KPI scorecard is ready for you to sign' });
    expect(kpiReminderText('manager', { own: false, count: 1 }, '2026-11-06', '/k').title).toBe('A KPI scorecard to score by tomorrow');
    expect(kpiReminderText('hr', { own: false, count: 4 }, '2026-11-08', '/k').title).toBe('4 KPI scorecards to calibrate by tomorrow');
    expect(kpiReminderText('self_rating', { own: true, month: '2026-10' }, '2026-11-03', '/k')).toMatchObject({ kind: 'kpi_self_rating', title: 'Your October KPI: rate yourself by tomorrow', body: 'Due 03/11/2026' });
  });

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

  it('tells of a home location by name and the day it was asked: never its point, label or comment', () => {
    expect(homeWaitingText('Mona Adel', '2026-10-20', '/home-locations/h1')).toEqual({
      kind: 'home_location_waiting',
      title: 'A home location is waiting for you',
      body: 'Mona Adel, asked on 20/10/2026',
      link: '/home-locations/h1',
    });
    expect(homeDecidedText('first_step', '2026-10-20', '/home-locations/h1')).toEqual({
      kind: 'home_location_decided',
      title: 'Home location approved by HR',
      body: 'Your request of 20/10/2026 is with the CEO now',
      link: '/home-locations/h1',
    });
    // a C-level person's first step is the CEO's
    expect(homeDecidedText('first_step', '2026-10-20', '/h', 'the CEO').title).toBe('Home location approved by the CEO');
    expect(homeDecidedText('approved', '2026-10-20', '/h')).toMatchObject({ title: 'Home location approved', body: 'Your request of 20/10/2026' });
    expect(homeDecidedText('rejected', '2026-10-20', '/h')).toMatchObject({ title: 'Home location rejected', body: 'Your request of 20/10/2026' });
  });

  it('reminds on the 12-hour clock, in Cairo', () => {
    expect(checkInReminderText('09:00', '/my-attendance')).toEqual({
      kind: 'check_in_reminder',
      title: 'You haven’t checked in',
      body: 'Your shift started at 9:00 AM. Check in now.',
      link: '/my-attendance',
    });
    expect(checkOutReminderText(new Date(zonedMoment('2026-10-20', '09:05')), '/my-attendance')).toMatchObject({
      kind: 'check_out_reminder',
      title: 'Still checked in?',
      body: 'You checked in at 9:05 AM. Check out when you leave.',
    });
  });

  it('tells those who decide a new photo whose it is, and the employee what was decided (31 October 2026)', () => {
    expect(photoRequestWaitingText('Mona Adel', '/approvals')).toEqual({ kind: 'photo_request_waiting', title: 'A new photo is waiting for you', body: 'Mona Adel', link: '/approvals' });
    expect(photoRequestDecidedText('approved', '/employees/e1/photo')).toMatchObject({ kind: 'photo_request_decided', title: 'Your new photo was approved' });
    expect(photoRequestDecidedText('rejected', '/employees/e1/photo')).toMatchObject({ title: 'Your new photo was rejected', body: 'HR kept your current photo. Open it to see why.' });
  });

  it('every text fits what the inbox keeps, its kind is one the database takes, and it carries no figure', () => {
    const all = [
      waitingText('leave', 'A Very Long Name '.repeat(20), daysText('2026-10-22', '2026-10-23'), '/leave/1'),
      decidedText('leave', 'approved', '22/10/2026', '/l'),
      claimDecidedText({ approved: true, payMonth: '2026-10-01' }, '/r'),
      claimPaidText('2026-10', '/r'),
      payslipText('2026-10', null, '/app/payslips/l1'),
      homeWaitingText('A Very Long Name '.repeat(20), '2026-10-20', '/home-locations/h1'),
      homeDecidedText('first_step', '2026-10-20', '/home-locations/h1', 'the CEO'),
      checkInReminderText('21:30', '/my-attendance'),
      // KPIs (21 October 2026): no score in them
      kpiOpenText('2026-10', '2026-11-03', '/kpis/scorecards/k1'),
      kpiWaitingText('A Very Long Name '.repeat(20), '2026-10', '/kpis/scorecards/k1'),
      kpiReadyToSignText('2026-10', '2026-11-10', '/kpis/scorecards/k1'),
      kpiManagerSignText('Mona Adel', '2026-10', '/kpis/scorecards/k1'),
      kpiReminderText('manager', { own: false, count: 3 }, '2026-11-06', '/kpis/team'),
      kpiReminderText('sign_off', { own: true, month: '2026-10' }, '2026-11-10', '/kpis/scorecards/k1'),
      // a new photo the employee sends HR (31 October 2026): a name, never the photo or HR's note
      photoRequestWaitingText('A Very Long Name '.repeat(20), '/approvals'),
      photoRequestDecidedText('approved', '/employees/e1/photo'),
      photoRequestDecidedText('rejected', '/employees/e1/photo'),
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
