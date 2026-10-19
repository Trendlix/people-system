import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { actionablePeople, cLevelTitle, decidesChangeOfDetails, decidesHrStage, isRestricted, requestStatusLabel, WITH_THE_CEO } from './confidential';

const as = (...roles: Role[]) => ({ roles });

const hr = as('employee', 'hr');
const ceo = as('employee', 'ceo');
const admin = as('employee', 'admin');
const superAdmin = as('employee', 'super_admin');
const hrSuperAdmin = as('employee', 'hr', 'super_admin');
const finance = as('employee', 'finance');

describe('isRestricted and actionablePeople', () => {
  const rows = [
    { id: 'a', restricted: false as const },
    { id: 'b', restricted: true as const },
    { id: 'c' },
  ];

  it('tells a C-level card from a full row', () => {
    expect(rows.map((r) => isRestricted(r))).toEqual([false, true, false]);
  });

  it('leaves the cards out of the people an HR action is offered for', () => {
    expect(actionablePeople(rows).map((r) => r.id)).toEqual(['a', 'c']);
    expect(actionablePeople([])).toEqual([]);
  });
});

describe('cLevelTitle', () => {
  it('tells a card’s viewer who sees the rest, and a full view’s who sees only the card', () => {
    expect(cLevelTitle(true)).toBe('C-level: only the CEO and the Super Admin see the rest.');
    expect(cLevelTitle(false)).toBe('C-level: HR and the others see only their directory card.');
    expect(cLevelTitle(undefined)).toBe(cLevelTitle(false));
  });
});

describe('requestStatusLabel', () => {
  it('says With the CEO for a C-level request at HR’s or Finance’s stage', () => {
    expect(requestStatusLabel('with_hr', 'With HR', true)).toBe(WITH_THE_CEO);
    expect(requestStatusLabel('with_finance', 'With Finance', true)).toBe('With the CEO');
  });

  it('keeps the label otherwise', () => {
    expect(requestStatusLabel('with_hr', 'With HR', false)).toBe('With HR');
    expect(requestStatusLabel('with_hr', 'With HR', undefined)).toBe('With HR');
    expect(requestStatusLabel('with_manager', 'With the manager', true)).toBe('With the manager');
    expect(requestStatusLabel('approved', 'Approved', true)).toBe('Approved');
    expect(requestStatusLabel('with_ceo', 'With the CEO', true)).toBe('With the CEO');
  });
});

describe('decidesHrStage', () => {
  it('is HR’s for anyone else', () => {
    expect(decidesHrStage(hr, false)).toBe(true);
    expect(decidesHrStage(hr, undefined)).toBe(true);
    expect(decidesHrStage(ceo, false)).toBe(false);
    expect(decidesHrStage(superAdmin, false)).toBe(false);
  });

  it('is the CEO’s, or HR with Super Admin, for a C-level person', () => {
    expect(decidesHrStage(ceo, true)).toBe(true);
    expect(decidesHrStage(hrSuperAdmin, true)).toBe(true);
    expect(decidesHrStage(hr, true)).toBe(false);
    expect(decidesHrStage(superAdmin, true)).toBe(false);
    expect(decidesHrStage(finance, true)).toBe(false);
  });
});

describe('decidesChangeOfDetails', () => {
  it('is HR’s and Admin’s for anyone else', () => {
    expect(decidesChangeOfDetails(hr, false)).toBe(true);
    expect(decidesChangeOfDetails(admin, false)).toBe(true);
    expect(decidesChangeOfDetails(superAdmin, false)).toBe(true);
    expect(decidesChangeOfDetails(ceo, false)).toBe(false);
  });

  it('is the CEO’s or a Super Admin’s for a C-level person, not HR’s nor an Admin’s', () => {
    expect(decidesChangeOfDetails(ceo, true)).toBe(true);
    expect(decidesChangeOfDetails(superAdmin, true)).toBe(true);
    expect(decidesChangeOfDetails(hrSuperAdmin, true)).toBe(true);
    expect(decidesChangeOfDetails(hr, true)).toBe(false);
    expect(decidesChangeOfDetails(admin, true)).toBe(false);
  });
});
