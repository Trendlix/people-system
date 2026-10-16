import { annualSalaryTax, grossToNet, hourlyRateFromNet, insuredWageOf, monthlyFromHourly, monthlySalaryTax, netToGross, type AllowanceTerms } from '@trendlix/shared';

// The shared salary calculation (packages/shared/src/salary.ts), checked against the Ministry of Finance's salary tax
// printout (February 2026) and the Tax Authority's own worked figures in its 2025 annual settlement guide.

describe('salary: gross to net', () => {
  it('matches the Ministry of Finance printout: gross 16,700 gives net 13,069.65', () => {
    expect(grossToNet(16_700, 2026)).toMatchObject({
      insuredWage: 16_700,
      employeeInsurance: 1_837,
      monthlyTaxable: 14_863,
      annualNetIncome: 158_350, // 158,356 rounded down to ten pounds
      annualTax: 21_420,
      monthlyTax: 1_785,
      martyrsFund: 8.35,
      healthInsurance: 0,
      deductions: 3_630.35,
      net: 13_069.65,
      employerInsurance: 3_131.25,
      companyCost: 19_831.25,
    });
  });

  it('works out other salaries', () => {
    expect(grossToNet(10_000, 2026)).toMatchObject({ employeeInsurance: 1_100, monthlyTax: 592.5, martyrsFund: 5, net: 8_302.5 });
    // above the insurable cap the insurance stays at 1,837
    expect(grossToNet(25_000, 2026)).toMatchObject({ employeeInsurance: 1_837, annualNetIncome: 257_950, monthlyTax: 3_565.73, net: 19_584.77 });
    // the minimum wage is taxed too: 54,760 a year after insurance and the exemption, 10% above 40,000
    expect(grossToNet(7_000, 2026)).toMatchObject({ employeeInsurance: 770, annualNetIncome: 54_760, monthlyTax: 123, martyrsFund: 3.5, net: 6_103.5 });
  });

  it('loses the lower bands above 600,000 a year (Law 7/2024): gross 80,000 gives net 59,832.37', () => {
    expect(grossToNet(80_000, 2026)).toMatchObject({ annualNetIncome: 917_950, annualTax: 219_487.5, monthlyTax: 18_290.63, martyrsFund: 40, net: 59_832.37 });
  });

  it("works out a month's tax from the pay taxed and the insurance, as the gross to net does", () => {
    expect(monthlySalaryTax({ taxedPay: 16_700, employeeInsurance: 1_837 })).toEqual({
      healthInsurance: 0,
      monthlyTaxable: 14_863,
      annualNetIncome: 158_350,
      annualTax: 21_420,
      monthlyTax: 1_785,
      martyrsFund: 8.35,
    });
    // pay below zero (a month's corrections): no tax, and nothing to the Martyrs' Fund
    expect(monthlySalaryTax({ taxedPay: -500, employeeInsurance: 1_100 })).toMatchObject({ monthlyTaxable: -1_600, annualNetIncome: 0, monthlyTax: 0, martyrsFund: 0 });
  });

  it("reproduces the Tax Authority's own figures", () => {
    expect(annualSalaryTax(706_850)).toBe(158_212.5);
    expect(annualSalaryTax(1_025_170)).toBe(246_292.5);
    // the tier limits make the tax jump
    expect(annualSalaryTax(600_000)).toBe(124_750);
    expect(annualSalaryTax(600_010)).toBe(128_752.5);
    expect(annualSalaryTax(1_200_000)).toBe(290_000);
    expect(annualSalaryTax(1_200_010)).toBe(300_002.75);
    expect(annualSalaryTax(40_000)).toBe(0);
    expect(annualSalaryTax(0)).toBe(0);
  });
});

describe('salary: net to gross', () => {
  it('finds the gross for a net', () => {
    expect(netToGross(13_069.65, 2026).gross).toBe(16_700);
    expect(netToGross(8_302.5, 2026).gross).toBe(10_000);
    expect(netToGross(59_832.37, 2026).gross).toBe(80_000);
  });

  it('gives the lowest whole-pound gross reaching the net, also where a tier limit makes some nets unreachable', () => {
    for (const net of [6_000, 12_345.67, 20_000, 45_000, 100_000]) {
      const b = netToGross(net, 2026);
      expect(Number.isInteger(b.gross)).toBe(true);
      expect(b.net).toBeGreaterThanOrEqual(net);
      expect(grossToNet(b.gross - 1, 2026).net).toBeLessThan(net);
    }
  });

  it('can search to the piaster: several grosses a few piasters apart give the same net', () => {
    const b = netToGross(8_302.5, 2026, 0.01);
    expect(b.gross).toBe(9_999.81);
    expect(b.net).toBe(8_302.5);
  });
});

