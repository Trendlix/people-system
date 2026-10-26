import { describe, expect, it } from 'vitest';
import { hasRequestFilters, kindOfFilters, leaveTypeOf, NO_FILTERS, NO_MATCH_TEXT, PERMISSION_TYPE, readRequestFilters, requestFiltersHref, typeChoices } from './request-filters';
import { leaveRequestsPath, leaveStepText, leaveDoneText } from './list';
import { permissionsPath } from './permissions';

// Leave Requests filtered by employee and type (owner, 26 October 2026: "i need to filter either by employee or typ").

const ANA = '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e';
const ANNUAL = '5c1d7d28-35a3-4a86-8a43-7fb3f5c2b0a1';

describe('the filters in the address', () => {
  it('reads a person and a type, ignoring what is neither', () => {
    expect(readRequestFilters({ employee: ANA, type: ANNUAL })).toEqual({ employeeId: ANA, type: ANNUAL });
    expect(readRequestFilters({ type: 'permission' })).toEqual({ employeeId: null, type: PERMISSION_TYPE });
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
    expect(hasRequestFilters({ employeeId: ANA, type: null })).toBe(true);
    expect(hasRequestFilters({ employeeId: null, type: ANNUAL })).toBe(true);
    expect(kindOfFilters(NO_FILTERS)).toBe('all');
    expect(kindOfFilters({ employeeId: ANA, type: null })).toBe('all');
    expect(kindOfFilters({ employeeId: null, type: PERMISSION_TYPE })).toBe('permission');
    expect(kindOfFilters({ employeeId: null, type: ANNUAL })).toBe('leave');
    expect(leaveTypeOf({ employeeId: null, type: ANNUAL })).toBe(ANNUAL);
    expect(leaveTypeOf({ employeeId: null, type: PERMISSION_TYPE })).toBeNull();
    expect(leaveTypeOf(NO_FILTERS)).toBeNull();
  });
});

describe('the addresses', () => {
  it('a link keeps the status and the filters; none for the user’s default status', () => {
    expect(requestFiltersHref('approved', NO_FILTERS)).toBe('/leave?status=approved');
    expect(requestFiltersHref('waiting', { employeeId: ANA, type: ANNUAL })).toBe(`/leave?status=waiting&employee=${ANA}&type=${ANNUAL}`);
    expect(requestFiltersHref('all', { employeeId: null, type: PERMISSION_TYPE })).toBe('/leave?status=all&type=permission');
    expect(requestFiltersHref(null, NO_FILTERS)).toBe('/leave');
    expect(requestFiltersHref(null, { employeeId: ANA, type: null })).toBe(`/leave?employee=${ANA}`);
  });

  it('the API’s lists take the person, and the leave also the type', () => {
    expect(leaveRequestsPath('all')).toBe('/leave/requests');
    expect(leaveRequestsPath('approved', ANA, ANNUAL)).toBe(`/leave/requests?status=approved&employeeId=${ANA}&typeId=${ANNUAL}`);
    expect(leaveRequestsPath('all', null, ANNUAL)).toBe(`/leave/requests?typeId=${ANNUAL}`);
    expect(permissionsPath('waiting', ANA)).toBe(`/leave/permissions?status=waiting&employeeId=${ANA}`);
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
    ]);
    expect(typeChoices([]).map((c) => c.value)).toEqual(['', 'permission']);
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
