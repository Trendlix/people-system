import {
  EMPTY_PAYROLL_INPUTS,
  PAYROLL_RULE_DEFAULTS,
  formatHours,
  grossToNet,
  insuredWageOf,
  noShowHours,
  paidDaysIn,
  isFlexibleShift,
  parseHours,
  payrollLine,
  paysOvertime,
  shiftHours,
  shiftWorkHours,
  type PayrollAllowance,
  type PayrollInputs,
  type PayrollTerms,
} from '@trendlix/shared';

// The shared payroll calculation (packages/shared/src/payroll.ts): a month's line worked out the way the owner's payroll
// sheet does it, with its formula errors fixed (owner's decisions, 16 October 2026). Invented figures throughout.

/** A salaried employee with a whole month: gross 12,000 (fixed 9,600 at 80%, variable 2,400), insured on 12,000, 9-hour days. */
const salaried: PayrollTerms = {
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
  // a 9-hour shift: what a no-show day takes out of the expected hours
  hoursPerDay: 9,
};

const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

describe('payroll: a whole month with nothing typed', () => {
  it('pays the contract: its net is what the salary calculator gives for the same gross', () => {
    const line = payrollLine(salaried, inputs());
    const contract = grossToNet(12_000, 2026);
    expect(line).toMatchObject({
      fixed: 9_600,
      variable: 2_400,
      absentHours: 0,
      attendanceRatio: null,
      attendanceScore: 1,
      kpiScore: 1,
      attendanceCut: 0,
      kpiCut: 0,
      noShowCut: 0,
      overtime: 0,
      bonus: 0,
      earned: 12_000,
      insuredWage: 12_000,
      employeeInsurance: 1_320,
      employerInsurance: 2_250,
      monthlyTaxable: 10_680,
      annualNetIncome: 108_160,
      monthlyTax: 948.5,
      martyrsFund: 6,
      deductions: 2_274.5,
      net: 9_725.5,
      released: 0,
      transfer: 9_725.5,
      companyCost: 14_250,
      warnings: [],
    });
    expect(line).toMatchObject({
      employeeInsurance: contract.employeeInsurance,
      monthlyTax: contract.monthlyTax,
      martyrsFund: contract.martyrsFund,
      deductions: contract.deductions,
      net: contract.net,
      companyCost: contract.companyCost,
    });
  });

  it('matches the salary calculator with allowances too, when the insured wage is the contract\'s', () => {
    const allowances: PayrollAllowance[] = [
      { name: 'Transport', amount: 1_500, taxable: true, insured: false },
      { name: 'Housing', amount: 2_000, taxable: true, insured: true },
      { name: 'Meals', amount: 400, taxable: false, insured: false },
    ];
    for (const gross of [7_000, 16_000, 45_000]) {
      const line = payrollLine({ ...salaried, gross, allowances, insuredWage: insuredWageOf(gross, allowances, 2026) }, inputs());
      const contract = grossToNet(gross, 2026, allowances);
      expect(line).toMatchObject({
        earned: gross,
        allowances: contract.allowances,
        taxableAllowances: contract.taxableAllowances,
        insuredWage: contract.insuredWage,
        monthlyTaxable: contract.monthlyTaxable,
        annualNetIncome: contract.annualNetIncome,
        monthlyTax: contract.monthlyTax,
        martyrsFund: contract.martyrsFund,
        net: contract.net,
        employerInsurance: contract.employerInsurance,
        companyCost: contract.companyCost,
      });
    }
  });

  it('takes inputs saved before a field existed as not given', () => {
    expect(payrollLine(salaried, {} as Partial<PayrollInputs> as PayrollInputs).net).toBe(9_725.5);
  });
});

