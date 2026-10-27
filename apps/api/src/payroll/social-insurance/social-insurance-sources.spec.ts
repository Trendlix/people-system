import { Prisma } from '../../generated/prisma/client.js';
import { contractPayOf, inPlace, latestPerPerson, leftOnOf, sourceOf, standingOf, versionIn, type SiEmploymentRow } from './social-insurance-sources.js';

// What the Social Insurance report reads of each employment (owner, 27 October 2026: "is there a report for the social
// insurance? to be filled from the social insurance tab"): its end as payroll takes it, each person's employment, the
// place filter, and the contract pay the insured wage stands on, today as the tab shows it and for a month as payroll
// takes it (after a raise, the pay before it until the next January or Form 2). Everyone here is invented.

const D = (n: number) => new Prisma.Decimal(n);
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

type Contract = SiEmploymentRow['contracts'][number];

const contract = (version: number, gross: number, over: { status?: string; startDate?: string; endDate?: string | null; approval?: string | null } = {}): Contract => ({
  id: `c${version}`,
  version,
  approval: over.approval ?? null,
  status: over.status ?? 'active',
  startDate: day(over.startDate ?? '2026-02-01'),
  endDate: over.endDate ? day(over.endDate) : null,
  form2From: null,
  grossSalary: D(gross),
  allowances: [{ amount: D(1000) }],
});

const employment = (over: Partial<SiEmploymentRow> = {}): SiEmploymentRow => ({
  id: 'employment-1',
  employeeId: 'employee-1',
  employmentType: 'full_time',
  status: 'active',
  joinDate: day('2026-02-01'),
  endDate: null,
  departmentId: 'team-1',
  department: { nameEn: 'Field', parentId: 'department-1', parent: { nameEn: 'Sales' } },
  endings: [],
  contracts: [contract(1, 10000)],
  employee: {
    id: 'employee-1',
    employeeCode: 'EMP-0001',
    fullNameEn: 'Rana Insured',
    fullNameAr: 'رنا',
    insuranceNo: '12345678',
    occupationCode: '194200',
    insuranceStartDate: day('2026-02-01'),
    insuranceBasicWage: null,
    insuranceComprehensiveWage: D(9000),
    socialInsured: true,
    identity: { nationalId: '29001011234567' },
  },
  ...over,
});

