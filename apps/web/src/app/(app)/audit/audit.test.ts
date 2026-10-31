import { describe, expect, it } from 'vitest';
import {
  apiAuditPath,
  apiExportPath,
  apiExportPathOf,
  auditExcelHref,
  auditHref,
  canSeeAuditLog,
  employeeOptionLabel,
  entriesLabel,
  filtersText,
  historyHref,
  isFiltered,
  maskedText,
  NO_FILTERS,
  opensProfiles,
  rangeText,
  readAuditFilters,
  recordText,
  shown,
  splitChanges,
  userOptionLabel,
  type AuditChange,
  type AuditFrom,
  type AuditOptions,
  browserText,
  ipText,
  ipTitle,
  NO_SIGN_IN_FILTERS,
  placeOf,
  readSignInFilters,
  readTab,
  signInFiltersText,
  signInsExcelHref,
  signInsHref,
  signInsLabel,
  apiSignInsPath,
  isSignInFiltered,
  changedFieldsText,
  refusalOf,
} from './audit';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when").

const MONA = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const as = (...roles: Parameters<typeof canSeeAuditLog>[0]['roles'][number][]) => ({ roles });

describe('who sees the Audit Log', () => {
  it('is the Super Admin and the CEO only', () => {
    expect(canSeeAuditLog(as('super_admin'))).toBe(true);
    expect(canSeeAuditLog(as('ceo'))).toBe(true);
    for (const role of ['hr', 'finance', 'admin', 'manager', 'employee'] as const) expect(canSeeAuditLog(as(role))).toBe(false);
  });

  it('links to a person’s profile for those who open every profile: the CEO, not a Super Admin as such', () => {
    expect(opensProfiles(as('ceo'))).toBe(true);
    expect(opensProfiles(as('super_admin'))).toBe(false);
    expect(opensProfiles(as('super_admin', 'hr'))).toBe(true);
  });
});

describe('the filters in the address', () => {
  it('reads every filter, the days as typed (DD/MM/YYYY) or as links write them', () => {
    const { filters, problems } = readAuditFilters({
      from: '01/10/2026',
      to: '2026-10-31',
      user: USER.toUpperCase(),
      action: 'update',
      type: 'contract',
      record: MONA,
      employee: MONA,
      q: '  CON-2026  ',
      module: 'payroll',
      result: 'refused',
      page: '3',
    });
    expect(problems).toEqual([]);
    expect(filters).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      user: USER,
      action: 'update',
      type: 'contract',
      record: MONA,
      employee: MONA,
      q: 'CON-2026',
      module: 'payroll',
      result: 'refused',
      page: 3,
    });
    expect(isFiltered(filters)).toBe(true);
  });

  it('starts with nothing asked, on the first page', () => {
    expect(readAuditFilters({})).toEqual({ filters: NO_FILTERS, problems: [] });
    expect(isFiltered({ ...NO_FILTERS, page: 4 })).toBe(false);
    expect(readAuditFilters({ page: '0' }).filters.page).toBe(1);
    expect(readAuditFilters({ page: 'two' }).filters.page).toBe(1);
  });

  it('leaves out what isn’t right, and says so', () => {
    const { filters, problems } = readAuditFilters({ from: '31/02/2026', to: '2026-13-01', user: 'mona', record: 'abc', action: 'DROP TABLE', type: 'a-b', module: 'nothing', result: 'maybe' });
    expect(filters).toEqual(NO_FILTERS);
    expect(problems).toEqual([
      'Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.',
      'Enter the last day as DD/MM/YYYY, e.g. 31/10/2026.',
      'Choose who did it from the list.',
      'Enter the record’s id as the system writes it, e.g. 0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e.',
    ]);
  });

  it('drops a last day before the first', () => {
    const { filters, problems } = readAuditFilters({ from: '10/10/2026', to: '01/10/2026' });
    expect(filters).toMatchObject({ from: '2026-10-10', to: '' });
    expect(problems).toEqual(['Choose a first day on or before the last day.']);
  });
});

describe('the links that keep the filters', () => {
  const filters = { ...NO_FILTERS, from: '2026-10-01', user: USER, type: 'contract', q: 'a b', employee: MONA };

  it('asks the API in its own names', () => {
    expect(apiAuditPath(NO_FILTERS)).toBe('/audit');
    expect(apiAuditPath({ ...filters, page: 2 })).toBe(`/audit?from=2026-10-01&userId=${USER}&entityType=contract&employeeId=${MONA}&q=a+b&page=2`);
    expect(apiExportPath({ ...filters, page: 2 })).toBe(`/audit/export?from=2026-10-01&userId=${USER}&entityType=contract&employeeId=${MONA}&q=a+b`);
  });

  it('writes the page’s address with them, and the next page', () => {
    expect(auditHref(NO_FILTERS)).toBe('/audit');
    expect(auditHref(filters, 2)).toBe(`/audit?from=2026-10-01&user=${USER}&type=contract&employee=${MONA}&q=a+b&page=2`);
    expect(auditHref({ ...filters, page: 5 })).not.toContain('page=');
  });

  it('exports what the page shows, every page', () => {
    expect(auditExcelHref(NO_FILTERS)).toBe('/audit/excel');
    expect(auditExcelHref({ ...filters, page: 3 })).toBe(`/audit/excel?from=2026-10-01&user=${USER}&type=contract&employee=${MONA}&q=a+b`);
    // the route reads the page's names back and asks the API in its own
    expect(apiExportPathOf(new URLSearchParams(`from=01/10/2026&user=${USER}&type=contract&employee=${MONA}&q=a+b&page=3`))).toBe(
      `/audit/export?from=2026-10-01&userId=${USER}&entityType=contract&employeeId=${MONA}&q=a+b`,
    );
  });

  it('opens an employee’s History: everything about them', () => {
    expect(historyHref(MONA)).toBe(`/audit?employee=${MONA}`);
  });
});

