import { describe, expect, it } from 'vitest';
import {
  afterAction,
  appAttendanceHref,
  appBack,
  appCorrectionHref,
  appItemHref,
  appPayslipHref,
  appPayslipPdfHref,
  appRaiseHref,
  appSectionOf,
  isAppSection,
  SURFACE_FIELD,
  toAppHref,
} from './surface';

const ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe('the section a form was sent from', () => {
  it('knows the phone pages’ sections only', () => {
    expect(isAppSection('requests')).toBe(true);
    expect(isAppSection('approve')).toBe(true);
    expect(isAppSection('site')).toBe(false);
    expect(isAppSection('https://evil.example')).toBe(false);
    expect(isAppSection(null)).toBe(false);
  });

  it('reads the hidden field, the site without one or with one it doesn’t know', () => {
    expect(appSectionOf(form({ [SURFACE_FIELD]: 'requests' }))).toBe('requests');
    expect(appSectionOf(form({ [SURFACE_FIELD]: 'approve' }))).toBe('approve');
    expect(appSectionOf(form({ [SURFACE_FIELD]: '//evil.example' }))).toBeNull();
    expect(appSectionOf(form({}))).toBeNull();
    expect(appSectionOf(null)).toBeNull();
  });
});

describe('the phone pages’ addresses', () => {
  it('opens an item in its section', () => {
    expect(appItemHref('requests', 'leave', ID)).toBe(`/app/requests/leave/${ID}`);
    expect(appItemHref('approve', 'pay-raise', ID)).toBe(`/app/approve/pay-raise/${ID}`);
    expect(appItemHref('requests', 'kpi', ID)).toBe(`/app/requests/kpi/${ID}`);
    expect(appItemHref('approve', 'kpi', ID)).toBe(`/app/approve/kpi/${ID}`);
  });

  it('goes back to the section’s list', () => {
    expect(appBack('requests')).toEqual({ href: '/app/requests', label: 'My Requests' });
    expect(appBack('approve')).toEqual({ href: '/app/approve', label: 'To Approve' });
  });

  it('keeps a month, a day and a person only when they are one', () => {
    expect(appAttendanceHref('2026-10')).toBe('/app/attendance?month=2026-10');
    expect(appAttendanceHref('2026-13')).toBe('/app/attendance');
    expect(appAttendanceHref(null)).toBe('/app/attendance');
    expect(appCorrectionHref('2026-10-19')).toBe('/app/requests/new/correction?date=2026-10-19');
    expect(appCorrectionHref('19/10/2026')).toBe('/app/requests/new/correction');
    expect(appRaiseHref(ID)).toBe(`/app/requests/new/raise?employee=${ID}`);
    expect(appRaiseHref(null)).toBe('/app/requests/new/raise');
  });

  it('opens a payslip in the page, and its PDF', () => {
    expect(appPayslipHref(ID)).toBe(`/app/payslips/${ID}`);
    expect(appPayslipHref(ID, 'ar')).toBe(`/app/payslips/${ID}?language=ar`);
    expect(appPayslipPdfHref(ID, 'en')).toBe(`/app/payslips/${ID}/en`);
    expect(appPayslipPdfHref(ID, 'ar', true)).toBe(`/app/payslips/${ID}/ar?download=1`);
  });
});