describe('what the Social Insurance report reads of an employment', () => {
  it('ends on its end date, or an approved ending’s last working day when earlier; a pending one doesn’t end it', () => {
    expect(leftOnOf(employment())).toBeNull();
    expect(leftOnOf(employment({ endDate: day('2026-09-30') }))).toBe('2026-09-30');
    expect(leftOnOf(employment({ endings: [{ status: 'approved', lastWorkingDay: day('2026-10-20') }] }))).toBe('2026-10-20');
    expect(leftOnOf(employment({ endings: [{ status: 'pending_ceo', lastWorkingDay: day('2026-10-20') }] }))).toBeNull();
    expect(leftOnOf(employment({ endDate: day('2026-10-15'), endings: [{ status: 'approved', lastWorkingDay: day('2026-10-20') }] }))).toBe('2026-10-15');
  });

  it('stands as its status, Former once ended', () => {
    expect(standingOf(employment())).toBe('active');
    expect(standingOf(employment({ status: 'notice_period' }))).toBe('notice_period');
    expect(standingOf(employment({ status: 'resigned', endDate: day('2026-09-30') }))).toBe('former');
  });

  it('each person once: the current employment, else the one that started last', () => {
    const old = employment({ id: 'old', joinDate: day('2024-01-01'), endDate: day('2024-12-31') });
    const older = employment({ id: 'older', joinDate: day('2023-01-01'), endDate: day('2023-06-30') });
    const now = employment({ id: 'now', joinDate: day('2026-02-01') });
    expect(latestPerPerson([old, now, older]).map((e) => e.id)).toEqual(['now']);
    expect(latestPerPerson([older, old]).map((e) => e.id)).toEqual(['old']);
    const other = employment({ id: 'other', employeeId: 'employee-2' });
    expect(latestPerPerson([now, other]).map((e) => e.id)).toEqual(['now', 'other']);
  });

  it('a department takes its teams in; a team only itself', () => {
    expect(inPlace(employment(), null)).toBe(true);
    expect(inPlace(employment(), 'department-1')).toBe(true);
    expect(inPlace(employment(), 'team-1')).toBe(true);
    expect(inPlace(employment(), 'team-2')).toBe(false);
    expect(inPlace(employment({ departmentId: null, department: null }), 'department-1')).toBe(false);
  });

  it('the version in force latest within some days', () => {
    const versions = [
      { startDate: '2026-02-01', endDate: '2026-07-31', version: 1 },
      { startDate: '2026-08-01', endDate: null, version: 2 },
    ];
    expect(versionIn(versions, '2026-07-01', '2026-07-31')?.version).toBe(1);
    expect(versionIn(versions, '2026-07-01', '2026-08-31')?.version).toBe(2);
    expect(versionIn(versions, '2026-01-01', '2026-01-31')).toBeNull();
  });

  describe('the contract pay the insured wage stands on', () => {
    it('today, as the tab shows it: the newest signed version', () => {
      expect(contractPayOf(employment(), { today: '2026-10-27' })).toBe(11000);
      expect(contractPayOf(employment({ contracts: [] }), { today: '2026-10-27' })).toBeNull();
    });

    it('after a signed raise: the pay before it until the next January', () => {
      const raised = employment({ contracts: [contract(1, 10000, { status: 'superseded' }), contract(2, 14000, { startDate: '2026-10-01', approval: 'approved' })] });
      expect(contractPayOf(raised, { today: '2026-10-27' })).toBe(11000);
      expect(contractPayOf(raised, { today: '2027-01-05' })).toBe(15000);
      expect(contractPayOf(raised, { month: '2026-12' })).toBe(11000);
      expect(contractPayOf(raised, { month: '2027-01' })).toBe(15000);
    });

    it('a leaver: the version in force on their last day, as the tab no longer has a signed contract for them', () => {
      const left = employment({ endDate: day('2026-09-30'), status: 'resigned', contracts: [contract(1, 10000, { status: 'ended', endDate: '2026-09-30' })] });
      expect(contractPayOf(left, { today: '2026-10-27' })).toBe(11000);
    });

    it('for a month: the version in force in the days employed, none before the employment', () => {
      expect(contractPayOf(employment(), { month: '2026-02' })).toBe(11000);
      expect(contractPayOf(employment({ joinDate: day('2026-10-12'), contracts: [contract(1, 10000, { startDate: '2026-10-12' })] }), { month: '2026-10' })).toBe(11000);
      expect(contractPayOf(employment(), { month: '2026-01' })).toBeNull();
    });
  });

  it('turns into what the shared rows are made from, the national ID as the caller has it', () => {
    const s = sourceOf(employment({ endings: [{ status: 'pending_ceo', lastWorkingDay: day('2026-11-15') }] }), { today: '2026-10-27' }, (id) => (id ? `•••• ${id.slice(-4)}` : null), null);
    expect(s).toEqual({
      employee: { id: 'employee-1', employeeCode: 'EMP-0001', fullNameEn: 'Rana Insured', fullNameAr: 'رنا' },
      tab: {
        insuranceNo: '12345678',
        occupationCode: '194200',
        insuranceStartDate: '2026-02-01',
        insuranceBasicWage: null,
        insuranceComprehensiveWage: 9000,
        socialInsured: true,
      },
      nationalId: '•••• 4567',
      employment: {
        id: 'employment-1',
        employmentType: 'full_time',
        standing: 'active',
        joinDate: '2026-02-01',
        leftOn: null,
        // an ending waiting for the CEO makes Form 6 due, as the Employment tab offers it
        endingRecorded: true,
        department: { nameEn: 'Field', parent: { nameEn: 'Sales' } },
      },
      contractPay: 11000,
      file: null,
    });
  });
});
