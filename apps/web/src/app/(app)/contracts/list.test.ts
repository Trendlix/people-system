import { ROLES, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { NAV } from '../../../components/nav';
import { hasRole } from '../../../lib/roles';
import type { ContractListItem, EndingSummary } from '../../../lib/types';
import {
  byDate,
  canSeeContracts,
  contractsHref,
  countLabel,
  endingsInProgress,
  endingStage,
  FORM_FILTERS,
  isFiltered,
  listPaths,
  mergeAll,
  NO_FILTERS,
  readFilters,
  seesSalary,
  STATUS_FILTERS,
} from './list';

const as = (...roles: Role[]) => ({ roles });

describe('who sees the Contracts page', () => {
  it('is HR, the CEO and Finance', () => {
    expect(canSeeContracts(as('employee', 'hr'))).toBe(true);
    expect(canSeeContracts(as('employee', 'ceo'))).toBe(true);
    expect(canSeeContracts(as('employee', 'finance'))).toBe(true);
  });

  it('is not an employee, a manager, an Admin or a Super Admin without one of those roles', () => {
    expect(canSeeContracts(as('employee'))).toBe(false);
    expect(canSeeContracts(as('employee', 'manager'))).toBe(false);
    expect(canSeeContracts(as('employee', 'admin'))).toBe(false);
    expect(canSeeContracts(as('employee', 'super_admin'))).toBe(false);
    expect(canSeeContracts(as('super_admin', 'finance'))).toBe(true);
  });

  it('matches who gets the sidebar link', () => {
    // under People, after Employees (owner, 17 October 2026: "employees, contracts and offers need to be grouped")
    const pages = NAV.find((n) => n.label === 'People')?.items ?? [];
    const item = pages.find((n) => n.href === '/contracts');
    expect(item).toBeDefined();
    expect(item?.section).toBe('/contracts');
    expect(pages.findIndex((n) => n.href === '/contracts')).toBe(pages.findIndex((n) => n.href === '/employees') + 1);
    for (const role of ROLES) {
      const user = as('employee', role);
      expect(hasRole(user, ...(item?.roles ?? ROLES)), role).toBe(canSeeContracts(user));
    }
  });

  it('shows the salary to all of them, as the API sends it', () => {
    expect(seesSalary(as('hr'))).toBe(true);
    expect(seesSalary(as('finance'))).toBe(true);
    expect(seesSalary(as('ceo'))).toBe(true);
    expect(seesSalary(as('admin'))).toBe(false);
    expect(seesSalary(as('manager'))).toBe(false);
  });
});

describe('the filters in the address', () => {
  it('reads every filter', () => {
    expect(readFilters({ q: '  Omar ', status: 'draft', type: 'part_time', form: 'specific_job', endingWithin: '60' })).toEqual({
      q: 'Omar',
      status: 'draft',
      type: 'part_time',
      form: 'specific_job',
      endingWithin: 60,
    });
  });

  it('filters by the contract’s length again, with open-ended and specific-job contracts (18 October 2026)', () => {
    expect(readFilters({ status: 'all', form: 'fixed' })).toEqual({ ...NO_FILTERS, status: 'all', form: 'fixed' });
    expect(readFilters({ form: 'open_ended' })).toEqual({ ...NO_FILTERS, form: 'open_ended' });
    expect(FORM_FILTERS.map((f) => f.label)).toEqual(['Any length', 'Fixed-term', 'Open-ended', 'For a specific job']);
    expect(isFiltered({ ...NO_FILTERS, form: 'open_ended' })).toBe(true);
  });

  it('knows the employment types by the labour law: Sales and Internship are gone', () => {
    expect(readFilters({ type: 'trainee' }).type).toBe('trainee');
    expect(readFilters({ type: 'sales' })).toEqual(NO_FILTERS);
    expect(readFilters({ type: 'internship' })).toEqual(NO_FILTERS);
  });

  it('leaves out what it does not know, as if not chosen', () => {
    expect(readFilters({})).toEqual(NO_FILTERS);
    expect(readFilters({ q: '', status: 'signed', form: 'permanent', type: 'contractor', endingWithin: '45' })).toEqual(NO_FILTERS);
    expect(readFilters({ status: ['draft', 'active'], endingWithin: 'soon' })).toEqual(NO_FILTERS);
  });

  it('keeps a search to 100 characters', () => {
    expect(readFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });

  it('offers every status, drafts and signed first (the default) and All last', () => {
    expect(STATUS_FILTERS.map((s) => s.value)).toEqual(['', 'active', 'draft', 'ended', 'superseded', 'all']);
    expect(STATUS_FILTERS.map((s) => s.label)).toEqual(['Drafts and signed', 'Signed', 'Drafts', 'Ended', 'Replaced', 'All']);
  });

  it('counts the default status as no filter', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, status: 'all' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, q: 'TLX' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, endingWithin: 30 })).toBe(true);
  });
});

