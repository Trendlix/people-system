import { describe, expect, it } from 'vitest';
import { managesOnboarding, offersOnboarding, onboardingHref, onboardingListHref, readOnboardingFilter } from './onboarding';

// Onboarding on the site (owner, 22 October 2026, the ATS's Phase 2).

describe('onboarding', () => {
  it('is HR’s, the CEO’s and a Super Admin’s', () => {
    expect(managesOnboarding({ roles: ['hr'] })).toBe(true);
    expect(managesOnboarding({ roles: ['ceo'] })).toBe(true);
    expect(managesOnboarding({ roles: ['super_admin'] })).toBe(true);
    expect(managesOnboarding({ roles: ['admin', 'finance', 'employee'] })).toBe(false);
  });

  it('reads the list’s filter, in progress unless asked', () => {
    expect(readOnboardingFilter({})).toBe('open');
    expect(readOnboardingFilter({ status: 'completed' })).toBe('completed');
    expect(readOnboardingFilter({ status: 'nonsense' })).toBe('open');
    expect(onboardingListHref('open')).toBe('/onboarding');
    expect(onboardingListHref('all')).toBe('/onboarding?status=all');
    expect(onboardingHref('abc')).toBe('/onboarding/abc');
  });

  it('offers to start one only for someone who joined in the last 90 days, or joins later', () => {
    expect(offersOnboarding({ joinDate: '2026-10-01' }, '2026-10-22')).toBe(true);
    expect(offersOnboarding({ joinDate: '2026-11-15' }, '2026-10-22')).toBe(true);
    expect(offersOnboarding({ joinDate: '2026-07-24' }, '2026-10-22')).toBe(true);
    expect(offersOnboarding({ joinDate: '2026-07-23' }, '2026-10-22')).toBe(false);
    expect(offersOnboarding({ joinDate: '2026-10-01', endDate: '2026-10-10' }, '2026-10-22')).toBe(false);
    expect(offersOnboarding(null, '2026-10-22')).toBe(false);
  });
});
