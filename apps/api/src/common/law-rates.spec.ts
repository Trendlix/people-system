import {
  annualSalaryTax,
  BUILT_IN_LAW_RATES,
  EMPTY_PAYROLL_INPUTS,
  grossToNet,
  hourlyRateFromNet,
  insurableWageLimits,
  insuredWageFrom,
  insuredWageOf,
  LAW_7_2024_TAX_TIERS,
  lawRatesFor,
  lawRatesProblems,
  monthlySalaryTax,
  netToGross,
  normalLawRates,
  payrollLine,
  PAYROLL_RULE_DEFAULTS,
  TAX_TIER_LIMITS,
  taxTierLimits,
  taxTiersProblems,
  type LawRates,
  type PayrollTerms,
  type TaxTier,
} from '@trendlix/shared';

// The rates set by law, by year (packages/shared/src/law-rates.ts; owner's request, 16 October 2026): kept in the
// database and changed by the Super Admin, so every calculation takes them. The built-in ones are the law as it was
// (Law 7/2024, NOSI's limits for 2025 and 2026) and give exactly what the constants gave; changed ones change the result.

const Y2026 = lawRatesFor(2026);
/** 2026's rates with some changed. */
const changed = (change: Partial<LawRates>): LawRates => ({ ...Y2026, ...change });

describe('law rates: the year that applies', () => {
  const years = [changed({ year: 2026 }), changed({ year: 2024, insurableWageMax: 12_600 }), changed({ year: 2028, insurableWageMax: 20_000 })];

  it("uses the year's own rates, else the latest earlier year's, else the earliest's", () => {
    expect(lawRatesFor(2026, years).year).toBe(2026);
    expect(lawRatesFor(2027, years).year).toBe(2026);
    expect(lawRatesFor(2030, years).insurableWageMax).toBe(20_000);
    expect(lawRatesFor(2025, years).year).toBe(2024);
    expect(lawRatesFor(2020, years).year).toBe(2024); // before them all: the earliest
  });

  it('uses the built-in rates with none kept', () => {
    expect(lawRatesFor(2026, [])).toBe(lawRatesFor(2026));
    expect(lawRatesFor(2027)).toEqual({ ...BUILT_IN_LAW_RATES[1], year: 2026 });
    expect(lawRatesFor(2024).year).toBe(2025);
  });

  it('has the constants as they were built in: 2025 and 2026, only the insurable limits differing', () => {
    expect(BUILT_IN_LAW_RATES.map((r) => r.year)).toEqual([2025, 2026]);
    for (const r of BUILT_IN_LAW_RATES) {
      expect(r).toMatchObject({ employeeInsuranceRate: 0.11, employerInsuranceRate: 0.1875, personalExemption: 20_000, martyrsRate: 0.0005, healthInsuranceRate: 0 });
      expect(r.taxTiers).toBe(LAW_7_2024_TAX_TIERS);
      expect(lawRatesProblems(r)).toEqual([]);
    }
    expect(insurableWageLimits(BUILT_IN_LAW_RATES[0])).toEqual({ year: 2025, min: 2300, max: 14500 });
    expect(insurableWageLimits(BUILT_IN_LAW_RATES[1])).toEqual({ year: 2026, min: 2700, max: 16700 });
    expect(TAX_TIER_LIMITS).toEqual([600_000, 700_000, 800_000, 900_000, 1_200_000]);
    expect(taxTierLimits(LAW_7_2024_TAX_TIERS)).toEqual(TAX_TIER_LIMITS);
  });

  it('puts the rates in one shape, whatever order their keys come in', () => {
    const shuffled = JSON.parse('{"taxTiers":[{"bands":[{"rate":0.1,"upTo":null}],"upTo":null}],"year":2027,"martyrsRate":0.0005}') as LawRates;
    expect(Object.keys(normalLawRates({ ...Y2026, ...shuffled }))[0]).toBe('year');
    expect(JSON.stringify(normalLawRates({ ...Y2026, ...shuffled }).taxTiers)).toBe('[{"upTo":null,"bands":[{"upTo":null,"rate":0.1}]}]');
  });
});

