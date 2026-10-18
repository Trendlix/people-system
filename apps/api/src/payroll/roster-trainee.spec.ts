import { EMPTY_PAYROLL_INPUTS, payrollLine } from '@trendlix/shared';
import { byTraineeStage, roster, type RosterContract, type RosterEmployment } from './roster.js';

// A trainee's training agreement on the payroll (owner, 18 October 2026; Labour Law 14/2025 Art. 29: "المكافأة التى
// يحصل عليها المتدرج فى كل مرحلة بصورة تصاعدية"): each stage paid at its own pay in its own days. Everyone here is invented.

const STAGES = [
  { name: 'Basics', months: 3, pay: 4000 },
  { name: 'Practice', months: 3, pay: 5500 },
];

const agreement = (over: Partial<RosterContract> = {}): RosterContract => ({
  id: 'contract-t1',
  number: 'CON-2026-0040',
  version: 1,
  startDate: '2026-03-15',
  endDate: '2026-09-14',
  payBasis: 'monthly',
  grossSalary: 4000,
  basicPercent: 100,
  hourlyRate: null,
  allowances: [],
  traineeStages: STAGES,
  ...over,
});

const trainee = (contracts: RosterContract[]): RosterEmployment => ({
  id: 'employment-t1',
  employmentType: 'trainee',
  joinDate: '2026-03-15',
  endDate: null,
  department: null,
  jobTitle: 'Junior Editor',
  shift: null,
  employee: { id: 'employee-t1', employeeCode: 'EMP-0901', fullNameEn: 'Tamer Trainee', socialInsured: true, insuranceComprehensiveWage: null },
  contracts,
});

describe('a trainee on the payroll', () => {
  it('splits the agreement into its stages, each from its first day at its pay, the last to the agreement’s end', () => {
    expect(byTraineeStage([agreement()]).map((c) => [c.startDate, c.endDate, c.grossSalary])).toEqual([
      ['2026-03-15', '2026-06-14', 4000],
      ['2026-06-15', '2026-09-14', 5500],
    ]);
    // a contract without stages as it is
    const plain = agreement({ traineeStages: null });
    expect(byTraineeStage([plain])).toEqual([plain]);
  });

  it('pays a month within one stage at that stage’s pay', () => {
    const [line] = roster('2026-04', [trainee([agreement()])], { dayDivisor: 30 }).lines;
    expect(line.terms.gross).toBe(4000);
    expect(line.terms.segments).toHaveLength(1);
    const [later] = roster('2026-07', [trainee([agreement()])], { dayDivisor: 30 }).lines;
    expect(later.terms.gross).toBe(5500);
    expect(later.contractId).toBe('contract-t1');
  });

  it('splits the month a new stage starts in by days, each part at its stage’s pay', () => {
    const [line] = roster('2026-06', [trainee([agreement()])], { dayDivisor: 30 }).lines;
    expect(line.terms.segments!.map((s) => [s.from, s.to, s.days, s.gross])).toEqual([
      ['2026-06-01', '2026-06-14', 14, 4000],
      ['2026-06-15', '2026-06-30', 16, 5500],
    ]);
    // the line's pay is the stage's at the month's end; earned: 14 days of 4,000 and 16 of 5,500
    expect(line.terms.gross).toBe(5500);
    const result = payrollLine(line.terms, EMPTY_PAYROLL_INPUTS);
    expect(result.earned).toBeCloseTo((4000 * 14) / 30 + (5500 * 16) / 30, 2);
  });
});
