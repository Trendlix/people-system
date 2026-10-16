import { describe, expect, it } from 'vitest';
import {
  anchorAddress,
  askedTab,
  contractDocumentsHref,
  contractHref,
  EMPLOYMENT_SUB_TABS,
  employeeRaiseRequestsHref,
  employmentHref,
  isEmploymentSubTab,
  isProfileTab,
  openSubTab,
  PROFILE_TABS,
  payslipsHref,
  profileHref,
  salaryHistoryHref,
  subTabOfAnchor,
  visibleSubTabs,
  type EmploymentSubTabKey,
} from './tab-list';

describe('the profile’s tabs', () => {
  it('have Employment hold the contract and Basic Data hold Education: no Contracts or Education tab', () => {
    expect(PROFILE_TABS.map((t) => t.key)).toEqual(['basic', 'employment', 'insurance', 'documents']);
    expect(PROFILE_TABS.map((t) => t.label)).toEqual(['Basic Data', 'Employment', 'Social Insurance', 'Documents']);
  });

  it('are addressed with ?tab=, Basic Data without', () => {
    expect(profileHref('emp-1')).toBe('/employees/emp-1');
    expect(profileHref('emp-1', 'insurance')).toBe('/employees/emp-1?tab=insurance');
    expect(profileHref('emp-1', 'employment')).toBe('/employees/emp-1?tab=employment');
    // a tab that is gone links to the tab showing it now
    expect(profileHref('emp-1', 'education')).toBe('/employees/emp-1');
    expect(profileHref('emp-1', 'contracts')).toBe('/employees/emp-1?tab=employment');
  });

  it('know their own keys only', () => {
    expect(isProfileTab('insurance')).toBe(true);
    expect(isProfileTab('documents')).toBe(true);
    expect(isProfileTab('contracts')).toBe(false);
    expect(isProfileTab('payroll')).toBe(false);
  });

  it('open the Employment tab for an old address of the Contracts tab, and nothing for an unknown one', () => {
    expect(askedTab('contracts')).toBe('employment');
    expect(askedTab('education')).toBe('basic'); // Education is on Basic Data (owner, 17 October 2026)
    expect(askedTab('employment')).toBe('employment');
    expect(askedTab('insurance')).toBe('insurance');
    expect(askedTab('payroll')).toBeNull();
    expect(askedTab('')).toBeNull();
    // not a key of an object's own
    expect(askedTab('toString')).toBeNull();
  });
});

describe('the Employment tab’s sub-tabs', () => {
  const ALL: EmploymentSubTabKey[] = ['details', 'salary', 'documents'];

  it('are Details, Salary and Issued Documents, in that order, their names in Title Case', () => {
    expect(EMPLOYMENT_SUB_TABS.map((t) => t.key)).toEqual(ALL);
    // Issued Documents, not to be taken for the profile's Documents tab (the papers the employee brings)
    expect(EMPLOYMENT_SUB_TABS.map((t) => t.label)).toEqual(['Details', 'Salary', 'Issued Documents']);
  });

  it('are addressed with &sub= after ?tab=employment, Details without', () => {
    expect(employmentHref('emp-1')).toBe('/employees/emp-1?tab=employment');
    expect(employmentHref('emp-1', 'details')).toBe('/employees/emp-1?tab=employment');
    expect(employmentHref('emp-1', 'salary')).toBe('/employees/emp-1?tab=employment&sub=salary');
    expect(employmentHref('emp-1', 'documents')).toBe('/employees/emp-1?tab=employment&sub=documents');
  });

  it('link to each anchor on the sub-tab that holds it', () => {
    expect(contractHref('emp-1')).toBe('/employees/emp-1?tab=employment#contract');
    expect(salaryHistoryHref('emp-1')).toBe('/employees/emp-1?tab=employment&sub=salary#salary-history');
    expect(employeeRaiseRequestsHref('emp-1')).toBe('/employees/emp-1?tab=employment&sub=salary#raise-requests');
    expect(payslipsHref('emp-1')).toBe('/employees/emp-1?tab=employment&sub=salary#payslips');
    expect(contractDocumentsHref('emp-1')).toBe('/employees/emp-1?tab=employment&sub=documents#contract-documents');
  });

  it('know their own keys only', () => {
    expect(isEmploymentSubTab('salary')).toBe(true);
    expect(isEmploymentSubTab('documents')).toBe(true);
    expect(isEmploymentSubTab('payslips')).toBe(false);
    expect(isEmploymentSubTab('')).toBe(false);
  });

  it('show HR and the CEO all three, and Finance Details and Salary', () => {
    const keys = (can: Parameters<typeof visibleSubTabs>[0]) => visibleSubTabs(can).map((t) => t.key);
    expect(keys({ pay: true, raiseRequests: false, issuedDocuments: true })).toEqual(ALL);
    expect(keys({ pay: true, raiseRequests: false, issuedDocuments: false })).toEqual(['details', 'salary']);
  });

  it('show the employee or their manager Salary only with raise requests there for them, never Issued Documents', () => {
    const keys = (can: Parameters<typeof visibleSubTabs>[0]) => visibleSubTabs(can).map((t) => t.key);
    expect(keys({ pay: false, raiseRequests: true, issuedDocuments: false })).toEqual(['details', 'salary']);
    expect(keys({ pay: false, raiseRequests: false, issuedDocuments: false })).toEqual(['details']);
  });

  it('open the one asked for if the viewer sees it, else Details', () => {
    expect(openSubTab('salary', ALL)).toBe('salary');
    expect(openSubTab('documents', ALL)).toBe('documents');
    expect(openSubTab('', ALL)).toBe('details');
    expect(openSubTab('payroll', ALL)).toBe('details');
    // Finance asking for Issued Documents, or an employee for Salary without raise requests
    expect(openSubTab('documents', ['details', 'salary'])).toBe('details');
    expect(openSubTab('salary', ['details'])).toBe('details');
  });
});

