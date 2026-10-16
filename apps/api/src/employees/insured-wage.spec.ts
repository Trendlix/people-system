import { Prisma } from '../generated/prisma/client.js';
import { insuredContractPay, insuredVersionOf } from './insured-wage.js';

// The contract pay the Social Insurance tab's insured wage stands on (owner's decision, 16 October 2026: "From the
// next January unless amended in Form 2"), as payroll takes it.

const D = (n: number) => new Prisma.Decimal(n);
const day = (ymd: string | null) => (ymd ? new Date(`${ymd}T00:00:00Z`) : null);

const row = (version: number, gross: number, over: { approval?: string | null; startDate?: string; form2From?: string | null } = {}) =>
  insuredVersionOf({
    id: `v${version}`,
    version,
    approval: over.approval ?? null,
    startDate: day(over.startDate ?? '2026-03-01')!,
    form2From: day(over.form2From ?? null),
    grossSalary: D(gross),
    allowances: [{ amount: D(500) }],
  });

describe('the insured wage’s contract pay', () => {
  const v1 = row(1, 10000);
  const raise = row(2, 13000, { approval: 'approved', startDate: '2026-11-01' });

  it('a version reads as its gross and allowances, a raise with its insured-wage date', () => {
    expect(v1).toEqual({ id: 'v1', version: 1, total: 10500, insuredWageFrom: null, form2From: null });
    expect(raise).toMatchObject({ total: 13500, insuredWageFrom: '2027-01-01', form2From: null });
    expect(row(2, 13000, { approval: 'approved', startDate: '2026-11-01', form2From: '2026-12-01' })).toMatchObject({ insuredWageFrom: '2026-12-01', form2From: '2026-12-01' });
  });

  it('after a signed raise: the pay before it until the next January, saying so', () => {
    expect(insuredContractPay(raise, [v1, raise], '2026-10-16')).toEqual({ total: 10500, asBefore: { until: '2027-01-01', form2Filed: false } });
    expect(insuredContractPay(raise, [v1, raise], '2026-12-31')).toEqual({ total: 10500, asBefore: { until: '2027-01-01', form2Filed: false } });
    expect(insuredContractPay(raise, [v1, raise], '2027-01-01')).toEqual({ total: 13500, asBefore: null });
  });

  it('with Form 2 filed: until its date', () => {
    const filed = row(2, 13000, { approval: 'approved', startDate: '2026-11-01', form2From: '2026-12-01' });
    expect(insuredContractPay(filed, [v1, filed], '2026-11-20')).toEqual({ total: 10500, asBefore: { until: '2026-12-01', form2Filed: true } });
    expect(insuredContractPay(filed, [v1, filed], '2026-12-01')).toEqual({ total: 13500, asBefore: null });
  });

  it('no raise, or no signed contract', () => {
    expect(insuredContractPay(v1, [v1], '2026-10-16')).toEqual({ total: 10500, asBefore: null });
    expect(insuredContractPay(null, [], '2026-10-16')).toEqual({ total: null, asBefore: null });
  });
});