describe('law rates: the same results with the built-in rates', () => {
  // Law 7/2024 as the constants had it: the normal schedule, the lowest bands lost one by one, then 25% and 27.5%
  const NORMAL: [number, number][] = [
    [40_000, 0],
    [55_000, 0.1],
    [70_000, 0.15],
    [200_000, 0.2],
    [400_000, 0.225],
    [Infinity, 0.25],
  ];
  const OLD_TIERS: [number, [number, number][]][] = [
    [600_000, NORMAL],
    [700_000, NORMAL.slice(1)],
    [800_000, NORMAL.slice(2)],
    [900_000, NORMAL.slice(3)],
    [1_200_000, NORMAL.slice(4)],
    [
      Infinity,
      [
        [1_200_000, 0.25],
        [Infinity, 0.275],
      ],
    ],
  ];
  const oldTax = (income: number) => {
    if (income <= 0) return 0;
    let tax = 0;
    let from = 0;
    for (const [upTo, rate] of OLD_TIERS.find(([upTo]) => income <= upTo)![1]) {
      if (income <= from) break;
      tax += (Math.min(income, upTo) - from) * rate;
      from = upTo;
    }
    return Math.round((tax + Number.EPSILON) * 100) / 100;
  };

  it('taxes every income as the constants did', () => {
    for (let income = 0; income <= 1_500_000; income += 2_510) expect(annualSalaryTax(income)).toBe(oldTax(income));
    for (const limit of TAX_TIER_LIMITS) for (const income of [limit - 10, limit, limit + 10]) expect(annualSalaryTax(income, Y2026.taxTiers)).toBe(oldTax(income));
  });

  it('works a salary out the same from a year as from its rates', () => {
    for (const gross of [2_000, 7_000, 16_700, 25_000, 80_000]) {
      expect(grossToNet(gross, Y2026)).toEqual(grossToNet(gross, 2026));
      expect(grossToNet(gross, lawRatesFor(2025))).toEqual(grossToNet(gross, 2025));
    }
    expect(netToGross(13_069.65, Y2026)).toEqual(netToGross(13_069.65, 2026));
    expect(hourlyRateFromNet(120, 16, Y2026)).toEqual(hourlyRateFromNet(120, 16, 2026));
    expect(insuredWageOf(15_000, [{ amount: 3_000, taxable: true, insured: true }], Y2026)).toBe(16_700);
    expect(insuredWageFrom(20_000, lawRatesFor(2025))).toMatchObject({ amount: 14_500, adjusted: 'max', limits: { year: 2025, min: 2300, max: 14500 } });
  });
});

