import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_CORRECTIONS_PATH as CORRECTIONS_PATH } from '../app/(app)/attendance/sections';
import { DETAILS_CHANGES_PATH, LEAVE_PATH, MY_REQUESTS, NAV, navFor, RAISE_REQUESTS_PATH, REIMBURSEMENTS_PATH } from './nav';
import {
  groupCount,
  groupHolding,
  groupKey,
  groupListId,
  GROUPS_STORAGE_KEY,
  isGroup,
  isGroupOpen,
  NOTHING_REMEMBERED,
  remember,
} from './nav-groups';

// owner, 20 October 2026: "make the side menu subs expandable - which means requests with an arrow beside it to expand
// and collapse the side menues"
const sidebar = (...roles: Role[]) => navFor({ roles, employeeId: 'x' });
const ROLES: Role[][] = [['hr'], ['ceo'], ['finance'], ['admin'], ['super_admin'], ['employee'], ['employee', 'manager'], ['admin', 'finance']];

describe('the headings that open and close', () => {
  it('are the items with pages under them, each with its own key and list id; Home and Organization stay links', () => {
    expect(NAV.filter(isGroup).map((item) => [item.label, groupKey(item)])).toEqual([
      ['People', 'people'],
      // recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"), with the job offers
      ['Recruitment', 'recruitment'],
      ['Payroll', 'payroll'],
      ['Requests', 'requests'],
      ['Attendance', 'attendance'],
      // owner, 21 October 2026: the KPIs, then Assets (for those with Assets access)
      ['KPIs', 'kpis'],
      ['Assets', 'assets'],
      // Templates was one until it moved to Organization's setup menu (23 October 2026)
    ]);
    // WhatsApp Messages, last (owner, 24 October 2026: "how to make whatsapp notifications?")
    expect(NAV.filter((item) => !isGroup(item)).map((item) => item.label)).toEqual(['Home', 'Organization', 'Approvals', 'Users', 'Audit Log', 'WhatsApp Messages']);
    expect(groupListId('requests')).toBe('nav-group-requests');
    expect(groupKey({ label: ' Leave & Attendance ' })).toBe('leave-attendance');
    // an employee's own sidebar has the KPIs' alone (owner, 21 October 2026)
    expect(sidebar('employee', 'manager').filter(isGroup).map((item) => item.label)).toEqual(['KPIs']);
  });

  it('keep the page each heading linked to reachable as its first item, for everyone', () => {
    for (const roles of ROLES) {
      for (const item of sidebar(...roles).filter(isGroup)) expect(item.items[0].href).toBe(item.href);
    }
  });

  it('know which heading holds a page', () => {
    const items = sidebar('hr');
    expect(groupHolding(items, '/employees')).toBe('people');
    expect(groupHolding(items, '/employees/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')).toBe('people');
    expect(groupHolding(items, '/contracts/calculator')).toBe('people');
    expect(groupHolding(items, '/offers/new')).toBe('recruitment');
    expect(groupHolding(items, '/recruitment/applicants/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')).toBe('recruitment');
    expect(groupHolding(items, '/payroll')).toBe('payroll');
    expect(groupHolding(items, '/payroll/unsettled')).toBe('payroll');
    // an import's review is on its payroll run, under Payroll
    expect(groupHolding(items, '/payroll/0b8f/attendance/1c9e')).toBe('payroll');
    expect(groupHolding(items, RAISE_REQUESTS_PATH)).toBe('requests');
    expect(groupHolding(items, DETAILS_CHANGES_PATH)).toBe('requests');
    expect(groupHolding(items, '/reimbursements/new')).toBe('requests');
    expect(groupHolding(items, '/leave/record')).toBe('requests');
    expect(groupHolding(items, '/attendance/summary')).toBe('attendance');
    expect(groupHolding(items, CORRECTIONS_PATH)).toBe('attendance');
    for (const page of ['/', '/organization/company', '/approvals', '/leaves', '/raise-requestsx', '/my-requests']) expect(groupHolding(items, page)).toBeNull();
    // the document templates are a page of Organization, a link (23 October 2026); the KPI templates are the KPIs'
    expect(groupHolding(sidebar('super_admin'), '/organization/templates/tags')).toBeNull();
    expect(groupHolding(sidebar('super_admin'), '/kpis/templates')).toBe('kpis');
    expect(groupHolding(items, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe('kpis');
    expect(groupHolding(sidebar('employee'), '/kpis')).toBe('kpis');
    expect(groupHolding(sidebar('employee'), MY_REQUESTS)).toBeNull();
  });
});

// owner, 24 October 2026: "on login and refresh make sure all items are collapsed"
describe('the headings opened since the page was loaded', () => {
  it('starts every heading closed, the one holding the page too', () => {
    for (const key of ['people', 'payroll', 'requests', 'attendance', 'kpis', 'assets']) expect(isGroupOpen(key, NOTHING_REMEMBERED)).toBe(false);
  });

  it('opens a heading the user opened, and closes it again when they close it', () => {
    const opened = remember(NOTHING_REMEMBERED, 'payroll', true);
    expect(isGroupOpen('payroll', opened)).toBe(true);
    expect(isGroupOpen('requests', opened)).toBe(false);
    expect(isGroupOpen('payroll', remember(opened, 'payroll', false))).toBe(false);
  });

  it('keeps each choice, leaving what was chosen before as it was', () => {
    const before = remember(NOTHING_REMEMBERED, 'payroll', true);
    const after = remember(before, 'requests', true);
    expect(after).toEqual({ payroll: true, requests: true });
    expect(before).toEqual({ payroll: true });
    expect(remember(after, 'payroll', false)).toEqual({ payroll: false, requests: true });
  });

  it('names the key earlier versions kept in the browser, so it can be cleared', () => {
    expect(GROUPS_STORAGE_KEY).toBe('trendlix-people:sidebar-groups');
  });
});

describe('the count a closed heading shows', () => {
  it('adds up its pages’ counts, so nothing waiting is hidden', () => {
    const counts = { [RAISE_REQUESTS_PATH]: 2, [LEAVE_PATH]: 1, [REIMBURSEMENTS_PATH]: 4, '/approvals': 5, [CORRECTIONS_PATH]: 3 };
    const of = (label: string, ...roles: Role[]) => groupCount(sidebar(...roles).find((item) => item.label === label)!, counts);
    expect(of('Requests', 'hr')).toBe(7);
    expect(of('Attendance', 'hr')).toBe(3);
    expect(of('Payroll', 'hr')).toBe(0);
    expect(of('People', 'hr')).toBe(0);
  });

  it('counts only the pages the user sees under it', () => {
    const counts = { [DETAILS_CHANGES_PATH]: 6, [RAISE_REQUESTS_PATH]: 2, [CORRECTIONS_PATH]: 3 };
    const of = (label: string, ...roles: Role[]) => groupCount(sidebar(...roles).find((item) => item.label === label)!, counts);
    // Finance has no Details Changes, nor Corrections
    expect(of('Requests', 'finance')).toBe(2);
    expect(of('Attendance', 'finance')).toBe(0);
    expect(of('Requests', 'admin')).toBe(6);
    // the KPIs (owner, 21 October 2026): their own, their team's and HR's, as each sees them
    const kpis = { '/kpis': 1, '/kpis/team': 2, '/kpis/all': 4 };
    const kpisOf = (...roles: Role[]) => groupCount(sidebar(...roles).find((item) => item.label === 'KPIs')!, kpis);
    expect(kpisOf('hr')).toBe(5);
    expect(kpisOf('employee', 'manager')).toBe(3);
    expect(kpisOf('ceo')).toBe(7);
    expect(kpisOf('employee')).toBe(1);
  });

  it('is nothing without counts', () => {
    const requests = sidebar('hr').find((item) => item.label === 'Requests')!;
    expect(groupCount(requests, undefined)).toBe(0);
    expect(groupCount(requests, {})).toBe(0);
    expect(groupCount({}, { [RAISE_REQUESTS_PATH]: 2 })).toBe(0);
  });
});