describe('the entries in words', () => {
  it('says where the page is', () => {
    const entries = Array.from({ length: 50 }, () => ({}) as never);
    expect(rangeText({ page: 1, pageSize: 50, total: 1234, entries })).toBe('Entries 1–50 of 1,234');
    expect(rangeText({ page: 25, pageSize: 50, total: 1234, entries: entries.slice(0, 34) })).toBe('Entries 1,201–1,234 of 1,234');
    expect(rangeText({ page: 1, pageSize: 50, total: 0, entries: [] })).toBe('No entries');
    expect(entriesLabel(1)).toBe('1 entry');
    expect(entriesLabel(12000)).toBe('12,000 entries');
  });

  it('puts the changes from → to apart from the values given', () => {
    const change: AuditChange = { field: 'status', label: 'Status', kind: 'change', from: 'draft', to: 'sent', masked: null };
    const masked: AuditChange = { field: 'grossSalary', label: 'Gross salary', kind: 'change', from: null, to: null, masked: 'changed' };
    const value: AuditChange = { field: 'employeeCode', label: 'Employee code', kind: 'value', from: null, to: 'EMP-0007', masked: null };
    expect(splitChanges([change, value, masked])).toEqual({ changed: [change, masked], values: [value] });
    expect(maskedText('changed')).toBe('Changed, not shown');
    expect(maskedText('set')).toBe('Set, not shown');
    expect(shown(null)).toBe('—');
    expect(shown('Yes')).toBe('Yes');
  });

  it('names the record, the users and the people', () => {
    expect(recordText({ entityLabel: 'Contract', reference: 'CON-2026-0007' })).toBe('Contract CON-2026-0007');
    expect(recordText({ entityLabel: 'Employee', reference: null })).toBe('Employee');
    expect(userOptionLabel({ id: USER, email: 'mona@trendlix.com', name: 'Mona Hassan', active: true })).toBe('Mona Hassan · mona@trendlix.com');
    expect(userOptionLabel({ id: USER, email: 'old@trendlix.com', name: null, active: false })).toBe('old@trendlix.com (inactive)');
    expect(employeeOptionLabel({ id: MONA, employeeCode: 'EMP-0007', fullNameEn: 'Mona Hassan' })).toBe('Mona Hassan · EMP-0007');
  });

  it('says the filters in words over the entries', () => {
    const options: AuditOptions = {
      users: [{ id: USER, email: 'mona@trendlix.com', name: 'Mona Hassan', active: true }],
      actions: [{ value: 'update', label: 'Updated' }],
      entityTypes: [{ value: 'contract', label: 'Contract' }],
      employees: [],
    };
    expect(filtersText(NO_FILTERS, options)).toBe('');
    expect(filtersText({ ...NO_FILTERS, from: '2026-10-01', to: '2026-10-31', user: USER, action: 'update', type: 'contract', q: 'CON' }, options)).toBe(
      'From 01/10/2026 · to 31/10/2026 · by Mona Hassan · Updated · Contract · “CON”',
    );
    expect(filtersText({ ...NO_FILTERS, action: 'update' }, null)).toBe('update');
  });
});

// owner, 31 October 2026: "i want a log for all actions taken on the system ,, same as the one on trendlix website";
// chosen: "Sign-ins tab", "Refused attempts (Result)", "Module filter"; "with location and ip capture"
describe('the module and result filters', () => {
  it('asks the API and keeps them in the address and the export', () => {
    const f = { ...NO_FILTERS, module: 'assets' as const, result: 'refused' as const };
    expect(apiAuditPath(f)).toBe('/audit?module=assets&result=refused');
    expect(auditHref(f)).toBe('/audit?module=assets&result=refused');
    expect(auditExcelHref(f)).toBe('/audit/excel?module=assets&result=refused');
    expect(apiExportPathOf(new URLSearchParams('module=assets&result=succeeded'))).toBe('/audit/export?module=assets&result=succeeded');
    const options = { users: [], actions: [], entityTypes: [], employees: [], modules: [{ value: 'assets', label: 'Assets' }], results: [{ value: 'refused', label: 'Refused' }] };
    expect(filtersText(f, options)).toBe('Assets · Refused');
  });
});