describe('a link that names only an anchor', () => {
  const ALL: EmploymentSubTabKey[] = ['details', 'salary', 'documents'];

  it('finds the sub-tab holding the anchor, with or without its #', () => {
    expect(subTabOfAnchor('#salary-history')).toBe('salary');
    expect(subTabOfAnchor('#raise-requests')).toBe('salary');
    expect(subTabOfAnchor('#payslips')).toBe('salary');
    expect(subTabOfAnchor('payslips')).toBe('salary');
    expect(subTabOfAnchor('#contract-documents')).toBe('documents');
    expect(subTabOfAnchor('#contract')).toBe('details');
    // a missing detail's field, from the profile's header or the Missing Details report
    expect(subTabOfAnchor('#field-manager')).toBe('details');
    expect(subTabOfAnchor('#somewhere')).toBeNull();
    expect(subTabOfAnchor('')).toBeNull();
  });

  it('moves to that sub-tab, keeping the hash', () => {
    expect(anchorAddress('/employees/emp-1?tab=employment#salary-history', ALL)).toBe('/employees/emp-1?tab=employment&sub=salary#salary-history');
    expect(anchorAddress('/employees/emp-1?tab=employment#raise-requests', ALL)).toBe('/employees/emp-1?tab=employment&sub=salary#raise-requests');
    expect(anchorAddress('/employees/emp-1?tab=employment#payslips', ALL)).toBe('/employees/emp-1?tab=employment&sub=salary#payslips');
    expect(anchorAddress('/employees/emp-1?tab=employment#contract-documents', ALL)).toBe(
      '/employees/emp-1?tab=employment&sub=documents#contract-documents',
    );
  });

  it('moves the old Contracts tab’s links too, as Employment, and keeps any other parameter', () => {
    expect(anchorAddress('/employees/emp-1?tab=contracts#payslips', ALL)).toBe('/employees/emp-1?tab=employment&sub=salary#payslips');
    expect(anchorAddress('/employees/emp-1?tab=employment&added=1#contract-documents', ALL)).toBe(
      '/employees/emp-1?tab=employment&added=1&sub=documents#contract-documents',
    );
  });

  it('goes back to Details for the contract asked for from another sub-tab', () => {
    expect(anchorAddress('/employees/emp-1?tab=employment&sub=salary#contract', ALL)).toBe('/employees/emp-1?tab=employment#contract');
  });

  it('stays where it is on the right sub-tab already, without an anchor it knows, or off the Employment tab', () => {
    expect(anchorAddress('/employees/emp-1?tab=employment&sub=salary#payslips', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1?tab=employment#contract', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1?tab=employment#field-shift', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1?tab=employment', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1?tab=employment#somewhere', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1?tab=insurance#contract-documents', ALL)).toBeNull();
    expect(anchorAddress('/employees/emp-1#payslips', ALL)).toBeNull();
  });

  it('never moves to a sub-tab the viewer doesn’t see', () => {
    // an employee with no raise requests to see: Details only
    expect(anchorAddress('/employees/emp-1?tab=employment#raise-requests', ['details'])).toBeNull();
    // Finance: no Issued Documents
    expect(anchorAddress('/employees/emp-1?tab=employment#contract-documents', ['details', 'salary'])).toBeNull();
    // and a sub-tab asked for but not seen opens Details, where the contract already is
    expect(anchorAddress('/employees/emp-1?tab=employment&sub=documents#contract', ['details', 'salary'])).toBeNull();
  });
});
