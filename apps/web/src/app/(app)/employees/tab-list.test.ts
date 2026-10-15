import { describe, expect, it } from 'vitest';
import { isProfileTab, PROFILE_TABS, profileHref } from './tab-list';

describe('the profile’s tabs', () => {
  it('put Social Insurance between Contracts and Documents', () => {
    expect(PROFILE_TABS.map((t) => t.key)).toEqual(['basic', 'education', 'employment', 'contracts', 'insurance', 'documents']);
    expect(PROFILE_TABS.map((t) => t.label)).toEqual(['Basic Data', 'Education', 'Employment', 'Contracts', 'Social Insurance', 'Documents']);
  });

  it('are addressed with ?tab=, Basic Data without', () => {
    expect(profileHref('emp-1')).toBe('/employees/emp-1');
    expect(profileHref('emp-1', 'insurance')).toBe('/employees/emp-1?tab=insurance');
    expect(profileHref('emp-1', 'contracts')).toBe('/employees/emp-1?tab=contracts');
  });

  it('know their own keys only', () => {
    expect(isProfileTab('insurance')).toBe(true);
    expect(isProfileTab('documents')).toBe(true);
    expect(isProfileTab('payroll')).toBe(false);
  });
});
