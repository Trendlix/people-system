import { describe, expect, it } from 'vitest';
import type { EmployeeSummary, EmployeeSummaryEmployment, FullEmployeeSummary } from '../../../lib/types';
import { CONTRACT_TONE_STYLE, directoryContractStatus } from './contract-status';

// The Employees list's Contract column (owner, 21 October 2026: "instead of the Emp code, add contract status"). Today
// is 21/10/2026 throughout.

const TODAY = '2026-10-21';

const job = (over: Partial<EmployeeSummaryEmployment> = {}): EmployeeSummaryEmployment => ({
  id: 'e1',
  status: 'active',
  employmentType: 'full_time',
  joinDate: '2026-01-01',
  department: null,
  jobTitle: { id: 't1', titleEn: 'Content Creator' },
  gradeId: null,
  grade: null,
  manager: null,
  probationEnd: '2026-03-31',
  contract: { status: 'active', form: 'fixed', startDate: '2026-01-01', endDate: '2026-12-31' },
  endingOn: null,
  ...over,
});

const row = (over: Partial<FullEmployeeSummary> = {}): EmployeeSummary => ({
  id: 'p1',
  employeeCode: 'EMP-0007',
  fullNameEn: 'Sara Ali',
  fullNameAr: 'سارة علي',
  workEmail: null,
  standing: 'active',
  confidential: false,
  restricted: false,
  employment: job(),
  lastEnded: null,
  ...over,
});

describe('the Employees list’s contract status', () => {
  it('words the current employment’s contract', () => {
    expect(directoryContractStatus(row(), TODAY)).toEqual({ state: 'signed', text: 'Signed · ends 31/12/2026', endsOn: '2026-12-31', tone: 'ok' });
    expect(directoryContractStatus(row({ employment: job({ contract: { status: 'active', form: 'fixed', startDate: '2026-01-01', endDate: '2026-11-05' } }) }), TODAY)).toMatchObject({
      text: 'Signed · ends 05/11/2026 (in 15 days)',
      tone: 'warn',
    });
    expect(directoryContractStatus(row({ employment: job({ status: 'probation', probationEnd: '2027-01-15' }) }), TODAY)?.text).toBe('On probation until 15/01/2027');
    expect(directoryContractStatus(row({ employment: job({ contract: null }) }), TODAY)?.text).toBe('No contract');
    expect(directoryContractStatus(row({ employment: job({ status: 'notice_period', endingOn: '2026-11-30' }) }), TODAY)?.text).toBe('Ending 30/11/2026 (notice)');
    expect(directoryContractStatus(row({ employment: job({ employmentType: 'freelance' }) }), TODAY)?.text).toBe('Freelance: no labour contract');
  });

  it('says when a former employee left, or that someone was never employed', () => {
    expect(directoryContractStatus(row({ standing: 'former', employment: null, lastEnded: { endDate: '2026-09-30', endReason: 'resigned' } }), TODAY)).toMatchObject({
      state: 'left',
      text: 'Left on 30/09/2026',
      tone: 'muted',
    });
    expect(directoryContractStatus(row({ standing: 'not_employed', employment: null }), TODAY)?.text).toBe('No employment');
  });

  it('shows nothing on a C-level person’s card, nor from an API without the facts', () => {
    const card: EmployeeSummary = {
      id: 'p2',
      employeeCode: 'EMP-0001',
      fullNameEn: 'Clara Chief',
      fullNameAr: 'كلارا',
      workEmail: null,
      standing: 'active',
      confidential: true,
      restricted: true,
      employment: { id: 'e2', status: 'active', department: null, jobTitle: null },
      lastEnded: null,
    };
    expect(directoryContractStatus(card, TODAY)).toBeNull();
    // a row from before the contract status: no probationEnd, contract nor endingOn
    const older = job();
    delete older.probationEnd;
    delete older.contract;
    delete older.endingOn;
    expect(directoryContractStatus(row({ employment: older }), TODAY)).toBeNull();
  });

  it('is amber when warned, quiet when nothing is in force', () => {
    expect(CONTRACT_TONE_STYLE).toEqual({ ok: '', warn: 'font-semibold text-warn', muted: 'text-muted' });
  });
});
