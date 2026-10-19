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
  type AuditOptions,
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
      page: '3',
    });
    expect(problems).toEqual([]);
    expect(filters).toEqual({ from: '2026-10-01', to: '2026-10-31', user: USER, action: 'update', type: 'contract', record: MONA, employee: MONA, q: 'CON-2026', page: 3 });
    expect(isFiltered(filters)).toBe(true);
  });

  it('starts with nothing asked, on the first page', () => {
    expect(readAuditFilters({})).toEqual({ filters: NO_FILTERS, problems: [] });
    expect(isFiltered({ ...NO_FILTERS, page: 4 })).toBe(false);
    expect(readAuditFilters({ page: '0' }).filters.page).toBe(1);
    expect(readAuditFilters({ page: 'two' }).filters.page).toBe(1);
  });

  it('leaves out what isn’t right, and says so', () => {
    const { filters, problems } = readAuditFilters({ from: '31/02/2026', to: '2026-13-01', user: 'mona', record: 'abc', action: 'DROP TABLE', type: 'a-b' });
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