describe('payroll: attendance', () => {
  // Worked by hand: 229:30 worked of 270:00 expected is 85%, below the 90% grace, so the fixed part is paid at 85%:
  // the cut is 9,600 × 15% = 1,440. With no KPIs typed the KPI average is the attendance alone, 85%, at or above the
  // 80% grace: no KPI cut. Earned 10,560. Insurance stays 1,320 (on the insured wage). Taxable 10,560 − 1,320 = 9,240
  // a month; × 12 = 110,880, less the 20,000 exemption = 90,880 a year; tax 1,500 (10% of 40,000–55,000) + 2,250
  // (15% of 55,000–70,000) + 4,176 (20% of 20,880) = 7,926, ÷ 12 = 660.50. Martyrs' Fund 10,560 × 0.05% = 5.28.
  // Deductions 1,320 + 660.50 + 5.28 = 1,985.78; net 10,560 − 1,985.78 = 8,574.22.
  it('cuts the fixed part below the grace percent', () => {
    expect(payrollLine(salaried, inputs({ workedHours: parseHours('229:30'), expectedHours: parseHours('270:00') }))).toMatchObject({
      attendanceRatio: 0.85,
      attendanceScore: 0.85,
      attendanceCut: 1_440,
      kpiScore: 1,
      kpiCut: 0,
      earned: 10_560,
      employeeInsurance: 1_320,
      monthlyTaxable: 9_240,
      annualNetIncome: 90_880,
      monthlyTax: 660.5,
      martyrsFund: 5.28,
      deductions: 1_985.78,
      net: 8_574.22,
      companyCost: 12_810,
    });
  });

  it('pays the whole fixed part at or above the grace percent', () => {
    // 248:24 of 270 is 92%
    expect(payrollLine(salaried, inputs({ workedHours: 248.4, expectedHours: 270 }))).toMatchObject({ attendanceRatio: 0.92, attendanceScore: 1, attendanceCut: 0, earned: 12_000, net: 9_725.5 });
    // exactly 90%: 243 of 270
    expect(payrollLine(salaried, inputs({ workedHours: 243, expectedHours: 270 }))).toMatchObject({ attendanceScore: 1, attendanceCut: 0 });
    // a minute short of it: 242:59 of 270 is 89.99%, paid as it is: 9,600 × (1 − 0.899938…) = 960.59 off (the grace
    // is a threshold, not an allowance)
    expect(payrollLine(salaried, inputs({ workedHours: parseHours('242:59'), expectedHours: 270 }))).toMatchObject({ attendanceCut: 960.59, earned: 11_039.41 });
  });

  it('cuts only the fixed part for attendance when no KPI is given (owner, 16 October 2026: "No, fixed only")', () => {
    // 70% attendance: the fixed part is cut 30% (2,880), the variable part not at all: 9,600 − 2,880 + 2,400 = 9,120
    expect(payrollLine(salaried, inputs({ workedHours: 189, expectedHours: 270 }))).toMatchObject({ attendanceScore: 0.7, attendanceCut: 2_880, kpiScore: 1, kpiCut: 0, earned: 9_120 });
    // nothing worked: none of the fixed part, all of the variable
    expect(payrollLine(salaried, inputs({ workedHours: 0, expectedHours: 270 }))).toMatchObject({ attendanceScore: 0, attendanceCut: 9_600, kpiScore: 1, kpiCut: 0, earned: 2_400 });
  });

  it('cuts the variable part too when, with a KPI given, attendance pulls the KPI average below its grace percent', () => {
    // 70% attendance and a performance of 70%: (70 + 70) ÷ 2 = 70%, so 2,880 off the fixed part and 720 off the variable
    expect(payrollLine(salaried, inputs({ workedHours: 189, expectedHours: 270, performance: 70 }))).toMatchObject({
      attendanceScore: 0.7,
      attendanceCut: 2_880,
      kpiScore: 0.7,
      kpiCut: 720,
      earned: 8_400,
    });
  });

  it('pays overtime above 110% on the fixed part for the days paid at 1.5, when the rules pay it', () => {
    const paying = { ...PAYROLL_RULE_DEFAULTS, payOvertime: true };
    // 324 of 270 is 120%: 9,600 × (1.20 − 1.10) × 1.5 = 1,440
    expect(payrollLine(salaried, inputs({ workedHours: 324, expectedHours: 270 }), paying)).toMatchObject({ attendanceRatio: 1.2, attendanceScore: 1, overtime: 1_440, earned: 13_440, monthlyTaxable: 12_120 });
    // exactly 110%: none
    expect(payrollLine(salaried, inputs({ workedHours: 297, expectedHours: 270 }), paying)).toMatchObject({ attendanceRatio: 1.1, overtime: 0, earned: 12_000 });
    // a joiner paid for 15 of 30 days, whose expected hours are the half month's: 162 of 135 is 120%, on the fixed part
    // for those days: 4,800 × 0.10 × 1.5 = 720
    expect(payrollLine({ ...salaried, paidDays: 15 }, inputs({ workedHours: 162, expectedHours: 135 }), paying)).toMatchObject({ fixed: 4_800, overtime: 720 });
  });

  it('pays no overtime while the rules don\'t, whatever the attendance (owner, 16 October 2026: "No overtime for now")', () => {
    expect(PAYROLL_RULE_DEFAULTS.payOvertime).toBe(false);
    // 120% attendance: still counts in full, with no overtime, by default and with the switch off
    for (const rules of [undefined, { ...PAYROLL_RULE_DEFAULTS, payOvertime: false, overtimeAbovePercent: 100, overtimeRate: 2 }]) {
      expect(payrollLine(salaried, inputs({ workedHours: 324, expectedHours: 270 }), rules)).toMatchObject({ attendanceRatio: 1.2, attendanceScore: 1, overtime: 0, earned: 12_000 });
    }
  });

  it('pays overtime as before on rules copied before the switch existed: a missing switch reads as on', () => {
    const { payOvertime: _, ...older } = PAYROLL_RULE_DEFAULTS;
    expect(paysOvertime(older)).toBe(true);
    expect(paysOvertime({ ...older, payOvertime: false })).toBe(false);
    expect(payrollLine(salaried, inputs({ workedHours: 324, expectedHours: 270 }), older)).toMatchObject({ overtime: 1_440, earned: 13_440 });
  });

  it("doesn't count attendance without both hours, and says why", () => {
    const worked = payrollLine(salaried, inputs({ workedHours: 200 }));
    expect(worked).toMatchObject({ attendanceRatio: null, attendanceScore: 1, attendanceCut: 0, earned: 12_000 });
    expect(worked.warnings).toEqual(["Worked hours are given without the expected hours: attendance isn't counted"]);
    expect(payrollLine(salaried, inputs({ expectedHours: 270 })).warnings).toEqual(["Expected hours are given without the worked hours: attendance isn't counted"]);
    const none = payrollLine(salaried, inputs({ workedHours: 200, expectedHours: 0 }));
    expect(none).toMatchObject({ attendanceRatio: null, attendanceCut: 0 });
    expect(none.warnings).toEqual(["The expected hours are 0: attendance isn't counted"]);
  });

  it('follows the run\'s rules', () => {
    const rules = { ...PAYROLL_RULE_DEFAULTS, attendanceGracePercent: 95, payOvertime: true, overtimeAbovePercent: 100, overtimeRate: 2 };
    // 92% is now below the grace: 9,600 × 8% = 768
    expect(payrollLine(salaried, inputs({ workedHours: 248.4, expectedHours: 270 }), rules)).toMatchObject({ attendanceScore: 0.92, attendanceCut: 768 });
    // overtime from 100% at double: 9,600 × 0.05 × 2 = 960
    expect(payrollLine(salaried, inputs({ workedHours: 283.5, expectedHours: 270 }), rules)).toMatchObject({ overtime: 960 });
  });
});

