import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { Department } from '../../../../lib/types';
import {
  capField,
  capFrom,
  capsProblem,
  capText,
  claimsCountText,
  daysFrom,
  departmentChoices,
  editsReimbursementTypes,
  REIMBURSEMENT_TYPES_HREF,
  reimbursementTypeHref,
  seesReimbursementTypes,
  typeBody,
  typedRulesText,
  whoCanClaim,
} from './reimbursement-types';

const as = (...roles: Role[]) => ({ roles });

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
};

const dept = (id: string, nameEn: string, parent: Department | null = null): Department => ({
  id,
  nameEn,
  nameAr: null,
  parentId: parent?.id ?? null,
  parent: parent && { id: parent.id, nameEn: parent.nameEn, nameAr: null },
  sortOrder: 0,
  _count: { jobTitles: 0, children: 0 },
});

const MARKETING = dept('d1', 'Marketing');
const CONTENT = dept('d2', 'Content Team', MARKETING);
const SALES = dept('d3', 'Sales');

describe('who sees and changes the reimbursement types', () => {
  it('lets HR, Finance, the CEO and Admin read them, and HR alone change them', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) expect(seesReimbursementTypes(as(role))).toBe(true);
    for (const role of ['employee', 'manager'] as const) expect(seesReimbursementTypes(as(role))).toBe(false);
    expect(editsReimbursementTypes(as('hr'))).toBe(true);
    for (const role of ['finance', 'ceo', 'admin', 'super_admin'] as const) expect(editsReimbursementTypes(as(role))).toBe(false);
  });

  it('keeps the section on Payroll Setup and a type’s page under it', () => {
    expect(REIMBURSEMENT_TYPES_HREF).toBe('/organization/payroll#reimbursement-types');
    expect(reimbursementTypeHref('t1')).toBe('/organization/payroll/reimbursement-types/t1');
  });
});

