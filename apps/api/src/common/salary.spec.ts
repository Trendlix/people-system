import { annualSalaryTax, grossToNet, netToGross } from '@trendlix/shared';

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