describe('payroll: KPIs', () => {
  it('cuts the variable part for a KPI average below 80%', () => {
    // attendance not tracked counts as 100%: (100 + 60 + 50 + 70) ÷ 4 = 70%, so 2,400 × 30% = 720
    expect(payrollLine(salaried, inputs({ softSkills: 60, performance: 50, clientSatisfaction: 70 }))).toMatchObject({ kpiScore: 0.7, kpiCut: 720, attendanceCut: 0, earned: 11_280 });
    // only the KPIs given count: (100 + 50) ÷ 2 = 75%, so 2,400 × 25% = 600
    expect(payrollLine(salaried, inputs({ performance: 50 }))).toMatchObject({ kpiScore: 0.75, kpiCut: 600 });
    // with attendance at 85%: (85 + 60) ÷ 2 = 72.5%, so 2,400 × 27.5% = 660, and 1,440 off the fixed part
    expect(payrollLine(salaried, inputs({ workedHours: 229.5, expectedHours: 270, performance: 60 }))).toMatchObject({ kpiScore: 0.725, kpiCut: 660, attendanceCut: 1_440, earned: 9_900 });
  });

  it('pays the whole variable part at or above 80%, never more', () => {
    expect(payrollLine(salaried, inputs({ softSkills: 70, performance: 80, clientSatisfaction: 90 }))).toMatchObject({ kpiScore: 1, kpiCut: 0, earned: 12_000 });
    // exactly 80%: (100 + 70 + 70 + 80) ÷ 4
    expect(payrollLine(salaried, inputs({ softSkills: 70, performance: 70, clientSatisfaction: 80 }))).toMatchObject({ kpiScore: 1, kpiCut: 0 });
    expect(payrollLine(salaried, inputs({ softSkills: 150, performance: 200, clientSatisfaction: 120 }))).toMatchObject({ kpiScore: 1, kpiCut: 0, earned: 12_000 });
    // a grace above 100% doesn't turn a high average into extra pay
    expect(payrollLine(salaried, inputs({ performance: 150 }), { ...PAYROLL_RULE_DEFAULTS, kpiGracePercent: 150 })).toMatchObject({ kpiScore: 1.25, kpiCut: 0 });
  });
});