// Allowances paid on top of the gross (owner's request, 15 October 2026): a taxable one is taxed with the gross (Law
// 91/2005 Art. 9: a cash allowance is taxed), an insured one is insured with it within the insurable wage limits, and
// every one is in the net.
describe('salary: allowances', () => {
  const transport = (amount: number, taxable = true): AllowanceTerms => ({ amount, taxable, insured: false });
  const insured = (amount: number): AllowanceTerms => ({ amount, taxable: true, insured: true });

  it('taxes a taxable allowance with the gross; an untaxed one only adds to the net', () => {
    const plain = grossToNet(10_000, 2026);
    // taxed: 1,000 more taxable income, so 200 more tax a month (the 20% band) and 0.50 more to the Martyrs' Fund
    expect(grossToNet(10_000, 2026, [transport(1_000)])).toMatchObject({
      gross: 10_000,
      allowances: 1_000,
      taxableAllowances: 1_000,
      insuredWage: 10_000,
      employeeInsurance: 1_100,
      monthlyTaxable: 9_900,
      monthlyTax: 792.5,
      martyrsFund: 5.5,
      net: 9_102,
      companyCost: 12_875,
    });
    // untaxed: the same deductions as the gross alone, and the whole allowance in the net
    const untaxed = grossToNet(10_000, 2026, [transport(1_000, false)]);
    expect(untaxed).toMatchObject({ allowances: 1_000, taxableAllowances: 0, monthlyTaxable: plain.monthlyTaxable, deductions: plain.deductions, net: plain.net + 1_000 });
    // not insured: the insurance is on the gross alone, unlike a gross 1,000 higher
    expect(grossToNet(11_000, 2026).employeeInsurance).toBe(1_210);
  });

  it('insures an insured allowance with the gross, within the maximum insurable wage', () => {
    expect(insuredWageOf(12_000, [insured(3_000)], 2026)).toBe(15_000);
    expect(insuredWageOf(15_000, [insured(3_000)], 2026)).toBe(16_700); // capped
    expect(insuredWageOf(12_000, [transport(3_000)], 2026)).toBe(12_000); // not insured
    expect(insuredWageOf(12_000, [], 2026)).toBe(12_000);
    expect(grossToNet(12_000, 2026, [insured(3_000)])).toMatchObject({ insuredWage: 15_000, employeeInsurance: 1_650, employerInsurance: 2_812.5, net: 11_860 });
    expect(grossToNet(15_000, 2026, [insured(3_000)])).toMatchObject({ insuredWage: 16_700, employeeInsurance: 1_837, employerInsurance: 3_131.25 });
  });

  it('puts every allowance in the net and the company cost', () => {
    const b = grossToNet(10_000, 2026, [transport(1_000), transport(500, false), insured(250)]);
    expect(b.allowances).toBe(1_750);
    expect(b.taxableAllowances).toBe(1_250);
    expect(b.net).toBe(Math.round((10_000 + 1_750 - b.deductions) * 100) / 100);
    expect(b.companyCost).toBe(Math.round((10_000 + 1_750 + b.employerInsurance) * 100) / 100);
  });

  it('grosses up a net that includes the allowances', () => {
    const allowances = [transport(1_000), transport(1_000, false)];
    const b = netToGross(10_000, 2026, 1, allowances);
    expect(b).toMatchObject({ gross: 9_857, allowances: 2_000, net: 10_000.3 });
    expect(grossToNet(b.gross - 1, 2026, allowances).net).toBeLessThan(10_000);
    // the allowances lower the gross needed for the same net
    expect(b.gross).toBeLessThan(netToGross(10_000, 2026).gross);
    for (const net of [6_000, 15_000, 60_000]) {
      const g = netToGross(net, 2026, 1, [insured(2_000), transport(750)]);
      expect(g.net).toBeGreaterThanOrEqual(net);
      expect(grossToNet(g.gross - 1, 2026, [insured(2_000), transport(750)]).net).toBeLessThan(net);
    }
  });
});

// Pay by the hour (owner's request, 15 October 2026): the monthly gross is rate × hours a week × 52 ÷ 12.
describe('salary: by the hour', () => {
  it('works out the monthly estimate to the piaster', () => {
    expect(monthlyFromHourly(150, 24)).toBe(15_600);
    expect(monthlyFromHourly(162.5, 22.5)).toBe(15_843.75);
    expect(monthlyFromHourly(100, 10.5)).toBe(4_550);
  });
});

describe('salary: by the hour from a net rate', () => {
  it('finds the lowest gross hourly rate whose month gives the net rate\'s month', () => {
    const { hourlyRate, breakdown } = hourlyRateFromNet(120, 16, 2026);
    const target = Math.round(120 * 16 * (52 / 12) * 100) / 100; // 8,320
    expect(breakdown.net).toBeGreaterThanOrEqual(target);
    expect(breakdown.gross).toBe(monthlyFromHourly(hourlyRate, 16));
    // a piaster less falls short
    expect(grossToNet(monthlyFromHourly(Math.round((hourlyRate - 0.01) * 100) / 100, 16), 2026).net).toBeLessThan(target);
  });

  it('counts the allowances in the net, and gives nothing for no rate or no hours', () => {
    const transport = [{ amount: 500, taxable: true, insured: false }];
    expect(hourlyRateFromNet(120, 16, 2026, transport).hourlyRate).toBeLessThan(hourlyRateFromNet(120, 16, 2026).hourlyRate);
    expect(hourlyRateFromNet(0, 16, 2026).hourlyRate).toBe(0);
    expect(hourlyRateFromNet(120, 0, 2026).hourlyRate).toBe(0);
  });
});
