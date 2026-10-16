import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { hasRole } from '../lib/roles';
import { activeSubItem, COMING_SOON, isUnder, NAV } from './nav';

const as = (...roles: Role[]) => ({ roles });
const templates = NAV.find((n) => n.href === '/templates')!;

describe('the sidebar', () => {
  it('shows Library and Fields Guide under Templates, for the same people as Templates', () => {
    expect(templates.items?.map((s) => [s.label, s.href])).toEqual([
      ['Library', '/templates'],
      ['Fields Guide', '/templates/tags'],
    ]);
    // the sub-items have no roles of their own: they show with their item
    expect(templates.items?.every((s) => !('roles' in s))).toBe(true);
    expect(hasRole(as('hr'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('ceo'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('super_admin'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'finance'), ...(templates.roles ?? []))).toBe(false);
  });

  it('highlights the Fields Guide on its page, and Library on every other page of the templates', () => {
    const current = (path: string) => activeSubItem(templates, path)?.label ?? null;
    expect(current('/templates')).toBe('Library');
    expect(current('/templates/contract_full_time')).toBe('Library');
    expect(current('/templates/nda/versions/0b8f/map')).toBe('Library');
    expect(current('/templates/tags')).toBe('Fields Guide');
    expect(current('/employees')).toBeNull();
    expect(current('/templatesx')).toBeNull();
  });

  it('shows Payroll after Contracts to HR, Finance and the CEO only, and no longer as coming next', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Payroll')).toBe(labels.indexOf('Contracts') + 1);
    const payroll = NAV.find((n) => n.href === '/payroll')!;
    expect(payroll.section).toBe('/payroll');
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(hasRole(as(role), ...(payroll.roles ?? []))).toBe(true);
    // salary data: not for an Admin or a Super Admin as such, nor a manager or an employee
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(payroll.roles ?? []))).toBe(false);
    expect(COMING_SOON).not.toContain('Payroll');
  });

  it('has no sub-item to highlight for an item without any', () => {
    expect(activeSubItem(NAV.find((n) => n.href === '/employees')!, '/employees')).toBeNull();
  });

  it('counts a page under a path, not one that only starts with the same letters', () => {
    expect(isUnder('/templates', '/templates')).toBe(true);
    expect(isUnder('/templates/tags', '/templates')).toBe(true);
    expect(isUnder('/templates-old', '/templates')).toBe(false);
    expect(isUnder('/templates', '/templates/tags')).toBe(false);
  });
});