describe('payroll: days, bonus, commission and settlements', () => {
  it('cuts two days of the gross for a no-show day, and a day of the contract\'s net for a penalty day after the tax', () => {
    // no-show: 1 × 2 × 12,000 ÷ 30 = 800, taken from the pay before the tax; penalty: 9,725.50 ÷ 30 = 324.18, after it
    const line = payrollLine(salaried, inputs({ noShowDays: 1, penaltyDays: 1 }));
    expect(line).toMatchObject({ noShowCut: 800, earned: 11_200, monthlyTaxable: 9_880, monthlyTax: 788.5, martyrsFund: 5.6, penaltyCut: 324.18, deductions: 2_438.28, net: 8_761.72 });
    // half days are allowed
    expect(payrollLine(salaried, inputs({ noShowDays: 0.5, penaltyDays: 2.5 }))).toMatchObject({ noShowCut: 400, penaltyCut: 810.46 });
  });

  it('adds bonus days of the fixed part, the commission and the settlements to the taxed pay', () => {
    // 2 × 9,600 ÷ 30 = 640; earned 12,000 + 640 + 1,500 − 250 = 13,890, all of it taxed
    const line = payrollLine(salaried, inputs({ bonusDays: 2, commission: 1_500, settlements: -250 }));
    expect(line).toMatchObject({ bonus: 640, commission: 1_500, settlements: -250, earned: 13_890, monthlyTaxable: 12_570, martyrsFund: 6.95 });
    expect(line.net).toBe(Math.round((13_890 - line.deductions) * 100) / 100);
    expect(payrollLine(salaried, inputs({ bonusDays: 0.5, settlements: 300.25 }))).toMatchObject({ bonus: 160, settlements: 300.25, earned: 12_460.25 });
  });

  it('ignores a medical subscription in inputs saved before it was taken off the payroll (16 October 2026)', () => {
    const saved = { ...inputs(), medical: 350 };
    const line = payrollLine(salaried, saved);
    expect(line).toEqual(payrollLine(salaried, inputs()));
    expect(line).not.toHaveProperty('medical');
    expect(line).toMatchObject({ deductions: 2_274.5, net: 9_725.5 });
  });
});