describe('law rates: changed rates change the result', () => {
  it('takes the insurance shares, the limits, the exemption and the Fund from the rates', () => {
    const before = grossToNet(10_000, Y2026);
    const after = grossToNet(10_000, changed({ employeeInsuranceRate: 0.12, employerInsuranceRate: 0.2, martyrsRate: 0.001, personalExemption: 30_000 }));
    expect(after.employeeInsurance).toBe(1_200);
    expect(after.employerInsurance).toBe(2_000);
    expect(after.martyrsFund).toBe(10);
    // 8,800 × 12 − 30,000 = 75,600, against 76,800 with the built-in rates
    expect(after.annualNetIncome).toBe(75_600);
    expect(before.annualNetIncome).toBe(86_800);
    // the tax on 75,600 is 4,870 a year, 405.83 a month: the larger exemption saves more than the larger share costs
    expect(after.net).toBe(8_384.17);
    expect(before.net).toBe(8_302.5);
    expect(grossToNet(20_000, changed({ insurableWageMax: 18_000 })).insuredWage).toBe(18_000);
    expect(grossToNet(2_000, changed({ insurableWageMin: 3_000 })).insuredWage).toBe(3_000);
    expect(insurableWageLimits(changed({ year: 2027, insurableWageMin: 3_000, insurableWageMax: 18_000 }))).toEqual({ year: 2027, min: 3_000, max: 18_000 });
  });

  it('deducts health insurance once it applies, before the tax', () => {
    const b = monthlySalaryTax({ taxedPay: 10_000, employeeInsurance: 1_100 }, changed({ healthInsuranceRate: 0.01 }));
    expect(b.healthInsurance).toBe(100);
    expect(b.monthlyTaxable).toBe(8_800);
  });

  it('taxes in changed tiers: a new rate, a band moved, a tier added', () => {
    const flat: TaxTier[] = [{ upTo: null, bands: [{ upTo: 50_000, rate: 0 }, { upTo: null, rate: 0.2 }] }];
    expect(annualSalaryTax(150_000, flat)).toBe(20_000);
    expect(grossToNet(16_700, changed({ taxTiers: flat })).annualTax).toBe(annualSalaryTax(158_350, flat)); // 21,670
    // the 25% band raised to 30%: incomes above 400,000 pay more, those below the same
    const higher = LAW_7_2024_TAX_TIERS.map((t) => ({ ...t, bands: t.bands.map((b) => (b.rate === 0.25 ? { ...b, rate: 0.3 } : b)) }));
    expect(annualSalaryTax(300_000, higher)).toBe(annualSalaryTax(300_000));
    expect(annualSalaryTax(500_000, higher)).toBe(annualSalaryTax(500_000) + 5_000);
    // a tier with no exemption band above 100,000: the tax jumps there
    const jump: TaxTier[] = [
      { upTo: 100_000, bands: [{ upTo: 40_000, rate: 0 }, { upTo: null, rate: 0.1 }] },
      { upTo: null, bands: [{ upTo: null, rate: 0.1 }] },
    ];
    expect(annualSalaryTax(100_000, jump)).toBe(6_000);
    expect(annualSalaryTax(100_010, jump)).toBe(10_001);
  });

  it('grosses up across a tier limit below the insurable cap', () => {
    const jump: TaxTier[] = [
      { upTo: 100_000, bands: [{ upTo: 40_000, rate: 0 }, { upTo: null, rate: 0.1 }] },
      { upTo: null, bands: [{ upTo: null, rate: 0.1 }] },
    ];
    const r = changed({ taxTiers: jump });
    for (const net of [5_000, 9_000, 9_400, 9_500, 12_000, 30_000]) {
      const b = netToGross(net, r);
      expect(b.net).toBeGreaterThanOrEqual(net);
      // the lowest whole-pound gross: every gross below gives less
      for (let g = Math.max(1, b.gross - 300); g < b.gross; g++) expect(grossToNet(g, r).net).toBeLessThan(net);
    }
  });

  it("works a payroll line out with the run's rates", () => {
    const terms: PayrollTerms = {
      year: 2026,
      payBasis: 'monthly',
      gross: 12_000,
      basicPercent: 80,
      hourlyRate: null,
      allowances: [],
      paidDays: 30,
      statutory: true,
      insured: true,
      insuredWage: 12_000,
      hoursPerDay: 9,
    };
    const builtIn = payrollLine(terms, EMPTY_PAYROLL_INPUTS);
    expect(payrollLine(terms, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, Y2026)).toEqual(builtIn);
    const law = changed({ employeeInsuranceRate: 0.12, employerInsuranceRate: 0.2, martyrsRate: 0.001 });
    // a Penalty (days) of 1 day (owner, 17 October 2026: entered on Additions / Deductions)
    const penalty = { id: 'p1', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1, reason: 'Invented' } as const;
    const line = payrollLine({ ...terms, adjustments: [penalty] }, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, law);
    expect(line).toMatchObject({ employeeInsurance: 1_440, employerInsurance: 2_400, martyrsFund: 12 });
    // a penalty day costs a day of the contract's net with the same rates
    expect(line.penaltyCut).toBe(Math.round((grossToNet(12_000, law).net / 30) * 100) / 100);
    expect(line.net).toBeLessThan(builtIn.net);
  });
});