describe('where an action sends someone on to from the phone pages', () => {
  it('opens the same request in the section, with what was done', () => {
    expect(toAppHref(`/leave/${ID}?done=sent`, 'requests')).toBe(`/app/requests/leave/${ID}?done=sent`);
    expect(toAppHref(`/leave/permissions/${ID}?done=manager_approve`, 'approve')).toBe(`/app/approve/permission/${ID}?done=manager_approve`);
    expect(toAppHref(`/reimbursements/${ID}?done=cancelled`, 'requests')).toBe(`/app/requests/reimbursement/${ID}?done=cancelled`);
    expect(toAppHref(`/attendance/corrections/${ID}?done=hr_reject`, 'approve')).toBe(`/app/approve/correction/${ID}?done=hr_reject`);
    // a home location (20 October 2026)
    expect(toAppHref(`/home-locations/${ID}?done=sent`, 'requests')).toBe(`/app/requests/home/${ID}?done=sent`);
    expect(toAppHref(`/home-locations/${ID}?done=ceo_approve`, 'approve')).toBe(`/app/approve/home/${ID}?done=ceo_approve`);
    expect(toAppHref('/home-locations/new', 'requests')).toBe('/app/requests');
    // a KPI scorecard (21 October 2026): the employee's under My Requests, the manager's and HR's under To Approve
    expect(toAppHref(`/kpis/scorecards/${ID}?done=self_sent`, 'requests')).toBe(`/app/requests/kpi/${ID}?done=self_sent`);
    expect(toAppHref(`/kpis/scorecards/${ID}?done=calibrated`, 'approve')).toBe(`/app/approve/kpi/${ID}?done=calibrated`);
    expect(toAppHref(`/kpis/scorecards/${ID}`, 'approve')).toBe(`/app/approve/kpi/${ID}`);
    // a compensatory day request (26 October 2026): sent, decided or moved on, in the section; its other pages the list
    expect(toAppHref(`/attendance/compensatory/${ID}?done=sent`, 'requests')).toBe(`/app/requests/compensatory/${ID}?done=sent`);
    expect(toAppHref(`/attendance/compensatory/${ID}?done=hr_approve`, 'approve')).toBe(`/app/approve/compensatory/${ID}?done=hr_approve`);
    expect(toAppHref(`/attendance/compensatory/${ID}?done=moved`, 'approve')).toBe(`/app/approve/compensatory/${ID}?done=moved`);
    expect(toAppHref('/my-requests#my-compensatory', 'requests')).toBe('/app/requests');
    expect(toAppHref('/attendance/compensatory/new', 'requests')).toBe('/app/requests');
    expect(toAppHref('/attendance/compensatory/record', 'approve')).toBe('/app/approve');
    expect(appItemHref('approve', 'compensatory', ID)).toBe(`/app/approve/compensatory/${ID}`);
    // the KPI lists aren't phone pages: the section's list
    expect(toAppHref('/kpis/team', 'approve')).toBe('/app/approve');
    expect(toAppHref('/kpis/scorecards/not-an-id', 'requests')).toBe('/app/requests');
  });

  it('sends everything else to the section’s list, keeping only done and sent', () => {
    expect(toAppHref('/my-requests?kind=raise&sent=1', 'requests')).toBe('/app/requests?sent=1');
    expect(toAppHref('/raise-requests?sent=1', 'requests')).toBe('/app/requests?sent=1');
    expect(toAppHref('/approvals?done=raise-approved', 'approve')).toBe('/app/approve?done=raise-approved');
    expect(toAppHref('/raise-requests?status=with_ceo&done=raise-returned', 'approve')).toBe('/app/approve?done=raise-returned');
    expect(toAppHref('/my-requests#my-leave', 'requests')).toBe('/app/requests');
    expect(toAppHref('/leave/new', 'requests')).toBe('/app/requests');
    expect(toAppHref('/my-attendance', 'requests')).toBe('/app/requests');
  });

  it('leaves the site’s own forms on the site', () => {
    expect(afterAction(form({}), `/leave/${ID}?done=sent`)).toBe(`/leave/${ID}?done=sent`);
    expect(afterAction(undefined, '/my-requests')).toBe('/my-requests');
    expect(afterAction(form({ [SURFACE_FIELD]: 'requests' }), `/leave/${ID}?done=sent`)).toBe(`/app/requests/leave/${ID}?done=sent`);
    // a KPI step sent from the phone pages comes back to the scorecard there
    expect(afterAction(form({ [SURFACE_FIELD]: 'approve' }), `/kpis/scorecards/${ID}?done=score_sent`)).toBe(`/app/approve/kpi/${ID}?done=score_sent`);
    expect(afterAction(form({}), `/kpis/scorecards/${ID}?done=signed`)).toBe(`/kpis/scorecards/${ID}?done=signed`);
  });
});