describe('payroll: no-show days, charged once (owner\'s decisions, 16 October 2026)', () => {
  // a no-show day costs 2 days of the gross, 2 × 12,000 ÷ 30 = 800; its 9 hours come out of the expected hours
  const NO_SHIFT = "No shift on the employment, so the no-show days' hours couldn't be taken out of the expected hours: type the expected hours without them";
  const CAPPED = 'The no-show days cost more than the salary left for the days paid: the cut is capped there';

  it('takes their hours out of the expected hours, so attendance doesn\'t charge them again', () => {
    // 6 days off of 30: 270 − 6 × 9 = 216 expected, all 216 worked: 100%, no attendance cut (on 270 it would be 80%,
    // 1,920 more). Cut 6 × 800 = 4,800; earned 12,000 − 4,800 = 7,200. Insurance 1,320; taxable 5,880; × 12 = 70,560,
    // less 20,000 = 50,560; tax 10% of 10,560 = 1,056 a year, 88 a month; Martyrs' Fund 3.60. Deductions 1,411.60, net
    // 7,200 − 1,411.60 = 5,788.40.
    const line = payrollLine(salaried, inputs({ workedHours: 216, expectedHours: 270, noShowDays: 6 }));
    expect(line).toMatchObject({
      absentHours: 54,
      attendanceRatio: 1,
      attendanceScore: 1,
      attendanceCut: 0,
      kpiCut: 0,
      noShowCut: 4_800,
      overtime: 0,
      earned: 7_200,
      monthlyTaxable: 5_880,
      annualNetIncome: 50_560,
      monthlyTax: 88,
      martyrsFund: 3.6,
      deductions: 1_411.6,
      net: 5_788.4,
      companyCost: 9_450,
      warnings: [],
    });
  });

  it('still cuts short hours on the days the employee came in', () => {
    // 183:36 of the 216 left is 85%: 9,600 × 15% = 1,440 off the fixed part, and the 4,800: earned 5,760
    const line = payrollLine(salaried, inputs({ workedHours: 183.6, expectedHours: 270, noShowDays: 6 }));
    expect(line).toMatchObject({ absentHours: 54, attendanceRatio: 0.85, attendanceCut: 1_440, noShowCut: 4_800, earned: 5_760 });
    // half a day off is half a shift: 265:30 left, all worked; 400 off
    expect(payrollLine(salaried, inputs({ workedHours: 265.5, expectedHours: 270, noShowDays: 0.5 }))).toMatchObject({ absentHours: 4.5, attendanceRatio: 1, noShowCut: 400 });
  });

  it('without a shift, takes the expected hours as typed and says so', () => {
    // 216 of 270 is 80%: the 1,920 is charged on top of the 4,800, unless HR types the expected hours without the days off
    const noShift = { ...salaried, hoursPerDay: null };
    const typed = payrollLine(noShift, inputs({ workedHours: 216, expectedHours: 270, noShowDays: 6 }));
    expect(typed).toMatchObject({ absentHours: 0, attendanceRatio: 0.8, attendanceCut: 1_920, noShowCut: 4_800, earned: 5_280 });
    expect(typed.warnings).toEqual([NO_SHIFT]);
    expect(payrollLine(noShift, inputs({ workedHours: 216, expectedHours: 216, noShowDays: 6 }))).toMatchObject({ attendanceRatio: 1, attendanceCut: 0, earned: 7_200 });
    // terms worked out before the hours a day existed read as without a shift
    const older = { ...salaried, hoursPerDay: undefined } as unknown as PayrollTerms;
    expect(payrollLine(older, inputs({ workedHours: 216, expectedHours: 270, noShowDays: 6 }))).toEqual(typed);
    // no warning when no hours are typed: attendance isn't counted anyway
    expect(payrollLine(noShift, inputs({ noShowDays: 6 })).warnings).toEqual([]);
  });

  it('doesn\'t count attendance when the days off are all the expected hours, and the no-show cut alone applies', () => {
    // 10 days off of a 90-hour month: nothing left to measure; 10 × 800 = 8,000 off, earned 4,000
    const line = payrollLine(salaried, inputs({ workedHours: 0, expectedHours: 90, noShowDays: 10 }));
    expect(line).toMatchObject({ absentHours: 90, attendanceRatio: null, attendanceScore: 1, attendanceCut: 0, kpiScore: 1, noShowCut: 8_000, earned: 4_000 });
    expect(line.warnings).toEqual(["The no-show days' hours are all the expected hours or more: attendance isn't counted, only the no-show cut"]);
  });

  it('never cuts more than the salary left for the days paid, and says so', () => {
    // 20 days off cost 16,000, more than the 12,000: capped at it. Not registered with social insurance: nothing to deduct
    const month = payrollLine({ ...salaried, insured: false }, inputs({ noShowDays: 20 }));
    expect(month).toMatchObject({ noShowCut: 12_000, earned: 0, deductions: 0, net: 0 });
    expect(month.warnings).toEqual([CAPPED]);
    // 90 worked of the 180 left after 10 days off is 50%: 4,800 off the fixed part leaves 7,200 of the salary, less than
    // the 8,000 the days cost
    const short = payrollLine(salaried, inputs({ workedHours: 90, expectedHours: 270, noShowDays: 10 }));
    expect(short).toMatchObject({ attendanceRatio: 0.5, attendanceCut: 4_800, noShowCut: 7_200, earned: 0 });
    expect(short.warnings).toContain(CAPPED);
    // a part month: 15 days paid are 6,000 (4,800 fixed, 1,200 variable), less than the 8,000 of 10 days off
    const part = payrollLine({ ...salaried, paidDays: 15 }, inputs({ noShowDays: 10 }));
    expect(part).toMatchObject({ fixed: 4_800, variable: 1_200, noShowCut: 6_000, earned: 0 });
    expect(part.warnings).toEqual(['Paid for 15 of 30 days: joined or left in the month', CAPPED, 'The net is below 0: the cuts and deductions are more than the pay']);
    // up to the salary exactly: no warning
    expect(payrollLine(salaried, inputs({ noShowDays: 15 }))).toMatchObject({ noShowCut: 12_000, earned: 0, warnings: ['The net is below 0: the cuts and deductions are more than the pay'] });
  });
});