describe('the addresses', () => {
  it('gives the page without the empty filters, to share', () => {
    expect(contractsHref(NO_FILTERS)).toBe('/contracts');
    expect(contractsHref({ q: 'Omar Khaled', status: 'all', type: 'full_time', form: '', endingWithin: 30 })).toBe(
      '/contracts?q=Omar+Khaled&status=all&type=full_time&endingWithin=30',
    );
    // the contract's length (18 October 2026), after the type
    expect(contractsHref({ ...NO_FILTERS, type: 'trainee', form: 'open_ended' })).toBe('/contracts?type=trainee&form=open_ended');
  });

  it('asks the API once, with the status as chosen', () => {
    expect(listPaths(NO_FILTERS)).toEqual(['/contracts']);
    expect(listPaths({ ...NO_FILTERS, status: 'draft' })).toEqual(['/contracts?status=draft']);
    expect(listPaths({ ...NO_FILTERS, status: 'superseded', q: 'TLX-2026' })).toEqual(['/contracts?q=TLX-2026&status=superseded']);
    expect(listPaths({ ...NO_FILTERS, endingWithin: 90, type: 'trainee' })).toEqual(['/contracts?type=trainee&endingWithin=90']);
    expect(listPaths({ ...NO_FILTERS, form: 'specific_job' })).toEqual(['/contracts?form=specific_job']);
  });

  it('asks for drafts and signed, then ended, then replaced, for All', () => {
    expect(listPaths({ ...NO_FILTERS, status: 'all', type: 'full_time' })).toEqual([
      '/contracts?type=full_time',
      '/contracts?status=ended&type=full_time',
      '/contracts?status=superseded&type=full_time',
    ]);
  });

  it('asks once for All with "Ending within": the API keeps signed contracts only', () => {
    expect(listPaths({ ...NO_FILTERS, status: 'all', endingWithin: 60 })).toEqual(['/contracts?endingWithin=60']);
  });
});

const contract = (number: string, status: ContractListItem['status'], startDate: string): ContractListItem => ({
  id: number,
  number,
  version: 1,
  form: 'fixed',
  status,
  startDate,
  endDate: null,
  probationMonths: 0,
  probationEnd: null,
  signedOn: null,
  insuranceFiledOn: null,
  labourOfficeFiledOn: null,
  nonRenewalNoticeBy: null,
  grossSalary: null,
  insuredSalary: null,
  salaryHidden: false,
  payBasis: 'monthly',
  hourlyRate: null,
  hoursPerWeek: null,
  daysPerWeek: null,
  allowances: [],
  allowancesTotal: 0,
  totalSalary: null,
  employee: { id: 'e', employeeCode: 'TLX-001', fullNameEn: 'Omar', fullNameAr: 'عمر' },
  employmentId: 'm',
  employmentType: 'full_time',
  employmentCurrent: true,
  jobTitleEn: null,
  departmentName: null,
});

describe('mergeAll', () => {
  it('keeps the first answer as the API ordered it, then ended and replaced together, newest first', () => {
    const signed = contract('C-3', 'active', '2026-01-01');
    const draft = contract('C-9', 'draft', '2027-01-01');
    const ended = contract('C-1', 'ended', '2024-01-01');
    const replaced = contract('C-2', 'superseded', '2025-01-01');
    const replacedSameDay = contract('C-4', 'superseded', '2025-01-01');
    expect(mergeAll([[signed, draft], [ended], [replaced, replacedSameDay]]).map((c) => c.number)).toEqual(['C-3', 'C-9', 'C-4', 'C-2', 'C-1']);
  });

  it('passes one answer through', () => {
    const rows = [contract('C-1', 'active', '2026-01-01')];
    expect(mergeAll([rows])).toEqual(rows);
    expect(mergeAll([])).toEqual([]);
  });
});

describe('countLabel', () => {
  it('says one contract in the singular', () => {
    expect(countLabel(0)).toBe('0 contracts');
    expect(countLabel(1)).toBe('1 contract');
    expect(countLabel(12)).toBe('12 contracts');
  });
});

const ending = (id: string, status: EndingSummary['status'], lastWorkingDay: string): EndingSummary => ({
  id,
  ruleKey: 'resignation',
  ruleLabel: 'Resignation',
  initiator: 'employee',
  noticeGivenOn: null,
  payInLieu: false,
  lastWorkingDay,
  reason: null,
  note: null,
  status,
  hrApprovedBy: null,
  hrApprovedAt: null,
  endReason: 'resigned',
  employee: { id: 'e', employeeCode: 'TLX-001', fullNameEn: 'Omar' },
  employmentId: 'm',
});

describe('needs attention', () => {
  it('lists rows soonest first, and keeps a list that failed as null', () => {
    expect(byDate([{ d: '2026-12-01' }, { d: '2026-10-20' }], (r) => r.d)).toEqual([{ d: '2026-10-20' }, { d: '2026-12-01' }]);
    expect(byDate(null as { d: string }[] | null, (r) => r.d)).toBeNull();
  });

  it('puts the endings waiting for the CEO and those approved together, by last working day', () => {
    const rows = endingsInProgress([ending('a', 'pending_ceo', '2027-01-15')], [ending('b', 'approved', '2026-11-30'), ending('c', 'approved', '2027-02-01')]);
    expect(rows?.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('says it could not load when either list failed', () => {
    expect(endingsInProgress(null, [])).toBeNull();
    expect(endingsInProgress([], null)).toBeNull();
    expect(endingsInProgress([], [])).toEqual([]);
  });

  it('words where an ending stands', () => {
    expect(endingStage('pending_ceo')).toBe('Waiting for the CEO');
    expect(endingStage('approved')).toBe('Approved, in notice');
  });
});
