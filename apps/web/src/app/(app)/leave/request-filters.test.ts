import { describe, expect, it } from 'vitest';
import { hasRequestFilters, kindOfFilters, leaveTypeOf, NO_FILTERS, NO_MATCH_TEXT, PERMISSION_TYPE, readRequestFilters, requestFiltersHref, typeChoices, WFH_TYPE } from './request-filters';
import { leaveRequestsPath, leaveStepText, leaveDoneText } from './list';
import { permissionsPath } from './permissions';

// Leave Requests filtered by employee and type (owner, 26 October 2026: "i need to filter either by employee or typ").

const ANA = '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e';
const ANNUAL = '5c1d7d28-35a3-4a86-8a43-7fb3f5c2b0a1';

describe('the filters in the address', () => {
  it('reads a person and a type, ignoring what is neither', () => {
    expect(readRequestFilters({ employee: ANA, type: ANNUAL })).toEqual({ employeeId: ANA, type: ANNUAL, from: null, to: null });
    expect(readRequestFilters({ type: 'permission' })).toEqual({ employeeId: null, type: PERMISSION_TYPE, from: null, to: null });
    expect(readRequestFilters({})).toEqual(NO_FILTERS);
    expect(readRequestFilters({ employee: 'ana', type: 'annual' })).toEqual(NO_FILTERS);
    expect(readRequestFilters({ employee: [ANA], type: ['permission'] })).toEqual(NO_FILTERS);
    expect(readRequestFilters({ employee: ` ${ANA} ` }).employeeId).toBe(ANA);
  });

  it('a link from before the Type filter (?kind=permission) still opens the permissions; the Type wins', () => {
    expect(readRequestFilters({ kind: 'permission' }).type).toBe(PERMISSION_TYPE);
    expect(readRequestFilters({ kind: 'permission', type: ANNUAL }).type).toBe(ANNUAL);
    expect(readRequestFilters({ kind: 'leave' }).type).toBeNull();
  });

  it('says whether any is on, which requests the type chooses and which leave type to ask for', () => {
    expect(hasRequestFilters(NO_FILTERS)).toBe(false);
    expect(hasRequestFilters({ ...NO_FILTERS, employeeId: ANA })).toBe(true);
    expect(hasRequestFilters({ ...NO_FILTERS, type: ANNUAL })).toBe(true);
    expect(kindOfFilters(NO_FILTERS)).toBe('all');
    expect(kindOfFilters({ ...NO_FILTERS, employeeId: ANA, type: null })).toBe('all');
    expect(kindOfFilters({ ...NO_FILTERS, employeeId: null, type: PERMISSION_TYPE })).toBe('permission');
    expect(kindOfFilters({ ...NO_FILTERS, employeeId: null, type: ANNUAL })).toBe('leave');
    expect(leaveTypeOf({ ...NO_FILTERS, employeeId: null, type: ANNUAL })).toBe(ANNUAL);
    expect(leaveTypeOf({ ...NO_FILTERS, employeeId: null, type: PERMISSION_TYPE })).toBeNull();
    expect(leaveTypeOf(NO_FILTERS)).toBeNull();
  });
});