describe('the type form', () => {
  const full = {
    nameEn: ' Transport ',
    nameAr: 'مواصلات',
    description: '',
    receiptRequired: 'on',
    capPerClaim: '500',
    capPerMonth: '1,000',
    capPerYear: '',
    claimWithinDays: '30',
    departmentIds: ['d1', 'd2', 'd1'],
    gradeIds: ['g1'],
    employmentTypes: ['full_time', 'robot'],
    active: 'on',
  };

  it('gives the API every field: empty caps and deadline as none, the ticked choices as lists', () => {
    expect(typeBody(form(full))).toEqual({
      body: {
        nameEn: 'Transport',
        nameAr: 'مواصلات',
        description: null,
        receiptRequired: true,
        capPerClaim: 500,
        capPerMonth: 1000,
        capPerYear: null,
        claimWithinDays: 30,
        departmentIds: ['d1', 'd2'],
        gradeIds: ['g1'],
        employmentTypes: ['full_time'],
        active: true,
      },
      errors: [],
    });
  });

  it('reads an unticked checkbox as no: no receipt needed, turned off, everyone', () => {
    const { body } = typeBody(form({ nameEn: 'Mobile bill', nameAr: 'فاتورة المحمول' }));
    expect(body).toMatchObject({ receiptRequired: false, active: false, departmentIds: [], gradeIds: [], employmentTypes: [], capPerClaim: null, claimWithinDays: null });
  });

  it('says what is wrong, as the API would', () => {
    expect(typeBody(form({ ...full, nameEn: '', nameAr: '' })).errors).toEqual([
      'Enter the name in English (up to 100 characters), e.g. Mobile bill.',
      'Enter the name in Arabic (up to 100 characters), e.g. فاتورة المحمول.',
    ]);
    expect(typeBody(form({ ...full, capPerClaim: '0', capPerYear: 'abc' })).errors).toEqual([
      'Enter the cap a claim as an amount of more than 0, e.g. 500 or 750.50, or leave it empty for no cap.',
      'Enter the cap a year as an amount of more than 0, e.g. 500 or 750.50, or leave it empty for no cap.',
    ]);
    expect(typeBody(form({ ...full, claimWithinDays: '400' })).errors).toEqual([
      'Enter the days after the expense it must be claimed within, 1 to 365, or leave it empty for no deadline.',
    ]);
    expect(typeBody(form({ ...full, description: 'x'.repeat(501) })).errors).toEqual(['Keep the description to 500 characters or fewer.']);
  });

  it('keeps the caps in order: a claim’s no more than a month’s or a year’s, a month’s no more than a year’s', () => {
    expect(typeBody(form({ ...full, capPerClaim: '1500' })).errors).toEqual(["The cap a claim (EGP 1,500.00) can't be more than the cap a month (EGP 1,000.00)."]);
    expect(capsProblem({ capPerClaim: null, capPerMonth: 2000, capPerYear: 1000 })).toBe("The cap a month (EGP 2,000.00) can't be more than the cap a year (EGP 1,000.00).");
    expect(capsProblem({ capPerClaim: 2000, capPerMonth: null, capPerYear: 1000 })).toBe("The cap a claim (EGP 2,000.00) can't be more than the cap a year (EGP 1,000.00).");
    expect(capsProblem({ capPerClaim: 500, capPerMonth: 500, capPerYear: 500 })).toBeNull();
  });

  it('reads caps and days as typed, in Arabic digits and with the Arabic decimal mark too', () => {
    expect(capFrom('750.50')).toBe(750.5);
    expect(capFrom('٧٥٠٫٥٠')).toBe(750.5);
    expect(capFrom('')).toBeNull();
    expect(capFrom('-5')).toBeNaN();
    expect(capFrom('10000000000')).toBeNaN();
    expect(daysFrom('٣٠')).toBe(30);
    expect(daysFrom('')).toBeNull();
    expect(daysFrom('1.5')).toBeNaN();
    expect(daysFrom('0')).toBeNaN();
    expect(capField(500)).toBe('500');
    expect(capField(750.5)).toBe('750.5');
    expect(capField(null)).toBe('');
  });

  it('says live what the conditions typed come to, as the employee reads them', () => {
    expect(typedRulesText({ receiptRequired: true, capPerClaim: '500', capPerMonth: '1000', capPerYear: '', claimWithinDays: '30' })).toBe(
      'Receipt needed · Up to EGP 500.00 a claim, 1,000.00 a month · Within 30 days of the expense',
    );
    expect(typedRulesText({ receiptRequired: false, capPerClaim: '', capPerMonth: '', capPerYear: '', claimWithinDays: '' })).toBe('No receipt needed · No cap');
    expect(typedRulesText({ receiptRequired: true, capPerClaim: 'abc', capPerMonth: '', capPerYear: '', claimWithinDays: '' })).toBeNull();
  });
});

describe('a type in words', () => {
  it('says the caps and the claims', () => {
    expect(capText(500)).toBe('EGP 500.00');
    expect(capText(null)).toBe('No cap');
    expect(claimsCountText(0)).toBe('No claims yet');
    expect(claimsCountText(1)).toBe('1 claim');
    expect(claimsCountText(4)).toBe('4 claims');
  });

  it('says who may claim a type, a line for each list chosen; everyone when none is', () => {
    const grades = [{ id: 'g1', code: 'G3' }];
    expect(whoCanClaim({ departmentIds: [], gradeIds: [], employmentTypes: [] }, [], [])).toEqual(['Everyone']);
    expect(whoCanClaim({ departmentIds: ['d1', 'd2', 'gone'], gradeIds: ['g1'], employmentTypes: ['full_time', 'part_time'] }, [MARKETING, CONTENT, SALES], grades)).toEqual([
      'Departments: Marketing, Marketing › Content Team, 1 no longer on file',
      'Grades: G3',
      'Employment types: Full-time, Part-time',
    ]);
  });

  it('offers each department with its teams under it', () => {
    expect(departmentChoices([MARKETING, SALES, CONTENT])).toEqual([
      { id: 'd1', label: 'Marketing', teams: [{ id: 'd2', label: 'Content Team' }] },
      { id: 'd3', label: 'Sales', teams: [] },
    ]);
  });
});
