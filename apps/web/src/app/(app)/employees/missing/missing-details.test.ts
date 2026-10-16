import { describe, expect, it } from 'vitest';
import {
  bySection,
  documentGaps,
  gapHref,
  inView,
  isFiltered,
  listed,
  missingHref,
  NO_FILTERS,
  personalGaps,
  readFilters,
  summaryText,
  type MissingDetailsRow,
} from './missing-details';

const UUID = '11111111-2222-4333-8444-555555555555';
const TEAM = '66666666-7777-4888-8999-000000000000';

const MOBILE = { key: 'mobile', label: 'Mobile', tab: 'basic' } as const;
const CITY = { key: 'city', label: 'City', tab: 'basic' } as const;
const FACULTY = { key: 'faculty', label: 'Faculty', tab: 'education' } as const;
const SHIFT = { key: 'shift', label: 'Shift', tab: 'employment' } as const;
const PHOTO = { key: 'personal_photo', label: 'Personal photo', tab: 'documents' } as const;

const row = (code: string, extra: Partial<MissingDetailsRow> = {}): MissingDetailsRow => ({
  id: `id-${code}`,
  employeeCode: code,
  fullNameEn: `Person ${code}`,
  fullNameAr: 'موظف',
  standing: 'active',
  department: null,
  jobTitle: null,
  percent: 50,
  missing: [MOBILE],
  ...extra,
});

describe('the Missing Details filters', () => {
  it('are read from the address, leaving out what they don’t know', () => {
    expect(readFilters({})).toEqual(NO_FILTERS);
    expect(readFilters({ q: '  Omar ', departmentId: UUID, what: 'documents', notEmployed: '1' })).toEqual({
      q: 'Omar',
      departmentId: UUID,
      what: 'documents',
      notEmployed: true,
    });
    expect(readFilters({ departmentId: 'marketing', what: 'salary', notEmployed: 'yes' })).toEqual(NO_FILTERS);
    expect(readFilters({ q: ['a', 'b'] }).q).toBe('');
  });

  it('make an address to share, with the chosen ones only', () => {
    expect(missingHref(NO_FILTERS)).toBe('/employees/missing');
    expect(missingHref({ ...NO_FILTERS, q: 'Sara Ali', what: 'personal', notEmployed: true })).toBe('/employees/missing?q=Sara+Ali&what=personal&notEmployed=1');
    expect(readFilters(Object.fromEntries(new URL(`http://x${missingHref({ q: 'x', departmentId: UUID, what: 'documents', notEmployed: true })}`).searchParams))).toEqual({
      q: 'x',
      departmentId: UUID,
      what: 'documents',
      notEmployed: true,
    });
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, notEmployed: true })).toBe(true);
  });
});

describe('who is listed', () => {
  const rows = [
    row('EMP-0001', { fullNameEn: 'Omar Khaled', department: { id: TEAM, nameEn: 'Content Team', nameAr: null, parent: { id: UUID, nameEn: 'Marketing', nameAr: null } } }),
    row('EMP-0002', { fullNameAr: 'سارة علي', standing: 'not_employed' }),
    row('EMP-0003', { standing: 'probation', missing: [], percent: 100 }),
    row('EMP-0004', { standing: 'on_leave', missing: [PHOTO] }),
  ];

  it('current employees only, unless people not employed yet are asked for', () => {
    expect(inView(rows, NO_FILTERS, null).map((r) => r.employeeCode)).toEqual(['EMP-0001', 'EMP-0003', 'EMP-0004']);
    expect(inView(rows, { ...NO_FILTERS, notEmployed: true }, null)).toHaveLength(4);
  });

  it('by name in English or Arabic or by code, and by department with its teams', () => {
    const all = { ...NO_FILTERS, notEmployed: true };
    expect(inView(rows, { ...all, q: 'omar' }, null).map((r) => r.employeeCode)).toEqual(['EMP-0001']);
    expect(inView(rows, { ...all, q: 'سارة' }, null).map((r) => r.employeeCode)).toEqual(['EMP-0002']);
    expect(inView(rows, { ...all, q: 'emp-0004' }, null).map((r) => r.employeeCode)).toEqual(['EMP-0004']);
    expect(inView(rows, { ...all, departmentId: UUID }, new Set([UUID, TEAM])).map((r) => r.employeeCode)).toEqual(['EMP-0001']);
  });

  it('only people with something missing, of the kind chosen', () => {
    expect(listed(rows, '').map((r) => r.employeeCode)).toEqual(['EMP-0001', 'EMP-0002', 'EMP-0004']);
    expect(listed(rows, 'personal').map((r) => r.employeeCode)).toEqual(['EMP-0001', 'EMP-0002']);
    expect(listed(rows, 'documents').map((r) => r.employeeCode)).toEqual(['EMP-0004']);
  });
});

describe('what the page says', () => {
  it('sums up how many people have something missing', () => {
    expect(summaryText([...Array(18)].map(() => ({ missing: [MOBILE] })).concat([...Array(7)].map(() => ({ missing: [] }))))).toBe(
      '18 of 25 people have something missing · 7 complete',
    );
    expect(summaryText([{ missing: [MOBILE] }, { missing: [] }])).toBe('1 of 2 people has something missing · 1 complete');
    expect(summaryText([{ missing: [] }, { missing: [] }])).toBe('0 of 2 people have something missing · 2 complete');
    expect(summaryText([{ missing: [] }])).toBe('0 of 1 person has something missing · 1 complete');
    expect(summaryText([])).toBe(''); // no one in view: the page says so instead
  });

  it('groups the personal details by section in the order of the profile tabs, and keeps the papers apart', () => {
    const missing = [FACULTY, PHOTO, MOBILE, SHIFT, CITY];
    expect(bySection(missing).map((s) => [s.label, s.gaps.map((g) => g.label)])).toEqual([
      ['Basic data', ['Mobile', 'City']],
      ['Education', ['Faculty']],
      ['Employment', ['Shift']],
    ]);
    expect(bySection([PHOTO])).toEqual([]);
    expect(personalGaps(missing)).toEqual([FACULTY, MOBILE, SHIFT, CITY]);
    expect(documentGaps(missing)).toEqual([PHOTO]);
  });

  it('links each missing item to where it is filled in on the profile', () => {
    expect(gapHref('emp-1', MOBILE)).toBe('/employees/emp-1#field-mobile');
    expect(gapHref('emp-1', FACULTY)).toBe('/employees/emp-1?tab=education#field-faculty');
    expect(gapHref('emp-1', SHIFT)).toBe('/employees/emp-1?tab=employment#field-shift');
    expect(gapHref('emp-1', PHOTO)).toBe('/employees/emp-1?tab=documents#paper-personal_photo');
  });
});