describe('the addresses', () => {
  it('a link keeps the status and the filters; none for the user’s default status', () => {
    expect(requestFiltersHref('approved', NO_FILTERS)).toBe('/leave?status=approved');
    expect(requestFiltersHref('waiting', { ...NO_FILTERS, employeeId: ANA, type: ANNUAL })).toBe(`/leave?status=waiting&employee=${ANA}&type=${ANNUAL}`);
    expect(requestFiltersHref('all', { ...NO_FILTERS, type: PERMISSION_TYPE })).toBe('/leave?status=all&type=permission');
    expect(requestFiltersHref(null, NO_FILTERS)).toBe('/leave');
    expect(requestFiltersHref(null, { ...NO_FILTERS, employeeId: ANA })).toBe(`/leave?employee=${ANA}`);
  });

  it('the API’s lists take the person, and the leave also the type', () => {
    expect(leaveRequestsPath('all')).toBe('/leave/requests');
    expect(leaveRequestsPath('approved', ANA, ANNUAL)).toBe(`/leave/requests?status=approved&employeeId=${ANA}&typeId=${ANNUAL}`);
    expect(leaveRequestsPath('all', null, ANNUAL)).toBe(`/leave/requests?typeId=${ANNUAL}`);
    expect(permissionsPath('waiting', ANA)).toBe(`/leave/permissions?status=waiting&employeeId=${ANA}`);
  });

  it('a From and a To, either alone, kept by the links and sent to both lists (owner, 26 October 2026: "add date filter too")', () => {
    // as the form sends them (DD/MM/YYYY) or as a link keeps them (YYYY-MM-DD); not a day: ignored; From after To: swapped
    expect(readRequestFilters({ from: '01/10/2026', to: '2026-10-31' })).toEqual({ ...NO_FILTERS, from: '2026-10-01', to: '2026-10-31' });
    expect(readRequestFilters({ from: '2026-10-31', to: '01/10/2026' })).toEqual({ ...NO_FILTERS, from: '2026-10-01', to: '2026-10-31' });
    expect(readRequestFilters({ to: '31/10/2026' })).toEqual({ ...NO_FILTERS, to: '2026-10-31' });
    expect(readRequestFilters({ from: '31/02/2026', to: 'soon' })).toEqual(NO_FILTERS);
    expect(hasRequestFilters({ ...NO_FILTERS, from: '2026-10-01' })).toBe(true);
    expect(requestFiltersHref('approved', { ...NO_FILTERS, type: ANNUAL, from: '2026-10-01', to: '2026-10-31' })).toBe(`/leave?status=approved&type=${ANNUAL}&from=2026-10-01&to=2026-10-31`);
    const days = { from: '2026-10-01', to: null };
    expect(leaveRequestsPath('all', ANA, null, days)).toBe(`/leave/requests?employeeId=${ANA}&from=2026-10-01`);
    expect(permissionsPath('all', null, { from: null, to: '2026-10-31' })).toBe('/leave/permissions?to=2026-10-31');
  });
});

describe('the Type’s choices', () => {
  it('are All types, the leave types in order (those turned off marked), then Permission', () => {
    expect(
      typeChoices([
        { id: 'b', nameEn: 'Casual leave', active: true, sortOrder: 2 },
        { id: 'a', nameEn: 'Annual leave', active: true, sortOrder: 1 },
        { id: 'c', nameEn: 'Childcare leave', active: false, sortOrder: 3 },
      ]),
    ).toEqual([
      { value: '', label: 'All types' },
      { value: 'a', label: 'Annual leave' },
      { value: 'b', label: 'Casual leave' },
      { value: 'c', label: 'Childcare leave (off)' },
      { value: 'permission', label: 'Permission' },
      { value: 'wfh', label: 'Work from home' },
    ]);
    expect(typeChoices([]).map((c) => c.value)).toEqual(['', 'permission', 'wfh']);
  });

  it('end with Work from home beside Permission, read from the address and kept by the links (owner, 26 October 2026: "Show it with leave")', () => {
    expect(readRequestFilters({ type: 'wfh' })).toEqual({ ...NO_FILTERS, type: WFH_TYPE });
    expect(readRequestFilters({ type: 'WFH' })).toEqual(NO_FILTERS);
    expect(readRequestFilters({ employee: ANA, type: 'wfh', from: '01/11/2026' })).toEqual({ employeeId: ANA, type: WFH_TYPE, from: '2026-11-01', to: null });
    expect(hasRequestFilters({ ...NO_FILTERS, type: WFH_TYPE })).toBe(true);
    // the work from home requests alone, and no leave type asked for
    expect(kindOfFilters({ ...NO_FILTERS, type: WFH_TYPE })).toBe('wfh');
    expect(leaveTypeOf({ ...NO_FILTERS, type: WFH_TYPE })).toBeNull();
    expect(requestFiltersHref('waiting', { ...NO_FILTERS, employeeId: ANA, type: WFH_TYPE })).toBe(`/leave?status=waiting&employee=${ANA}&type=wfh`);
    const values = typeChoices([{ id: ANNUAL, nameEn: 'Annual leave', active: true, sortOrder: 1 }]).map((c) => c.value);
    expect(values.indexOf('wfh')).toBe(values.indexOf('permission') + 1);
  });

  it('an empty result says so', () => {
    expect(NO_MATCH_TEXT).toBe('No requests match these filters.');
  });
});

describe('a Super Admin’s edit in the log', () => {
  it('the step says who edited it, the comment what changed', () => {
    expect(leaveStepText({ kind: 'edited', decision: null, comment: 'Type A → B' })).toBe('Edited by a Super Admin');
    expect(leaveDoneText({ done: 'edited' }, 'approved')).toEqual({ text: 'Leave edited. The log of every step lists what changed.', tone: 'ok' });
  });
});
