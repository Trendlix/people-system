import { describe, expect, it } from 'vitest';
import { askedTab, contractHref, isProfileTab, PROFILE_TABS, payslipsHref, profileHref } from './tab-list';

describe('the profile’s tabs', () => {
  it('have Employment hold the contract: no Contracts tab, Social Insurance between Employment and Documents', () => {
    expect(PROFILE_TABS.map((t) => t.key)).toEqual(['basic', 'education', 'employment', 'insurance', 'documents']);
    expect(PROFILE_TABS.map((t) => t.label)).toEqual(['Basic Data', 'Education', 'Employment', 'Social Insurance', 'Documents']);
  });

  it('are addressed with ?tab=, Basic Data without', () => {
    expect(profileHref('emp-1')).toBe('/employees/emp-1');
    expect(profileHref('emp-1', 'insurance')).toBe('/employees/emp-1?tab=insurance');
    expect(profileHref('emp-1', 'employment')).toBe('/employees/emp-1?tab=employment');
  });

  it('link to the contract and the payslips on the Employment tab, where the Contracts tab’s anchors are now', () => {
    expect(contractHref('emp-1')).toBe('/employees/emp-1?tab=employment#contract');
    expect(payslipsHref('emp-1')).toBe('/employees/emp-1?tab=employment#payslips');
  });

  it('know their own keys only', () => {
    expect(isProfileTab('insurance')).toBe(true);
    expect(isProfileTab('documents')).toBe(true);
    expect(isProfileTab('contracts')).toBe(false);
    expect(isProfileTab('payroll')).toBe(false);
  });

  it('open the Employment tab for an old address of the Contracts tab, and nothing for an unknown one', () => {
    expect(askedTab('contracts')).toBe('employment');
    expect(askedTab('employment')).toBe('employment');
    expect(askedTab('insurance')).toBe('insurance');
    expect(askedTab('payroll')).toBeNull();
    expect(askedTab('')).toBeNull();
    // not a key of an object's own
    expect(askedTab('toString')).toBeNull();
  });
});
