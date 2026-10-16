import { ROLES, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  canChangeAccount,
  canDelete,
  effectiveRoles,
  hasRole,
  isAdmin,
  isSelfService,
  isSuperAdmin,
  ONLY_SUPER_ADMIN_DELETES,
  ROLE_LABELS,
} from './roles';

const as = (...roles: Role[]) => ({ roles });

const superAdmin = as('employee', 'super_admin');
const admin = as('employee', 'admin');
const hr = as('employee', 'hr');
const ceo = as('employee', 'ceo');
const employee = as('employee');

describe('effectiveRoles', () => {
  it('adds Admin for a Super Admin', () => {
    expect(effectiveRoles(['employee', 'super_admin'])).toEqual(['employee', 'super_admin', 'admin']);
  });

  it('adds nothing when Admin is held already, or for anyone else', () => {
    expect(effectiveRoles(['super_admin', 'admin'])).toEqual(['super_admin', 'admin']);
    expect(effectiveRoles(['employee', 'hr'])).toEqual(['employee', 'hr']);
    expect(effectiveRoles([])).toEqual([]);
  });

  it('gives a Super Admin none of the HR, CEO or Finance powers', () => {
    const roles = effectiveRoles(['super_admin']);
    for (const r of ['hr', 'ceo', 'finance', 'manager'] as const) expect(roles).not.toContain(r);
  });

  it('leaves the roles it was given as they were', () => {
    const roles: Role[] = ['super_admin'];
    effectiveRoles(roles);
    expect(roles).toEqual(['super_admin']);
  });
});

describe('hasRole', () => {
  it('counts a Super Admin as an Admin', () => {
    expect(hasRole(superAdmin, 'admin')).toBe(true);
    expect(hasRole(superAdmin, 'hr', 'admin')).toBe(true);
  });

  it('is true when any of the roles is held', () => {
    expect(hasRole(hr, 'hr', 'admin')).toBe(true);
    expect(hasRole(ceo, 'hr', 'ceo')).toBe(true);
    expect(hasRole(employee, 'hr', 'admin')).toBe(false);
  });

  it('does not make a Super Admin HR or the CEO', () => {
    expect(hasRole(superAdmin, 'hr')).toBe(false);
    expect(hasRole(superAdmin, 'ceo', 'finance')).toBe(false);
  });

  it('does not make an Admin a Super Admin', () => {
    expect(hasRole(admin, 'super_admin')).toBe(false);
  });
});

describe('isSelfService', () => {
  it('is an employee, a direct manager or both, and nobody else', () => {
    expect(isSelfService(employee)).toBe(true);
    expect(isSelfService(as('manager'))).toBe(true);
    expect(isSelfService(as('employee', 'manager'))).toBe(true);
    // no roles at all: nothing more than an employee
    expect(isSelfService(as())).toBe(true);
  });

  it('is not HR, Finance, the CEO, an Admin or a Super Admin, whatever else they hold', () => {
    for (const user of [hr, ceo, admin, superAdmin, as('finance'), as('employee', 'manager', 'finance'), as('manager', 'super_admin')]) {
      expect(isSelfService(user)).toBe(false);
    }
  });
});

describe('isAdmin, isSuperAdmin and canDelete', () => {
  it('treats a Super Admin as an Admin', () => {
    expect(isAdmin(superAdmin)).toBe(true);
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(hr)).toBe(false);
  });

  it('knows a Super Admin', () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(isSuperAdmin(as('super_admin', 'admin', 'hr'))).toBe(true);
    expect(isSuperAdmin(admin)).toBe(false);
  });

  it('lets only a Super Admin delete', () => {
    expect(canDelete(superAdmin)).toBe(true);
    for (const user of [admin, hr, ceo, employee, as('hr', 'admin', 'ceo', 'finance', 'manager')]) expect(canDelete(user)).toBe(false);
  });

  it('offers no delete while viewing as a Super Admin view only, and offers it with Act as them on', () => {
    const by = { id: 'u1', email: 'owner@trendlix.com' };
    expect(canDelete({ ...superAdmin, viewAs: null })).toBe(true);
    expect(canDelete({ ...superAdmin, viewAs: { by, act: false } })).toBe(false);
    expect(canDelete({ ...superAdmin, viewAs: { by, act: true } })).toBe(true);
    expect(canDelete({ ...hr, viewAs: { by, act: true } })).toBe(false);
  });

  it('refuses with the words the API uses', () => {
    expect(ONLY_SUPER_ADMIN_DELETES).toBe('Only a Super Admin can delete records.');
  });
});

describe('assignableRoles', () => {
  it('offers a Super Admin every role', () => {
    expect(assignableRoles(superAdmin, ROLES)).toEqual([...ROLES]);
  });

  it('offers an Admin every role but Super Admin', () => {
    const offered = assignableRoles(admin, ROLES);
    expect(offered).not.toContain('super_admin');
    expect(offered).toEqual(ROLES.filter((r) => r !== 'super_admin'));
    // whatever the shared list holds when the tests run
    expect(assignableRoles(admin, ['employee', 'admin', 'super_admin'])).toEqual(['employee', 'admin']);
    expect(assignableRoles(superAdmin, ['employee', 'admin', 'super_admin'])).toEqual(['employee', 'admin', 'super_admin']);
  });
});

describe('canChangeAccount', () => {
  it("keeps a Super Admin's account for a Super Admin", () => {
    expect(canChangeAccount(admin, superAdmin)).toBe(false);
    expect(canChangeAccount(superAdmin, as('super_admin', 'admin'))).toBe(true);
  });

  it('lets an Admin change any other account', () => {
    expect(canChangeAccount(admin, as('admin'))).toBe(true);
    expect(canChangeAccount(admin, hr)).toBe(true);
    expect(canChangeAccount(superAdmin, hr)).toBe(true);
  });
});

describe('ROLE_LABELS', () => {
  it('names every role, Super Admin included', () => {
    for (const r of ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
    expect(ROLE_LABELS.super_admin).toBe('Super Admin');
  });
});
