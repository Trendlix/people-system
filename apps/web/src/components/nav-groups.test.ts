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
  OPEN_REMEMBERED_SCRIPT,
  parseRemembered,
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
      ['Payroll', 'payroll'],
      ['Requests', 'requests'],
      ['Attendance', 'attendance'],
      // owner, 21 October 2026: the KPIs
      ['KPIs', 'kpis'],
      ['Templates', 'templates'],
    ]);
    expect(NAV.filter((item) => !isGroup(item)).map((item) => item.label)).toEqual(['Home', 'Organization', 'Approvals', 'Users', 'Audit Log']);
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
    expect(groupHolding(items, '/offers/new')).toBe('people');
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
    expect(groupHolding(sidebar('super_admin'), '/templates/tags')).toBe('templates');
    // the KPI templates are the KPIs', not the document templates'
    expect(groupHolding(sidebar('super_admin'), '/kpis/templates')).toBe('kpis');
    expect(groupHolding(items, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe('kpis');
    expect(groupHolding(sidebar('employee'), '/kpis')).toBe('kpis');
    expect(groupHolding(sidebar('employee'), MY_REQUESTS)).toBeNull();
  });
});

describe('what the browser remembers', () => {
  it('reads only headings opened or closed, and nothing from anything else', () => {
    expect(parseRemembered('{"payroll":true,"requests":false}')).toEqual({ payroll: true, requests: false });
    expect(parseRemembered('{"payroll":true,"people":"yes","attendance":1,"templates":null}')).toEqual({ payroll: true });
    for (const raw of [null, undefined, '', 'not json', '[]', '[true]', 'null', 'true', '3', '"payroll"', '{}', '{"payroll":"true"}']) {
      expect(parseRemembered(raw)).toBe(NOTHING_REMEMBERED);
    }
  });

  it('keeps each choice, leaving what was remembered before as it was', () => {
    const before = parseRemembered('{"payroll":true}');
    const after = remember(before, 'requests', true);
    expect(after).toEqual({ payroll: true, requests: true });
    expect(before).toEqual({ payroll: true });
    expect(remember(after, 'payroll', false)).toEqual({ payroll: false, requests: true });
    expect(parseRemembered(JSON.stringify(remember(after, 'payroll', false)))).toEqual({ payroll: false, requests: true });
    expect(GROUPS_STORAGE_KEY).toBe('trendlix-people:sidebar-groups');
  });

  it('opens the heading holding the page, even one closed before, until the user closes it on the page', () => {
    const remembered = { requests: false };
    expect(isGroupOpen('requests', { holding: 'requests', remembered })).toBe(true);
    expect(isGroupOpen('requests', { holding: 'requests', remembered, closedHere: 'requests' })).toBe(false);
    expect(isGroupOpen('requests', { holding: 'requests', remembered: NOTHING_REMEMBERED, closedHere: null })).toBe(true);
  });

  it('starts every other heading closed, then as the user left it', () => {
    expect(isGroupOpen('payroll', { holding: 'requests', remembered: NOTHING_REMEMBERED })).toBe(false);
    expect(isGroupOpen('payroll', { holding: null, remembered: NOTHING_REMEMBERED })).toBe(false);
    expect(isGroupOpen('payroll', { holding: 'requests', remembered: { payroll: true } })).toBe(true);
    expect(isGroupOpen('payroll', { holding: null, remembered: { payroll: false } })).toBe(false);
    // closing the one holding the page doesn't close another
    expect(isGroupOpen('payroll', { holding: 'requests', remembered: { payroll: true }, closedHere: 'requests' })).toBe(true);
  });
});

describe('the script that opens the remembered headings as the page arrives', () => {
  /** Runs the script on buttons (key → aria-expanded), with the storage holding `raw` (a function: it throws). */
  function run(buttons: Record<string, string>, raw: string | null | (() => never)) {
    const shown = Object.entries(buttons).map(([key, expanded]) => {
      const attrs: Record<string, string> = { 'data-nav-group': key, 'aria-expanded': expanded };
      return { attrs, getAttribute: (name: string) => attrs[name] ?? null, setAttribute: (name: string, value: string) => void (attrs[name] = value) };
    });
    const storage = { getItem: (key: string) => (typeof raw === 'function' ? raw() : key === GROUPS_STORAGE_KEY ? raw : null) };
    const document = { querySelectorAll: (selector: string) => (selector === 'button[data-nav-group]' ? shown : []) };
    new Function('localStorage', 'document', OPEN_REMEMBERED_SCRIPT)(storage, document);
    return Object.fromEntries(shown.map((b) => [b.attrs['data-nav-group'], b.attrs['aria-expanded']]));
  }

  it('opens the ones opened last and leaves the rest as the server drew them, as the menu does once it runs', () => {
    const page = { people: 'false', payroll: 'false', requests: 'true', attendance: 'false' };
    expect(run(page, '{"payroll":true,"requests":false,"attendance":"yes"}')).toEqual({ people: 'false', payroll: 'true', requests: 'true', attendance: 'false' });
    // the same as the menu: open where isGroupOpen is, for the page holding Requests
    const remembered = parseRemembered('{"payroll":true,"requests":false,"attendance":"yes"}');
    expect(Object.keys(page).filter((key) => isGroupOpen(key, { holding: 'requests', remembered }))).toEqual(['payroll', 'requests']);
  });

  it('changes nothing without anything remembered, or when the storage is refused', () => {
    const page = { people: 'false', payroll: 'true' };
    for (const raw of [null, '', 'not json', 'null', '[]', '{"people":1}']) expect(run(page, raw)).toEqual(page);
    expect(
      run(page, () => {
        throw new Error('SecurityError');
      }),
    ).toEqual(page);
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
