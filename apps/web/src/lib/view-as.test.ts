import { describe, expect, it } from 'vitest';
import type { UserAccount } from './types';
import {
  canViewAs,
  filterChoices,
  isViewOnly,
  rolesText,
  sessionCookieFrom,
  viewAsChoices,
  viewingAsText,
  viewOnlyMessage,
} from './view-as';

const by = { id: 'super-1', email: 'owner@trendlix.com' };

function account(id: string, email: string, extra: Partial<UserAccount> = {}): UserAccount {
  return { id, email, isActive: true, roles: ['employee'], createdAt: '2026-10-01T00:00:00Z', lastSignInAt: null, employee: null, ...extra };
}

describe('canViewAs and isViewOnly', () => {
  it('offers View as… to a Super Admin in their own session only', () => {
    expect(canViewAs({ roles: ['super_admin'] })).toBe(true);
    expect(canViewAs({ roles: ['employee', 'super_admin'], viewAs: null })).toBe(true);
    expect(canViewAs({ roles: ['admin'] })).toBe(false);
    expect(canViewAs({ roles: ['hr', 'ceo', 'finance'] })).toBe(false);
    // no switching while switched, even when viewing as another Super Admin
    expect(canViewAs({ roles: ['super_admin'], viewAs: { by, act: true } })).toBe(false);
  });

  it('is view only while switched without Act as them', () => {
    expect(isViewOnly({ viewAs: { by, act: false } })).toBe(true);
    expect(isViewOnly({ viewAs: { by, act: true } })).toBe(false);
    expect(isViewOnly({ viewAs: null })).toBe(false);
    expect(isViewOnly({})).toBe(false);
  });
});

describe('the banner and the refusal', () => {
  it('names the user, their email and roles', () => {
    expect(viewingAsText({ name: 'Nour Adel', email: 'nour@trendlix.com', roles: ['employee', 'manager'] })).toBe(
      'Viewing as Nour Adel (nour@trendlix.com) · Employee, Direct manager',
    );
    expect(viewingAsText({ name: null, email: 'hr@trendlix.com', roles: ['hr'] })).toBe('Viewing as hr@trendlix.com · HR');
    expect(rolesText(['super_admin'])).toBe('Super Admin');
  });

  it('refuses with the words the API uses', () => {
    expect(viewOnlyMessage('Nour Adel')).toBe('Viewing as Nour Adel: view only. Switch on Act as them to make changes.');
  });
});

describe('viewAsChoices and filterChoices', () => {
  const users = [
    account('super-1', 'owner@trendlix.com', { roles: ['super_admin'] }),
    account('u-2', 'zeinab@trendlix.com', { employee: { id: 'e2', employeeCode: 'EMP-2', fullNameEn: 'Zeinab Hassan' } }),
    account('u-3', 'ahmed@trendlix.com', { roles: ['hr', 'employee'], employee: { id: 'e3', employeeCode: 'EMP-3', fullNameEn: 'Ahmed Fawzy' } }),
    account('u-4', 'left@trendlix.com', { isActive: false }),
    account('u-5', 'finance@trendlix.com', { roles: ['finance'] }),
  ];

  it('lists every active user but the Super Admin, by name, those without a profile after them', () => {
    expect(viewAsChoices(users, 'super-1')).toEqual([
      { id: 'u-3', name: 'Ahmed Fawzy', email: 'ahmed@trendlix.com', roles: ['hr', 'employee'] },
      { id: 'u-2', name: 'Zeinab Hassan', email: 'zeinab@trendlix.com', roles: ['employee'] },
      { id: 'u-5', name: null, email: 'finance@trendlix.com', roles: ['finance'] },
    ]);
  });

  it('finds people by any word of their name, email or roles', () => {
    const choices = viewAsChoices(users, 'super-1');
    const ids = (q: string) => filterChoices(choices, q).map((c) => c.id);
    expect(ids('')).toEqual(['u-3', 'u-2', 'u-5']);
    expect(ids('zein')).toEqual(['u-2']);
    expect(ids('HR ahmed')).toEqual(['u-3']);
    expect(ids('finance')).toEqual(['u-5']);
    expect(ids('nobody')).toEqual([]);
  });
});

describe('sessionCookieFrom', () => {
  const name = 'ps_session';

  it('reads the token and how long it lasts', () => {
    const header = 'ps_session=aaa.bbb.ccc; Max-Age=1800; Path=/; Expires=Sat, 17 Oct 2026 08:00:00 GMT; HttpOnly; SameSite=Lax';
    expect(sessionCookieFrom(['other=1; Path=/', header], name)).toEqual({ token: 'aaa.bbb.ccc', maxAge: 1800 });
  });

  it('keeps a token with = in it whole, and leaves the lifetime out when none is said', () => {
    expect(sessionCookieFrom(['ps_session=a=b.c; Path=/'], name)).toEqual({ token: 'a=b.c', maxAge: null });
  });

  it('is null without the cookie, or when it is cleared', () => {
    expect(sessionCookieFrom([], name)).toBeNull();
    expect(sessionCookieFrom(['ps_session_old=x'], name)).toBeNull();
    expect(sessionCookieFrom(['ps_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], name)).toBeNull();
  });
});