describe('payroll: a working day\'s hours', () => {
  it('from a shift\'s start to its end, past midnight too', () => {
    expect(shiftHours('09:00', '18:00')).toBe(9);
    expect(shiftHours('09:00', '17:30')).toBe(8.5);
    expect(shiftHours('22:00', '06:00')).toBe(8);
    expect(shiftHours('00:00', '23:59')).toBe(23 + 59 / 60);
    for (const [start, end] of [['09:00', '09:00'], ['9:00', '18:00'], ['09:00', '24:00'], ['', '18:00']]) expect(shiftHours(start, end)).toBeNull();
  });

  it('a shift\'s hours to work a day: as set when fewer than its window (flexible), else the whole window (owner, 16 October 2026)', () => {
    // the MORNING shift: 9:00 AM to 7:00 PM, 9 hours to work within it
    const morning = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9 };
    expect([shiftWorkHours(morning), isFlexibleShift(morning)]).toEqual([9, true]);
    // a fixed shift: hours to work that fill the window, or none set, are the window
    for (const hoursPerDay of [10, null, undefined]) {
      expect([shiftWorkHours({ ...morning, hoursPerDay }), isFlexibleShift({ ...morning, hoursPerDay })]).toEqual([10, false]);
    }
    // past midnight: 10:00 PM to 6:00 AM is 8 hours; 7:30 to work within them
    expect([shiftWorkHours({ startTime: '22:00', endTime: '06:00', hoursPerDay: 7.5 }), shiftWorkHours({ startTime: '22:00', endTime: '06:00' })]).toEqual([7.5, 8]);
    // never more than the window; 0 or less isn't set
    expect(shiftWorkHours({ ...morning, hoursPerDay: 11 })).toBe(10);
    expect(shiftWorkHours({ ...morning, hoursPerDay: 0 })).toBe(10);
    // times that can't be read: the hours set, else none
    expect([shiftWorkHours({ startTime: '09:00', endTime: '09:00', hoursPerDay: 8 }), shiftWorkHours({ startTime: '09:00', endTime: '09:00' })]).toEqual([8, null]);
    expect(isFlexibleShift({ startTime: '09:00', endTime: '09:00', hoursPerDay: 8 })).toBe(false);
  });

  it('a shift\'s day for each no-show day, half days too; none without either', () => {
    expect(noShowHours(2, 9)).toBe(18);
    expect(noShowHours(1.5, 8.5)).toBe(12.75);
    expect([noShowHours(null, 9), noShowHours(0, 9), noShowHours(2, null), noShowHours(2, undefined), noShowHours(2, 0)]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('payroll: someone who joined in the month', () => {
  // Worked by hand: joined on 12 September, so paid for 19 of 30 days. Fixed 9,600 × 19/30 = 6,080, variable
  // 2,400 × 19/30 = 1,520: earned 7,600. Allowances for 19 days: transport (taxed) 1,500 → 950, housing (taxed and
  // insured) 600 → 380, meals (neither) 300 → 190: 1,520 in all, 1,330 taxed. Insurance on the whole insured wage,
  // 12,000 + 600 = 12,600, not prorated: 1,386 (11%) and 2,362.50 (18.75%). Taxed pay 7,600 + 1,330 = 8,930;
  // taxable 8,930 − 1,386 = 7,544 a month; × 12 = 90,528, less 20,000 = 70,528, rounded down to 70,520 a year; tax
  // 1,500 + 2,250 + 20% of 520 = 3,854, ÷ 12 = 321.17. Martyrs' Fund 8,930 × 0.05% = 4.465 → 4.47. Deductions
  // 1,386 + 321.17 + 4.47 = 1,711.64; net 7,600 + 1,520 − 1,711.64 = 7,408.36.
  const allowances: PayrollAllowance[] = [
    { name: 'Transport', amount: 1_500, taxable: true, insured: false },
    { name: 'Housing', amount: 600, taxable: true, insured: true },
    { name: 'Meals', amount: 300, taxable: false, insured: false },
  ];

  it('pays the salary and the allowances for the days employed, and the insurance whole', () => {
    const paidDays = paidDaysIn('2026-09', '2026-09-12', null, 30);
    expect(paidDays).toBe(19);
    const line = payrollLine({ ...salaried, allowances, paidDays, insuredWage: insuredWageOf(12_000, allowances, 2026) }, inputs());
    expect(line).toMatchObject({
      fixed: 6_080,
      variable: 1_520,
      earned: 7_600,
      allowances: 1_520,
      taxableAllowances: 1_330,
      insuredWage: 12_600,
      employeeInsurance: 1_386,
      employerInsurance: 2_362.5,
      monthlyTaxable: 7_544,
      annualNetIncome: 70_520,
      monthlyTax: 321.17,
      martyrsFund: 4.47,
      deductions: 1_711.64,
      net: 7_408.36,
      companyCost: 11_482.5,
    });
    expect(line.warnings).toEqual(['Paid for 19 of 30 days: joined or left in the month']);
  });

  it('pays nothing for no days, but the insurance is still due', () => {
    const line = payrollLine({ ...salaried, allowances, paidDays: 0 }, inputs());
    expect(line).toMatchObject({ fixed: 0, variable: 0, earned: 0, allowances: 0, employeeInsurance: 1_320, monthlyTax: 0, martyrsFund: 0, net: -1_320 });
    expect(line.warnings).toEqual(['Paid for 0 of 30 days: joined or left in the month', 'The net is below 0: the cuts and deductions are more than the pay']);
  });
});

describe('payroll: insurance and tax', () => {
  it('deducts no insurance for someone not registered with social insurance, and taxes the whole pay', () => {
    // taxable 12,000; × 12 − 20,000 = 124,000; tax 3,750 + 20% of 54,000 = 14,550 a year, 1,212.50 a month
    expect(payrollLine({ ...salaried, insured: false }, inputs())).toMatchObject({
      insuredWage: 0,
      employeeInsurance: 0,
      employerInsurance: 0,
      monthlyTaxable: 12_000,
      annualNetIncome: 124_000,
      monthlyTax: 1_212.5,
      martyrsFund: 6,
      net: 10_781.5,
      companyCost: 12_000,
    });
  });

  it('says so when someone registered has no insured wage', () => {
    const line = payrollLine({ ...salaried, insuredWage: 0 }, inputs());
    expect(line).toMatchObject({ employeeInsurance: 0, employerInsurance: 0 });
    expect(line.warnings).toEqual(['Registered with social insurance, but there is no insured wage: no insurance is deducted']);
  });

  it('deducts nothing statutory for a freelancer: no insurance, no tax, no Martyrs\' Fund', () => {
    // a freelancer's penalty day is a day of the gross, which is their net (12,000 ÷ 30)
    const line = payrollLine({ ...salaried, statutory: false }, inputs({ penaltyDays: 1 }));
    expect(line).toMatchObject({
      earned: 12_000,
      insuredWage: 0,
      employeeInsurance: 0,
      employerInsurance: 0,
      monthlyTaxable: 0,
      annualNetIncome: 0,
      monthlyTax: 0,
      martyrsFund: 0,
      penaltyCut: 400,
      deductions: 400,
      net: 11_600,
      companyCost: 12_000,
      warnings: [],
    });
  });
});

describe('payroll: by the hour', () => {
  // rate 150 for 24 hours a week: a monthly estimate of 15,600 (its fixed part 12,480 gives a bonus day of 416)
  const hourly: PayrollTerms = { ...salaried, payBasis: 'hourly', gross: 15_600, hourlyRate: 150, insuredWage: 15_600 };

  it('pays the hours worked at the rate, with the bonus, the commission and the settlements', () => {
    // 96:30 × 150 = 14,475; + 416 + 500 = 15,391
    const line = payrollLine(hourly, inputs({ workedHours: parseHours('96:30'), bonusDays: 1, commission: 500 }));
    expect(line).toMatchObject({ fixed: 14_475, variable: 0, attendanceRatio: null, attendanceCut: 0, kpiCut: 0, overtime: 0, bonus: 416, earned: 15_391, employeeInsurance: 1_716 });
    expect(line.warnings).toEqual([]);
  });

  it('ignores attendance, KPIs and no-show days, and says so', () => {
    // the 9-hour shift doesn't matter either: no hours come out of anything
    const line = payrollLine(hourly, inputs({ workedHours: 80, expectedHours: 104, performance: 40, noShowDays: 2 }));
    expect(line).toMatchObject({ fixed: 12_000, absentHours: 0, attendanceRatio: null, attendanceCut: 0, kpiScore: 1, kpiCut: 0, noShowCut: 0, earned: 12_000 });
    expect(line.warnings).toEqual(["Paid by the hour: the expected hours, KPIs and no-show days don't change the pay"]);
  });

  it('pays nothing for hours without them or without a rate, and says so', () => {
    const none = payrollLine(hourly, inputs({ settlements: 3_000 }));
    expect(none).toMatchObject({ fixed: 0, earned: 3_000 });
    expect(none.warnings).toEqual(['Paid by the hour, but no worked hours are given: nothing is paid for hours']);
    const noRate = payrollLine({ ...hourly, hourlyRate: null }, inputs({ workedHours: 80 }));
    expect(noRate).toMatchObject({ fixed: 0, earned: 0 });
    expect(noRate.warnings).toEqual(['Paid by the hour, but the contract has no hourly rate', 'The net is below 0: the cuts and deductions are more than the pay']);
  });

  it('prorates the allowances for a part month, not the hours', () => {
    const allowances: PayrollAllowance[] = [{ name: 'Transport', amount: 900, taxable: false, insured: false }];
    expect(payrollLine({ ...hourly, allowances, paidDays: 10 }, inputs({ workedHours: 40 }))).toMatchObject({ fixed: 6_000, earned: 6_000, allowances: 300 });
  });
});

describe('payroll: what the bank pays', () => {
  it('transfers the net less what was already released', () => {
    expect(payrollLine(salaried, inputs({ released: 2_000 }))).toMatchObject({ net: 9_725.5, released: 2_000, transfer: 7_725.5, warnings: [] });
    const over = payrollLine(salaried, inputs({ released: 10_000 }));
    expect(over).toMatchObject({ transfer: -274.5 });
    expect(over.warnings).toEqual(['More was released than the net: the transfer is below 0']);
  });

  it('warns of a net below zero; nothing is paid to the Martyrs\' Fund on pay below zero', () => {
    // a correction bigger than the month: earned 12,000 − 15,000 = −3,000, no tax, the insurance still due
    const line = payrollLine(salaried, inputs({ settlements: -15_000 }));
    expect(line).toMatchObject({ earned: -3_000, monthlyTaxable: -4_320, annualNetIncome: 0, monthlyTax: 0, martyrsFund: 0, deductions: 1_320, net: -4_320, transfer: -4_320 });
    expect(line.warnings).toEqual(['The net is below 0: the cuts and deductions are more than the pay']);
  });
});

describe('payroll: days paid in a month', () => {
  it('counts the calendar days employed', () => {
    expect(paidDaysIn('2026-09', '2026-09-12', null, 30)).toBe(19);
    expect(paidDaysIn('2026-09', '2024-03-01', '2026-09-10', 30)).toBe(10); // left on the 10th
    expect(paidDaysIn('2026-09', '2026-09-05', '2026-09-20', 30)).toBe(16);
    expect(paidDaysIn('2026-09', '2026-09-30', null, 30)).toBe(1);
    expect(paidDaysIn('2026-09', '2025-01-01', '2026-09-01', 30)).toBe(1);
    expect(paidDaysIn('2026-02', '2026-02-15', null, 30)).toBe(14);
    expect(paidDaysIn('2026-09', '2026-09-12', null, 26)).toBe(19);
  });

  it('pays a whole month as the divisor, whatever its length', () => {
    expect(paidDaysIn('2026-09', '2025-01-01', null, 30)).toBe(30);
    expect(paidDaysIn('2026-02', '2025-01-01', null, 30)).toBe(30);
    expect(paidDaysIn('2026-02', '2026-02-01', '2026-02-28', 30)).toBe(30);
    expect(paidDaysIn('2028-02', '2028-02-01', null, 30)).toBe(30); // a leap year
    expect(paidDaysIn('2026-10', '2025-01-01', '2026-10-31', 30)).toBe(30);
    expect(paidDaysIn('2026-10', '2025-01-01', null, 26)).toBe(26);
  });

  it('caps a part of a 31-day month at the divisor', () => {
    expect(paidDaysIn('2026-10', '2026-10-02', null, 30)).toBe(30);
    expect(paidDaysIn('2026-10', '2026-10-01', '2026-10-30', 30)).toBe(30);
    expect(paidDaysIn('2026-10', '2026-10-03', null, 30)).toBe(29);
    expect(paidDaysIn('2026-10', '2026-10-02', null, 26)).toBe(26);
  });

  it('gives 0 for an employment outside the month', () => {
    expect(paidDaysIn('2026-09', '2026-10-01', null, 30)).toBe(0);
    expect(paidDaysIn('2026-09', '2025-01-01', '2026-08-31', 30)).toBe(0);
  });

  it('refuses what is not a month or a date', () => {
    expect(() => paidDaysIn('2026-13', '2026-01-01', null, 30)).toThrow(RangeError);
    expect(() => paidDaysIn('2026-9', '2026-01-01', null, 30)).toThrow(RangeError);
    expect(() => paidDaysIn('2026-09', '2026/09/01', null, 30)).toThrow(RangeError);
    expect(() => paidDaysIn('2026-09', '2026-09-01', '2026-09-01T00:00:00.000Z', 30)).toThrow(RangeError);
  });
});

describe('payroll: hours as typed', () => {
  it('reads hours and minutes, or decimal hours', () => {
    expect(parseHours('270:00')).toBe(270);
    expect(parseHours('270:30')).toBe(270.5);
    expect(parseHours('  270:30 ')).toBe(270.5);
    expect(parseHours('0:45')).toBe(0.75);
    expect(parseHours('270.5')).toBe(270.5);
    expect(parseHours('270')).toBe(270);
    expect(parseHours(' 7.25\t')).toBe(7.25);
    expect(parseHours('.5')).toBe(0.5);
    expect(parseHours('270:20')).toBeCloseTo(270 + 1 / 3, 10);
  });

  it('gives null for nothing or what is not hours', () => {
    for (const text of [null, undefined, '', '   ', '270:60', '270:5', '270:300', ':30', 'abc', '-5', '-1:30', '1,234', '270,5', '270:30:00', '12h', '1e3']) {
      expect(parseHours(text)).toBeNull();
    }
  });

  it('shows hours to the minute', () => {
    expect(formatHours(270.5)).toBe('270:30');
    expect(formatHours(270)).toBe('270:00');
    expect(formatHours(0)).toBe('0:00');
    expect(formatHours(7.25)).toBe('7:15');
    expect(formatHours(parseHours('270:20')!)).toBe('270:20');
    expect(formatHours(1.999)).toBe('2:00'); // 119.94 minutes
    expect(formatHours(0.004)).toBe('0:00'); // a quarter of a minute
    expect(formatHours(-1.5)).toBe('-1:30');
    expect(formatHours(Number.NaN)).toBe('');
  });
});