describe('law rates: the checks', () => {
  const tiers = (t: unknown) => taxTiersProblems(t);

  it('takes the built-in table and a simple one', () => {
    expect(tiers(LAW_7_2024_TAX_TIERS)).toEqual([]);
    expect(tiers([{ upTo: null, bands: [{ upTo: null, rate: 0.1 }] }])).toEqual([]);
  });

  it('needs tiers with rising limits, the last without one', () => {
    expect(tiers([])).toEqual(['Add at least one tax tier.']);
    expect(tiers('none')).toEqual(['Add at least one tax tier.']);
    const band = [{ upTo: null, rate: 0.1 }];
    expect(tiers([{ upTo: 600_000, bands: band }])).toEqual(['The last tier must have no income limit, so that every income falls in a tier.']);
    expect(tiers([{ upTo: null, bands: band }, { upTo: null, bands: band }])).toEqual(['Tier 1: only the last tier can be without an income limit.']);
    expect(
      tiers([
        { upTo: 600_000, bands: band },
        { upTo: 500_000, bands: band },
        { upTo: null, bands: band },
      ]),
    ).toEqual(["Tier 2's income limit (500,000.00) must be above tier 1's (600,000.00)."]);
    expect(tiers([{ upTo: -5, bands: band }, { upTo: null, bands: band }])).toEqual(['Tier 1: enter its income limit as an amount above 0, to the piaster.']);
    expect(tiers([{ upTo: 100.001, bands: band }, { upTo: null, bands: band }])).toEqual(['Tier 1: enter its income limit as an amount above 0, to the piaster.']);
    expect(tiers(Array.from({ length: 21 }, () => ({ upTo: null, bands: band })))).toEqual(['Keep the tax table to 20 tiers or fewer.']);
    expect(tiers([null])).toEqual(['Tier 1 is not a tier: give its income limit and its bands.']);
  });

  it('needs bands with rising limits, the last without one, and rates from 0% to 100%', () => {
    const tier = (bands: unknown) => tiers([{ upTo: null, bands }]);
    expect(tier([])).toEqual(['Tier 1 has no bands: add at least one.']);
    expect(tier([{ upTo: 40_000, rate: 0 }])).toEqual(['Tier 1: its last band must have no upper limit, so that the whole income is taxed.']);
    expect(
      tier([
        { upTo: null, rate: 0 },
        { upTo: null, rate: 0.1 },
      ]),
    ).toEqual(['Tier 1, band 1: only the last band can be without an upper limit.']);
    expect(
      tier([
        { upTo: 55_000, rate: 0 },
        { upTo: 40_000, rate: 0.1 },
        { upTo: null, rate: 0.2 },
      ]),
    ).toEqual(["Tier 1, band 2's upper limit (40,000.00) must be above band 1's (55,000.00)."]);
    expect(tier([{ upTo: null, rate: 1.5 }])).toEqual(['Tier 1, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.']);
    expect(tier([{ upTo: null, rate: -0.1 }])).toEqual(['Tier 1, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.']);
    expect(tier([{ upTo: null, rate: 0.1234567 }])).toEqual(['Tier 1, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.']);
    expect(tier([{ upTo: null, rate: 0.123456 }])).toEqual([]);
    expect(tier([{ upTo: null }])).toEqual(['Tier 1, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.']);
  });

  it("checks a year's rates: the year, each rate, the limits and the exemption", () => {
    expect(lawRatesProblems(changed({ year: 1999 }))).toEqual(['Enter the year from 2000 to 2100.']);
    expect(lawRatesProblems(changed({ year: 2026.5 }))).toEqual(['Enter the year from 2000 to 2100.']);
    expect(lawRatesProblems(changed({ employeeInsuranceRate: 1.1, martyrsRate: -0.01 }))).toEqual([
      "The employee's social insurance share must be a percent from 0 to 100, with up to 4 decimals.",
      "The Martyrs' Fund rate must be a percent from 0 to 100, with up to 4 decimals.",
    ]);
    expect(lawRatesProblems(changed({ insurableWageMin: 5_000, insurableWageMax: 4_000 }))).toEqual([
      "The maximum insurable wage (4,000.00) can't be below the minimum (5,000.00).",
    ]);
    expect(lawRatesProblems(changed({ insurableWageMin: 0 }))).toEqual(['Enter the minimum insurable wage as an amount above 0, to the piaster.']);
    expect(lawRatesProblems(changed({ personalExemption: -1 }))).toEqual(['Enter the personal exemption as an amount of 0 or more, to the piaster.']);
    expect(lawRatesProblems(changed({ personalExemption: 20_000.005 }))).toEqual(['Enter the personal exemption as an amount of 0 or more, to the piaster.']);
    expect(lawRatesProblems(changed({ taxTiers: [] }))).toEqual(['Add at least one tax tier.']);
  });
});
