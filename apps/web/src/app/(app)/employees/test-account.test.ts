import { describe, expect, it } from 'vitest';
import { employeesApiPath, managesTestAccounts, sampleAccountMessage, TEST_ACCOUNTS_HREF, testAccountConfirm } from './test-account';

// Test accounts for app reviewers (owner, 6 November 2026: a tester account for Google and Apple "without real data").

describe('who manages test accounts', () => {
  it('is HR and a Super Admin', () => {
    expect(managesTestAccounts({ roles: ['hr'] })).toBe(true);
    expect(managesTestAccounts({ roles: ['super_admin'] })).toBe(true);
    expect(managesTestAccounts({ roles: ['employee', 'hr'] })).toBe(true);
  });

  it('is nobody else, and never a developer', () => {
    expect(managesTestAccounts({ roles: ['employee'] })).toBe(false);
    expect(managesTestAccounts({ roles: ['admin'] })).toBe(false);
    expect(managesTestAccounts({ roles: ['ceo'] })).toBe(false);
    expect(managesTestAccounts({ roles: ['finance'] })).toBe(false);
    expect(managesTestAccounts({ roles: ['super_admin'], developer: true })).toBe(false);
  });
});

describe('the Employees list', () => {
  it('asks for the test accounts only under their filter', () => {
    expect(employeesApiPath(true)).toBe('/employees?tests=only');
    expect(employeesApiPath(false)).toBe('/employees');
    expect(TEST_ACCOUNTS_HREF).toBe('/employees?tests=only');
  });
});

describe('the confirm', () => {
  it('names the person', () => {
    expect(testAccountConfirm('Play Reviewer')).toMatch(/^Make Play Reviewer a test account\?/);
  });
});

describe('the sample account', () => {
  it('says what was made', () => {
    expect(sampleAccountMessage({ created: true, days: 46, requests: 4 })).toBe('Sample account set up, with 46 days of check-ins and 4 requests.');
    expect(sampleAccountMessage({ created: false, days: 46, requests: 4 })).toBe('Sample data made again as of today: 46 days of check-ins and 4 requests.');
  });
});