describe('the Sign-ins tab', () => {
  it('is its own tab, with its own filters in the address', () => {
    expect(readTab({ tab: 'sign-ins' })).toBe('sign-ins');
    expect(readTab({})).toBe('activity');
    expect(readTab({ tab: 'other' })).toBe('activity');
    const { filters, problems } = readSignInFilters({ tab: 'sign-ins', from: '01/10/2026', outcome: 'wrong_password', q: ' 41.33 ', page: '2' });
    expect(problems).toEqual([]);
    expect(filters).toEqual({ from: '2026-10-01', to: '', outcome: 'wrong_password', q: '41.33', page: 2 });
    expect(isSignInFiltered(filters)).toBe(true);
    expect(readSignInFilters({ outcome: 'hacked', from: '99/99/2026' })).toEqual({ filters: NO_SIGN_IN_FILTERS, problems: ['Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.'] });
    expect(apiSignInsPath(filters)).toBe('/audit/sign-ins?from=2026-10-01&outcome=wrong_password&q=41.33&page=2');
    expect(signInsHref(filters, 3)).toBe('/audit?tab=sign-ins&from=2026-10-01&outcome=wrong_password&q=41.33&page=3');
    expect(signInsHref(NO_SIGN_IN_FILTERS)).toBe('/audit?tab=sign-ins');
    expect(signInsExcelHref(filters)).toBe('/audit/excel?tab=sign-ins&from=2026-10-01&outcome=wrong_password&q=41.33');
    // the Excel route asks the API for the sign-ins
    expect(apiExportPathOf(new URLSearchParams('tab=sign-ins&outcome=locked_out&page=4'))).toBe('/audit/sign-ins/export?outcome=locked_out');
    expect(signInFiltersText(filters, { users: [], actions: [], entityTypes: [], employees: [], outcomes: [{ value: 'wrong_password', label: 'Wrong password' }] })).toBe(
      'From 01/10/2026 · Wrong password · “41.33”',
    );
    expect(signInsLabel(1)).toBe('1 sign-in');
    expect(signInsLabel(1234)).toBe('1,234 sign-ins');
  });
});

describe('where an entry came from, in words', () => {
  const from: AuditFrom = { ip: '41.33.10.2', ipSource: 'website', place: 'Cairo, Egypt', country: 'EG', region: 'C', city: 'Cairo', userAgent: 'UA', browser: 'Chrome 141 on macOS', location: null };

  it('says the address, the place and the browser', () => {
    expect([ipText(from), ipTitle(from), placeOf(from), browserText(from)]).toEqual([
      '41.33.10.2',
      'The visitor’s address, as the website saw it',
      { text: 'Cairo, Egypt', href: null, mock: false },
      'Chrome 141 on macOS',
    ]);
    expect(ipTitle({ ...from, ipSource: 'connection' })).toBe('The connection’s own address');
    expect([ipText(undefined), placeOf(undefined).text, browserText(undefined)]).toEqual(['—', '—', '—']);
  });

  it('shows the app’s position on Google Maps, flagged when made up', () => {
    const app = { ...from, place: null, location: { latitude: 30.04442, longitude: 31.235712, accuracyMetres: 1200, mock: true } };
    expect(placeOf(app)).toEqual({ text: 'Phone location ±1,200 m', href: 'https://www.google.com/maps?q=30.044420,31.235712', mock: true });
    expect(placeOf({ ...app, location: { ...app.location, accuracyMetres: null, mock: false } }).text).toBe('Phone location');
  });
});

describe('an entry summed up', () => {
  const line = (field: string, kind: 'change' | 'value', to: string | null = null): AuditChange => ({ field, label: field[0].toUpperCase() + field.slice(1), kind, from: null, to, masked: null });

  it('names the fields a change changed, a few at most', () => {
    expect(changedFieldsText([line('grade', 'change'), line('status', 'change'), line('note', 'value')])).toBe('Grade, Status');
    expect(changedFieldsText(['a', 'b', 'c', 'd', 'e', 'f'].map((f) => line(f, 'change')))).toBe('A, B, C and 3 more');
    expect(changedFieldsText(['a', 'b', 'c', 'd'].map((f) => line(f, 'change')))).toBe('A, B, C, D');
    expect(changedFieldsText([line('name', 'value')])).toBe('');
  });

  it('says why a refused one was refused and what was tried', () => {
    const changes = [line('method', 'value', 'POST'), line('path', 'value', '/api/departments'), line('status', 'value', '403'), line('message', 'value', 'Not allowed.')];
    expect(refusalOf({ result: 'refused', changes })).toEqual({ why: 'Not allowed.', tried: 'POST /api/departments → 403' });
    expect(refusalOf({ result: 'refused', changes: [line('reason', 'value', 'off_network')] })).toEqual({ why: 'off_network', tried: null });
    expect(refusalOf({ result: 'succeeded', changes })).toBeNull();
  });
});
