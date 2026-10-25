import {
  EMPTY_PAYROLL_INPUTS,
  NO_SHIFT_NO_EXPECTED_HOURS,
  PAYROLL_RULE_DEFAULTS,
  formatHours,
  grossToNet,
  insuredWageOf,
  noShowHours,
  paidDaysIn,
  paidDaysOf,
  isFlexibleShift,
  parseHours,
  payrollLine,
  paysOvertime,
  shiftDaysHours,
  shiftHours,
  shiftWorkHours,
  splitSegments,
  type PayrollAdjustmentItem,
  type PayrollAllowance,
  type PayrollInputs,
  type PayrollSegment,
  type PayrollTerms,
  type SavedPayrollInputs,
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
  // a 9-hour shift: what a no-show or leave day takes out of the shift's hours (none given here: see onShift)
  hoursPerDay: 9,
};

/**
 * The same employee with the shift's hours for the month worked out (owner's request, 16 October 2026): 22 working
 * days, no holidays, of 9 hours: 198.
 */
const onShift: PayrollTerms = { ...salaried, expectedHours: 198, expectedDays: { workingDays: 22, holidays: 0 } };

/**
 * The same terms with the shift's hours for the month at `hours`: the expected hours, worked out from the shift and never
 * typed since 20 October 2026 (owner: "expected hours to be locked based on shifts and attendance data").
 */
const shiftOf = (hours: number, terms: PayrollTerms = salaried): PayrollTerms => ({ ...terms, expectedHours: hours });

const PART_MONTH = (n: number) => `Paid for ${n} of 30 days: employed or under contract for part of the month`;

const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

/**
 * The month's additions and deductions (owner, 17 October 2026: the grid's bonus and penalty days, commission and
 * settlements moved to Additions / Deductions): a Bonus (days) or a Penalty (days) of so many days, a commission, a
 * correction (an addition, or a deduction for a negative one).
 */
let itemNo = 0;
const item = (over: Partial<PayrollAdjustmentItem>): PayrollAdjustmentItem => ({ id: `item-${++itemNo}`, kind: 'addition', type: 'bonus', taxed: true, amount: null, reason: 'Invented', ...over });
const bonusDays = (days: number) => item({ type: 'bonus_days', days });
const penaltyDays = (days: number) => item({ kind: 'deduction', type: 'penalty_days', taxed: false, days });
const commission = (amount: number) => item({ type: 'commission', amount });
const correction = (amount: number) => (amount > 0 ? item({ type: 'correction', amount }) : item({ kind: 'deduction', type: 'correction', taxed: false, amount: -amount }));
const withItems = (terms: PayrollTerms, ...items: PayrollAdjustmentItem[]): PayrollTerms => ({ ...terms, adjustments: items });

describe('payroll: a whole month with nothing typed', () => {
  it('pays the contract: its net is what the salary calculator gives for the same gross', () => {
    const line = payrollLine(salaried, inputs());
    const contract = grossToNet(12_000, 2026);
    expect(line).toMatchObject({
      fixed: 9_600,
      variable: 2_400,
      // terms with no segments (a line made before 17 October 2026, or these): one part, of the terms
      parts: [{ contractId: null, fixed: 9_600, variable: 2_400, allowances: 0 }],
      absentHours: 0,
      leaveHours: 0,
      expectedHours: null,
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
    expect(payrollLine(shiftOf(parseHours('270:00')!), inputs({ workedHours: parseHours('229:30') }))).toMatchObject({
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
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 248.4 }))).toMatchObject({ attendanceRatio: 0.92, attendanceScore: 1, attendanceCut: 0, earned: 12_000, net: 9_725.5 });
    // exactly 90%: 243 of 270
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 243 }))).toMatchObject({ attendanceScore: 1, attendanceCut: 0 });
    // a minute short of it: 242:59 of 270 is 89.99%, paid as it is: 9,600 × (1 − 0.899938…) = 960.59 off (the grace
    // is a threshold, not an allowance)
    expect(payrollLine(shiftOf(270), inputs({ workedHours: parseHours('242:59') }))).toMatchObject({ attendanceCut: 960.59, earned: 11_039.41 });
  });

  it('cuts only the fixed part for attendance when no KPI is given (owner, 16 October 2026: "No, fixed only")', () => {
    // 70% attendance: the fixed part is cut 30% (2,880), the variable part not at all: 9,600 − 2,880 + 2,400 = 9,120
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 189 }))).toMatchObject({ attendanceScore: 0.7, attendanceCut: 2_880, kpiScore: 1, kpiCut: 0, earned: 9_120 });
    // nothing worked: none of the fixed part, all of the variable
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 0 }))).toMatchObject({ attendanceScore: 0, attendanceCut: 9_600, kpiScore: 1, kpiCut: 0, earned: 2_400 });
  });

  it('cuts the variable part too when, with a KPI given, attendance pulls the KPI average below its grace percent', () => {
    // 70% attendance and a performance of 70%: (70 + 70) ÷ 2 = 70%, so 2,880 off the fixed part and 720 off the variable
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 189, performance: 70 }))).toMatchObject({
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
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 324 }), paying)).toMatchObject({ attendanceRatio: 1.2, attendanceScore: 1, overtime: 1_440, earned: 13_440, monthlyTaxable: 12_120 });
    // exactly 110%: none
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 297 }), paying)).toMatchObject({ attendanceRatio: 1.1, overtime: 0, earned: 12_000 });
    // a joiner paid for 15 of 30 days, whose expected hours are the half month's: 162 of 135 is 120%, on the fixed part
    // for those days: 4,800 × 0.10 × 1.5 = 720
    expect(payrollLine(shiftOf(135, { ...salaried, paidDays: 15 }), inputs({ workedHours: 162 }), paying)).toMatchObject({ fixed: 4_800, overtime: 720 });
  });

  it('pays no overtime while the rules don\'t, whatever the attendance (owner, 16 October 2026: "No overtime for now")', () => {
    expect(PAYROLL_RULE_DEFAULTS.payOvertime).toBe(false);
    // 120% attendance: still counts in full, with no overtime, by default and with the switch off
    for (const rules of [undefined, { ...PAYROLL_RULE_DEFAULTS, payOvertime: false, overtimeAbovePercent: 100, overtimeRate: 2 }]) {
      expect(payrollLine(shiftOf(270), inputs({ workedHours: 324 }), rules)).toMatchObject({ attendanceRatio: 1.2, attendanceScore: 1, overtime: 0, earned: 12_000 });
    }
  });

  it('pays overtime as before on rules copied before the switch existed: a missing switch reads as on', () => {
    const { payOvertime: _, ...older } = PAYROLL_RULE_DEFAULTS;
    expect(paysOvertime(older)).toBe(true);
    expect(paysOvertime({ ...older, payOvertime: false })).toBe(false);
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 324 }), older)).toMatchObject({ overtime: 1_440, earned: 13_440 });
  });

  it("doesn't count attendance without both hours, and says why", () => {
    const worked = payrollLine(salaried, inputs({ workedHours: 200 }));
    expect(worked).toMatchObject({ attendanceRatio: null, attendanceScore: 1, attendanceCut: 0, earned: 12_000 });
    expect(worked.warnings).toEqual(["Worked hours are given without the expected hours: attendance isn't counted"]);
    // without a shift there are no expected hours, never typed (owner, 20 October 2026: "expected hours to be locked
    // based on shifts and attendance data"): the warning says how to get them
    const noShift = payrollLine({ ...salaried, hoursPerDay: null }, inputs({ workedHours: 200 }));
    expect(noShift).toMatchObject({ expectedHours: null, attendanceRatio: null, attendanceScore: 1, attendanceCut: 0, earned: 12_000 });
    expect(noShift.warnings).toEqual([NO_SHIFT_NO_EXPECTED_HOURS]);
    expect(NO_SHIFT_NO_EXPECTED_HOURS).toBe(
      "No shift on the employment, so there are no expected hours and attendance isn't counted: set the shift on the Employment tab, then refresh the run",
    );
    // the shift's hours alone: attendance just isn't tracked yet, nothing to warn about
    expect(payrollLine(shiftOf(270), inputs()).warnings).toEqual([]);
    // a line saved with expected hours HR typed before then, without worked hours, says so as it did
    expect(payrollLine(salaried, inputs({ expectedHours: 270 })).warnings).toEqual(["Expected hours are given without the worked hours: attendance isn't counted"]);
    const none = payrollLine(shiftOf(0), inputs({ workedHours: 200 }));
    expect(none).toMatchObject({ attendanceRatio: null, attendanceCut: 0 });
    expect(none.warnings).toEqual(["The expected hours are 0: attendance isn't counted"]);
  });

  it('follows the run\'s rules', () => {
    const rules = { ...PAYROLL_RULE_DEFAULTS, attendanceGracePercent: 95, payOvertime: true, overtimeAbovePercent: 100, overtimeRate: 2 };
    // 92% is now below the grace: 9,600 × 8% = 768
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 248.4 }), rules)).toMatchObject({ attendanceScore: 0.92, attendanceCut: 768 });
    // overtime from 100% at double: 9,600 × 0.05 × 2 = 960
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 283.5 }), rules)).toMatchObject({ overtime: 960 });
  });
});

describe('payroll: KPIs', () => {
  // the KPI inputs typed on a line, averaged with the attendance as the sheet did: the rules of a run made before 25
  // October 2026 ("Fixed cut only"), which don't have kpiIncludesAttendance (kpi-without-attendance.spec.ts: since)
  const { kpiIncludesAttendance: _, ...sheet } = PAYROLL_RULE_DEFAULTS;

  it('cuts the variable part for a KPI average below 80%', () => {
    // attendance not tracked counts as 100%: (100 + 60 + 50 + 70) ÷ 4 = 70%, so 2,400 × 30% = 720
    expect(payrollLine(salaried, inputs({ softSkills: 60, performance: 50, clientSatisfaction: 70 }), sheet)).toMatchObject({ kpiScore: 0.7, kpiCut: 720, attendanceCut: 0, earned: 11_280 });
    // only the KPIs given count: (100 + 50) ÷ 2 = 75%, so 2,400 × 25% = 600
    expect(payrollLine(salaried, inputs({ performance: 50 }), sheet)).toMatchObject({ kpiScore: 0.75, kpiCut: 600 });
    // with attendance at 85%: (85 + 60) ÷ 2 = 72.5%, so 2,400 × 27.5% = 660, and 1,440 off the fixed part
    expect(payrollLine(shiftOf(270), inputs({ workedHours: 229.5, performance: 60 }), sheet)).toMatchObject({ kpiScore: 0.725, kpiCut: 660, attendanceCut: 1_440, earned: 9_900 });
  });

  it('pays the whole variable part at or above 80%, never more', () => {
    expect(payrollLine(salaried, inputs({ softSkills: 70, performance: 80, clientSatisfaction: 90 }), sheet)).toMatchObject({ kpiScore: 1, kpiCut: 0, earned: 12_000 });
    // exactly 80%: (100 + 70 + 70 + 80) ÷ 4
    expect(payrollLine(salaried, inputs({ softSkills: 70, performance: 70, clientSatisfaction: 80 }), sheet)).toMatchObject({ kpiScore: 1, kpiCut: 0 });
    expect(payrollLine(salaried, inputs({ softSkills: 150, performance: 200, clientSatisfaction: 120 }), sheet)).toMatchObject({ kpiScore: 1, kpiCut: 0, earned: 12_000 });
    // a grace above 100% doesn't turn a high average into extra pay
    expect(payrollLine(salaried, inputs({ performance: 150 }), { ...sheet, kpiGracePercent: 150 })).toMatchObject({ kpiScore: 1.25, kpiCut: 0 });
  });
});

describe('payroll: days, bonus, commission and corrections', () => {
  it('cuts two days of the gross for a no-show day, and a day of the contract\'s net for a Penalty (days) after the tax', () => {
    // no-show: 1 × 2 × 12,000 ÷ 30 = 800, taken from the pay before the tax; penalty: 9,725.50 ÷ 30 = 324.18, after it
    const line = payrollLine(withItems(salaried, penaltyDays(1)), inputs({ noShowDays: 1 }));
    expect(line).toMatchObject({ noShowCut: 800, earned: 11_200, monthlyTaxable: 9_880, monthlyTax: 788.5, martyrsFund: 5.6, penaltyCut: 324.18, deductions: 2_438.28, net: 8_761.72 });
    // in the penalty cut, not in the other deductions
    expect(line).toMatchObject({ adjustmentDeductions: 0, adjustments: [expect.objectContaining({ type: 'penalty_days', days: 1, amount: 324.18 })] });
    // half days are allowed
    expect(payrollLine(withItems(salaried, penaltyDays(2.5)), inputs({ noShowDays: 0.5 }))).toMatchObject({ noShowCut: 400, penaltyCut: 810.46 });
  });

  it('sums a line\'s days, so they cost what the same days typed on the grid did, shared out by their days', () => {
    // 1 + 1.5 = 2.5 days: 2.5 × 9,725.50 ÷ 30 = 810.46; 1 day's share 810.46 × 1 ÷ 2.5 = 324.18, the rest 486.28
    const line = payrollLine(withItems(salaried, penaltyDays(1), penaltyDays(1.5)), inputs());
    expect(line.penaltyCut).toBe(810.46);
    expect(line.adjustments!.map((a) => [a.days, a.amount])).toEqual([
      [1, 324.18],
      [1.5, 486.28],
    ]);
    // a bonus day is a day of the fixed part, 9,600 ÷ 30 = 320: 1.5 + 0.5 days = 640, 480 and 160
    const bonus = payrollLine(withItems(salaried, bonusDays(1.5), bonusDays(0.5)), inputs());
    expect(bonus).toMatchObject({ bonus: 640, additionsTaxed: 0, earned: 12_640 });
    expect(bonus.adjustments!.map((a) => a.amount)).toEqual([480, 160]);
  });

  it('adds a Bonus (days) of the fixed part and a commission to the taxed pay, and takes a negative correction after tax', () => {
    // 2 × 9,600 ÷ 30 = 640; earned 12,000 + 640 + 1,500 = 14,140, all of it taxed; taxable 14,140 − 1,320 = 12,820, a
    // year 153,840 − 20,000 = 133,840: 3,750 + 20% of 63,840 = 16,518, 1,376.50 a month; the Fund 14,140 × 0.05% = 7.07;
    // the correction of 250 after it: 1,320 + 1,376.50 + 7.07 + 250 = 2,953.57, net 11,186.43
    const line = payrollLine(withItems(salaried, bonusDays(2), commission(1_500), correction(-250)), inputs());
    expect(line).toMatchObject({ bonus: 640, additionsTaxed: 1_500, adjustmentDeductions: 250, earned: 14_140, monthlyTaxable: 12_820, monthlyTax: 1_376.5, martyrsFund: 7.07 });
    expect(line).toMatchObject({ deductions: 2_953.57, net: 11_186.43 });
    // the grid's commission and settlements are no more (17 October 2026)
    expect(line).not.toHaveProperty('commission');
    expect(line).not.toHaveProperty('settlements');
    // a correction added is taxed pay, as a settlement was: 12,000 + 160 + 300.25
    expect(payrollLine(withItems(salaried, bonusDays(0.5), correction(300.25)), inputs())).toMatchObject({ bonus: 160, additionsTaxed: 300.25, earned: 12_460.25 });
  });

  it('works a line saved with the grid\'s figures (before 17 October 2026) out as it was', () => {
    // 2 × 9,600 ÷ 30 = 640; earned 12,000 + 640 + 1,500 − 250 = 13,890, all of it taxed
    const saved: SavedPayrollInputs = { ...inputs(), bonusDays: 2, penaltyDays: null, commission: 1_500, settlements: -250 };
    const line = payrollLine(salaried, saved);
    expect(line).toMatchObject({ bonus: 640, commission: 1_500, settlements: -250, earned: 13_890, monthlyTaxable: 12_570, martyrsFund: 6.95 });
    expect(line.net).toBe(Math.round((13_890 - line.deductions) * 100) / 100);
    expect(payrollLine(salaried, { ...inputs(), noShowDays: 1, penaltyDays: 1 } as SavedPayrollInputs)).toMatchObject({ penaltyCut: 324.18, net: 8_761.72 });
    // with the grid's empty: as without, the two old fields at 0
    const empty: SavedPayrollInputs = { ...inputs(), bonusDays: null, penaltyDays: null, commission: null, settlements: null };
    expect(payrollLine(salaried, empty)).toEqual({
      ...payrollLine(salaried, inputs()),
      commission: 0,
      settlements: 0,
    });
  });

  it('ignores a medical subscription in inputs saved before it was taken off the payroll (16 October 2026)', () => {
    const saved = { ...inputs(), medical: 350 };
    const line = payrollLine(salaried, saved);
    expect(line).toEqual(payrollLine(salaried, inputs()));
    expect(line).not.toHaveProperty('medical');
    expect(line).toMatchObject({ deductions: 2_274.5, net: 9_725.5 });
  });
});

describe('payroll: no-show days, charged once (owner\'s decisions, 16 and 17 October 2026)', () => {
  // a no-show day costs 2 days of the gross, 2 × 12,000 ÷ 30 = 800; its 9 hours come out of the shift's 198
  const NO_SHIFT = "No shift on the employment, so the no-show days' hours couldn't be taken out of the expected hours: type the expected hours without them";
  const CAPPED = 'The no-show days cost more than the salary left for the days paid: the cut is capped there';

  it('takes their hours out of the shift\'s hours, so attendance doesn\'t charge them again', () => {
    // 6 days off: 198 − 6 × 9 = 144 expected, all 144 worked: 100%, no attendance cut (on 198 it would be 72.73%).
    // Cut 6 × 800 = 4,800; earned 12,000 − 4,800 = 7,200. Insurance 1,320; taxable 5,880; × 12 = 70,560, less
    // 20,000 = 50,560; tax 10% of 10,560 = 1,056 a year, 88 a month; Martyrs' Fund 3.60. Deductions 1,411.60, net
    // 7,200 − 1,411.60 = 5,788.40.
    const line = payrollLine(onShift, inputs({ workedHours: 144, noShowDays: 6 }));
    expect(line).toMatchObject({
      absentHours: 54,
      leaveHours: 0,
      expectedHours: 144,
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
    // 122:24 of the 144 left is 85%: 9,600 × 15% = 1,440 off the fixed part, and the 4,800: earned 5,760
    const line = payrollLine(onShift, inputs({ workedHours: 122.4, noShowDays: 6 }));
    expect(line).toMatchObject({ absentHours: 54, expectedHours: 144, attendanceRatio: 0.85, attendanceCut: 1_440, noShowCut: 4_800, earned: 5_760 });
    // half a day off is half a shift: 193:30 left, all worked; 400 off
    expect(payrollLine(onShift, inputs({ workedHours: 193.5, noShowDays: 0.5 }))).toMatchObject({ absentHours: 4.5, expectedHours: 193.5, attendanceRatio: 1, noShowCut: 400 });
  });

  it('works a line saved with expected hours HR typed (before 20 October 2026) out as it was: already without the no-show days', () => {
    // never typed since (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data"), but
    // a run with the CEO, approved or paid keeps what was typed (17 October 2026: "dont count abcent days or leave days,
    // as they already have their own deduction and fields"): 144 typed, all worked, is 100%; nothing more comes out
    expect(payrollLine(onShift, inputs({ workedHours: 144, expectedHours: 144, noShowDays: 6 }))).toMatchObject({
      absentHours: 0,
      expectedHours: 144,
      attendanceRatio: 1,
      attendanceCut: 0,
      noShowCut: 4_800,
      earned: 7_200,
      warnings: [],
    });
    // 198 typed with the days off in them: 144 of 198 is 72.73% (until 17 October 2026 the 54 came out of them), so
    // 9,600 × (1 − 0.7272727273) = 2,618.18 more is cut: 12,000 − 2,618.18 − 4,800 = 4,581.82
    expect(payrollLine(onShift, inputs({ workedHours: 144, expectedHours: 198, noShowDays: 6 }))).toMatchObject({
      absentHours: 0,
      expectedHours: 198,
      attendanceRatio: 0.7272727273,
      attendanceCut: 2_618.18,
      earned: 4_581.82,
    });
  });

  it('without a shift, has no expected hours: attendance isn\'t counted, only the no-show cut, and says so (20 October 2026)', () => {
    const noShift = { ...salaried, hoursPerDay: null };
    const line = payrollLine(noShift, inputs({ workedHours: 216, noShowDays: 6 }));
    expect(line).toMatchObject({ absentHours: 0, expectedHours: null, attendanceRatio: null, attendanceCut: 0, noShowCut: 4_800, earned: 7_200 });
    expect(line.warnings).toEqual([NO_SHIFT_NO_EXPECTED_HOURS]);
  });

  it('without a shift, works a line saved with expected hours HR typed (before 20 October 2026) out as it was, and says so', () => {
    // 216 of 270 is 80%: the 1,920 is charged on top of the 4,800, unless HR typed the expected hours without the days off
    const noShift = { ...salaried, hoursPerDay: null };
    const typed = payrollLine(noShift, inputs({ workedHours: 216, expectedHours: 270, noShowDays: 6 }));
    expect(typed).toMatchObject({ absentHours: 0, expectedHours: 270, attendanceRatio: 0.8, attendanceCut: 1_920, noShowCut: 4_800, earned: 5_280 });
    expect(typed.warnings).toEqual([NO_SHIFT]);
    expect(payrollLine(noShift, inputs({ workedHours: 216, expectedHours: 216, noShowDays: 6 }))).toMatchObject({ attendanceRatio: 1, attendanceCut: 0, earned: 7_200 });
    // terms worked out before the hours a day existed read as without a shift
    const older = { ...salaried, hoursPerDay: undefined } as unknown as PayrollTerms;
    expect(payrollLine(older, inputs({ workedHours: 216, expectedHours: 270, noShowDays: 6 }))).toEqual(typed);
    // no warning when no hours are typed: attendance isn't counted anyway
    expect(payrollLine(noShift, inputs({ noShowDays: 6 })).warnings).toEqual([]);
  });

  it('doesn\'t count attendance when the days off are all the shift\'s hours, and the no-show cut alone applies', () => {
    // 10 days off of a 90-hour month (10 working days of 9 hours): nothing left to measure; 10 × 800 = 8,000 off,
    // earned 4,000
    const short = { ...salaried, expectedHours: 90, expectedDays: { workingDays: 10, holidays: 0 } };
    const line = payrollLine(short, inputs({ workedHours: 0, noShowDays: 10 }));
    expect(line).toMatchObject({ absentHours: 90, expectedHours: 0, attendanceRatio: null, attendanceScore: 1, attendanceCut: 0, kpiScore: 1, noShowCut: 8_000, earned: 4_000 });
    expect(line.warnings).toEqual(["The no-show days' hours are all the shift's hours this month or more: attendance isn't counted, only the no-show cut"]);
    // more days off than the shift has: still 0, never below
    expect(payrollLine(short, inputs({ workedHours: 0, noShowDays: 12 })).expectedHours).toBe(0);
  });

  it('never cuts more than the salary left for the days paid, and says so', () => {
    // 20 days off cost 16,000, more than the 12,000: capped at it. Not registered with social insurance: nothing to deduct
    const month = payrollLine({ ...salaried, insured: false }, inputs({ noShowDays: 20 }));
    expect(month).toMatchObject({ noShowCut: 12_000, earned: 0, deductions: 0, net: 0 });
    expect(month.warnings).toEqual([CAPPED]);
    // 54 worked of the 108 left after 10 days off (198 − 90) is 50%: 4,800 off the fixed part leaves 7,200 of the
    // salary, less than the 8,000 the days cost
    const short = payrollLine(onShift, inputs({ workedHours: 54, noShowDays: 10 }));
    expect(short).toMatchObject({ expectedHours: 108, attendanceRatio: 0.5, attendanceCut: 4_800, noShowCut: 7_200, earned: 0 });
    expect(short.warnings).toContain(CAPPED);
    // a part month: 15 days paid are 6,000 (4,800 fixed, 1,200 variable), less than the 8,000 of 10 days off
    const part = payrollLine({ ...salaried, paidDays: 15 }, inputs({ noShowDays: 10 }));
    expect(part).toMatchObject({ fixed: 4_800, variable: 1_200, noShowCut: 6_000, earned: 0 });
    expect(part.warnings).toEqual([PART_MONTH(15), CAPPED, 'The net is below 0: the cuts and deductions are more than the pay']);
    // up to the salary exactly: no warning
    expect(payrollLine(salaried, inputs({ noShowDays: 15 }))).toMatchObject({ noShowCut: 12_000, earned: 0, warnings: ['The net is below 0: the cuts and deductions are more than the pay'] });
  });
});

describe('payroll: leave days (owner, 17 October 2026: "dont count abcent days or leave days, as they already have their own deduction and fields")', () => {
  it('cut nothing, and their hours come out of the shift\'s hours, so attendance doesn\'t count them as short', () => {
    // 2 days of leave: 198 − 2 × 9 = 180 expected; 162 worked is 90%, at the grace: the whole salary
    expect(payrollLine(onShift, inputs({ workedHours: 162, leaveDays: 2 }))).toMatchObject({
      absentHours: 0,
      leaveHours: 18,
      expectedHours: 180,
      attendanceRatio: 0.9,
      attendanceCut: 0,
      noShowCut: 0,
      earned: 12_000,
      net: 9_725.5,
      warnings: [],
    });
    // 153 of 180 is 85%: 1,440 off the fixed part, as in the attendance test above: earned 10,560, net 8,574.22
    expect(payrollLine(onShift, inputs({ workedHours: 153, leaveDays: 2 }))).toMatchObject({ attendanceRatio: 0.85, attendanceCut: 1_440, earned: 10_560, net: 8_574.22 });
    // half a day: 4:30 out, 193:30 left
    expect(payrollLine(onShift, inputs({ workedHours: 193.5, leaveDays: 0.5 }))).toMatchObject({ leaveHours: 4.5, expectedHours: 193.5, attendanceRatio: 1 });
  });

  it('come out with the no-show days, which alone are cut', () => {
    // 1 no-show day and 2 of leave: 198 − 27 = 171; 153:54 worked is 90%; the no-show day 800: earned 11,200
    expect(payrollLine(onShift, inputs({ workedHours: 153.9, noShowDays: 1, leaveDays: 2 }))).toMatchObject({
      absentHours: 9,
      leaveHours: 18,
      expectedHours: 171,
      attendanceRatio: 0.9,
      attendanceCut: 0,
      noShowCut: 800,
      earned: 11_200,
      warnings: [],
    });
  });

  it('don\'t come out of the expected hours HR typed on a line saved with them (before 20 October 2026), already without them', () => {
    expect(payrollLine(onShift, inputs({ workedHours: 162, expectedHours: 180, leaveDays: 2 }))).toMatchObject({ leaveHours: 0, expectedHours: 180, attendanceRatio: 0.9, warnings: [] });
    // without a shift, HR typed them then, and was reminded to leave the days out
    const typed = payrollLine({ ...salaried, hoursPerDay: null }, inputs({ workedHours: 162, expectedHours: 180, leaveDays: 2 }));
    expect(typed).toMatchObject({ leaveHours: 0, expectedHours: 180, attendanceRatio: 0.9 });
    expect(typed.warnings).toEqual(["No shift on the employment, so the leave days' hours couldn't be taken out of the expected hours: type the expected hours without them"]);
    expect(payrollLine({ ...salaried, hoursPerDay: null }, inputs({ workedHours: 162, expectedHours: 180, noShowDays: 1, leaveDays: 2 })).warnings).toEqual([
      "No shift on the employment, so the no-show and leave days' hours couldn't be taken out of the expected hours: type the expected hours without them",
    ]);
  });

  it('may be all the shift\'s hours: attendance isn\'t counted', () => {
    // 2 working days of 9 hours, both on leave
    const line = payrollLine({ ...salaried, expectedHours: 18, expectedDays: { workingDays: 2, holidays: 0 } }, inputs({ workedHours: 0, leaveDays: 2 }));
    expect(line).toMatchObject({ leaveHours: 18, expectedHours: 0, attendanceRatio: null, attendanceCut: 0, earned: 12_000 });
    expect(line.warnings).toEqual(["The leave days' hours are all the shift's hours this month or more: attendance isn't counted"]);
  });

  it('are read as none on inputs saved before they existed', () => {
    const { leaveDays: _, ...saved } = inputs({ workedHours: 180 });
    expect(payrollLine(onShift, saved as PayrollInputs)).toEqual(payrollLine(onShift, inputs({ workedHours: 180 })));
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

  it('a shift\'s day for each no-show or leave day, half days too; none without either', () => {
    expect(noShowHours(2, 9)).toBe(18);
    expect(noShowHours(1.5, 8.5)).toBe(12.75);
    expect(shiftDaysHours(0.5, 9)).toBe(4.5);
    expect([noShowHours(null, 9), noShowHours(0, 9), noShowHours(2, null), noShowHours(2, undefined), noShowHours(2, 0), shiftDaysHours(undefined, 9)]).toEqual([0, 0, 0, 0, 0, 0]);
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
    expect(line.warnings).toEqual([PART_MONTH(19)]);
  });

  it('pays nothing for no days, but the insurance is still due', () => {
    const line = payrollLine({ ...salaried, allowances, paidDays: 0 }, inputs());
    expect(line).toMatchObject({ fixed: 0, variable: 0, earned: 0, allowances: 0, employeeInsurance: 1_320, monthlyTax: 0, martyrsFund: 0, net: -1_320 });
    expect(line.warnings).toEqual([PART_MONTH(0), 'The net is below 0: the cuts and deductions are more than the pay']);
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
    const line = payrollLine(withItems({ ...salaried, statutory: false }, penaltyDays(1)), inputs());
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

  it('pays the hours worked at the rate, with a Bonus (days) and a commission', () => {
    // 96:30 × 150 = 14,475; + 416 + 500 = 15,391
    const line = payrollLine(withItems(hourly, bonusDays(1), commission(500)), inputs({ workedHours: parseHours('96:30') }));
    expect(line).toMatchObject({ fixed: 14_475, variable: 0, attendanceRatio: null, attendanceCut: 0, kpiCut: 0, overtime: 0, bonus: 416, additionsTaxed: 500, earned: 15_391, employeeInsurance: 1_716 });
    expect(line.warnings).toEqual([]);
  });

  it('ignores attendance, KPIs, no-show and leave days, and says so', () => {
    // the 9-hour shift doesn't matter either: no hours come out of anything
    // (expected hours aren't typed since 20 October 2026: a KPI and no-show days given are enough to say so)
    const line = payrollLine(hourly, inputs({ workedHours: 80, performance: 40, noShowDays: 2 }));
    expect(line).toMatchObject({ fixed: 12_000, absentHours: 0, leaveHours: 0, expectedHours: null, attendanceRatio: null, attendanceCut: 0, kpiScore: 1, kpiCut: 0, noShowCut: 0, earned: 12_000 });
    expect(line.warnings).toEqual(["Paid by the hour: the expected hours, KPIs, no-show days and leave days don't change the pay"]);
    // leave days (17 October 2026): only the hours worked are paid
    const leave = payrollLine(hourly, inputs({ workedHours: 80, leaveDays: 3 }));
    expect(leave).toMatchObject({ fixed: 12_000, leaveHours: 0, earned: 12_000, parts: [{ contractId: null, fixed: 12_000, variable: 0, allowances: 0 }] });
    expect(leave.warnings).toEqual(["Paid by the hour: the expected hours, KPIs, no-show days and leave days don't change the pay"]);
  });

  it('pays nothing for hours without them or without a rate, and says so', () => {
    const none = payrollLine(withItems(hourly, correction(3_000)), inputs());
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

  it('warns of a net below zero', () => {
    // a correction bigger than the month, taken after tax: 2,274.50 + 15,000 = 17,274.50 off 12,000
    const line = payrollLine(withItems(salaried, correction(-15_000)), inputs());
    expect(line).toMatchObject({ earned: 12_000, monthlyTax: 948.5, deductions: 17_274.5, net: -5_274.5, transfer: -5_274.5 });
    expect(line.warnings).toEqual(['The net is below 0: the cuts and deductions are more than the pay']);
  });

  it('pays nothing to the Martyrs\' Fund on pay below zero (settlements typed before 17 October 2026)', () => {
    // a settlement bigger than the month was in the gross: earned 12,000 − 15,000 = −3,000, no tax, the insurance still due
    const line = payrollLine(salaried, { ...inputs(), settlements: -15_000 } as SavedPayrollInputs);
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

describe('payroll: the days paid under each contract (owner, 17 October 2026)', () => {
  // "take into consideration the start and end date of the contract if it is in the middle of the billing period"
  it('splits a whole month by its contracts\' days, the last what is left of the divisor', () => {
    // a renewal on 15 October (31 days): 14 days on the contract before, 30 − 14 = 16 on the new one
    expect(paidDaysOf('2026-10', [{ from: '2026-10-01', to: '2026-10-14' }, { from: '2026-10-15', to: '2026-10-31' }], 30)).toEqual([14, 16]);
    // on 15 February (28 days): 14 and 16 too
    expect(paidDaysOf('2026-02', [{ from: '2026-02-01', to: '2026-02-14' }, { from: '2026-02-15', to: '2026-02-28' }], 30)).toEqual([14, 16]);
    // one contract all month: the divisor, whatever the month's length
    expect(paidDaysOf('2026-10', [{ from: '2026-10-01', to: '2026-10-31' }], 30)).toEqual([30]);
    // a renewal on the 31st: all 30 days on the contract before
    expect(paidDaysOf('2026-10', [{ from: '2026-10-01', to: '2026-10-30' }, { from: '2026-10-31', to: '2026-10-31' }], 30)).toEqual([30, 0]);
  });

  it('pays only the calendar days under a contract when the month isn\'t wholly covered, at most the divisor', () => {
    // one contract ended on 10 September, the next began on the 20th: 10 + 11 = 21 days, the 9 between not paid
    expect(paidDaysOf('2026-09', [{ from: '2026-09-01', to: '2026-09-10' }, { from: '2026-09-20', to: '2026-09-30' }], 30)).toEqual([10, 11]);
    // ended on the 10th with no renewal: 10
    expect(paidDaysOf('2026-09', [{ from: '2026-09-01', to: '2026-09-10' }], 30)).toEqual([10]);
    // joined on 12 September, under contract from the 15th: 16
    expect(paidDaysOf('2026-09', [{ from: '2026-09-15', to: '2026-09-30' }], 30)).toEqual([16]);
    // 10 + 17 = 27 days of a 31-day month with a divisor of 26: 26, the last part 16
    expect(paidDaysOf('2026-10', [{ from: '2026-10-01', to: '2026-10-10' }, { from: '2026-10-15', to: '2026-10-31' }], 26)).toEqual([10, 16]);
    // none
    expect(paidDaysOf('2026-09', [], 30)).toEqual([]);
  });

  it('refuses parts outside the month, the wrong way round, overlapping or out of order', () => {
    for (const parts of [
      [{ from: '2026-08-31', to: '2026-09-10' }],
      [{ from: '2026-09-10', to: '2026-09-01' }],
      [{ from: '2026-09-01', to: '2026-09-10' }, { from: '2026-09-10', to: '2026-09-30' }],
      [{ from: '2026-09-20', to: '2026-09-30' }, { from: '2026-09-01', to: '2026-09-10' }],
      [{ from: '1/9/2026', to: '2026-09-10' }],
    ]) {
      expect(() => paidDaysOf('2026-09', parts, 30)).toThrow(RangeError);
    }
    expect(() => paidDaysOf('2026-9', [], 30)).toThrow(RangeError);
  });
});

describe('payroll: a month under two contracts (owner, 17 October 2026)', () => {
  const segment = (over: Partial<PayrollSegment>): PayrollSegment => ({
    contractId: 'v1',
    number: 'CON-2025-0004',
    version: 1,
    from: '2026-10-01',
    to: '2026-10-31',
    days: 30,
    payBasis: 'monthly',
    gross: 12_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [{ name: 'Transport', amount: 1_500, taxable: true, insured: false }],
    ...over,
  });
  // renewed on 15 October with new pay: 1–14 October on the contract before (gross 12,000, transport 1,500), 15–31 on
  // the new one (gross 15,000, transport 1,800); the insured wage as before the renewal until January (12,000)
  const before = segment({ to: '2026-10-14', days: 14 });
  const renewal = segment({ contractId: 'v2', number: 'CON-2026-0019', version: 2, from: '2026-10-15', days: 16, gross: 15_000, allowances: [{ name: 'Transport', amount: 1_800, taxable: true, insured: false }] });
  const renewed: PayrollTerms = { ...salaried, gross: 15_000, allowances: renewal.allowances, segments: [before, renewal] };

  it('pays each part its own contract\'s fixed and variable pay and allowances for its days, added up', () => {
    // Worked by hand. Before: fixed 9,600 × 14 ÷ 30 = 4,480, variable 2,400 × 14 ÷ 30 = 1,120, transport 1,500 × 14 ÷
    // 30 = 700. The renewal: fixed 12,000 × 16 ÷ 30 = 6,400, variable 3,000 × 16 ÷ 30 = 1,600, transport 1,800 × 16 ÷
    // 30 = 960. Fixed 10,880, variable 2,720: earned 13,600; allowances 1,660, all taxed. Insurance on the whole 12,000:
    // 1,320 (the company 2,250). Taxed pay 15,260; taxable 15,260 − 1,320 = 13,940 a month; × 12 = 167,280, less 20,000
    // = 147,280 a year; tax 1,500 + 2,250 + 20% of 77,280 (15,456) = 19,206, ÷ 12 = 1,600.50. Martyrs' Fund 15,260 ×
    // 0.05% = 7.63. Deductions 1,320 + 1,600.50 + 7.63 = 2,928.13; net 13,600 + 1,660 − 2,928.13 = 12,331.87.
    const line = payrollLine(renewed, inputs());
    expect(line).toMatchObject({
      fixed: 10_880,
      variable: 2_720,
      parts: [
        { contractId: 'v1', fixed: 4_480, variable: 1_120, allowances: 700 },
        { contractId: 'v2', fixed: 6_400, variable: 1_600, allowances: 960 },
      ],
      earned: 13_600,
      allowances: 1_660,
      taxableAllowances: 1_660,
      employeeInsurance: 1_320,
      employerInsurance: 2_250,
      monthlyTaxable: 13_940,
      annualNetIncome: 147_280,
      monthlyTax: 1_600.5,
      martyrsFund: 7.63,
      deductions: 2_928.13,
      net: 12_331.87,
      companyCost: 17_510,
      warnings: [],
    });
    expect(splitSegments(renewed)).toEqual([before, renewal]);
  });

  it('cuts the sums for attendance, and prices the bonus, no-show and penalty days on the contract at the month\'s end', () => {
    // 80% attendance: 20% of the fixed 10,880 = 2,176. A bonus day: the new fixed 12,000 ÷ 30 = 400. A no-show day: 2 ×
    // 15,000 ÷ 30 = 1,000. A penalty day: the new contract's net ÷ 30. Its net: insurance 1,650, taxable 13,350, × 12
    // − 20,000 = 140,200, tax 3,750 + 20% of 70,200 = 17,790 a year, 1,482.50 a month, Martyrs' Fund 7.50: 15,000 −
    // 1,650 − 1,482.50 − 7.50 = 11,860; ÷ 30 = 395.33
    // (the shift's 209:00 less the no-show day's 9:00: 160 of 200)
    const line = payrollLine(withItems(shiftOf(209, renewed), bonusDays(1), penaltyDays(1)), inputs({ workedHours: 160, noShowDays: 1 }));
    expect(line).toMatchObject({ attendanceRatio: 0.8, attendanceCut: 2_176, bonus: 400, noShowCut: 1_000, penaltyCut: 395.33 });
    // 10,880 − 2,176 + 2,720 − 1,000 + 400
    expect(line.earned).toBe(10_824);
  });

  it('a part month between contracts pays only the days under one, each on its own', () => {
    // ended on 10 September, renewed from the 20th at the same pay: 10 + 11 = 21 days, as one contract for 21 days
    const gap: PayrollTerms = {
      ...salaried,
      paidDays: 21,
      allowances: [],
      segments: [
        segment({ from: '2026-09-01', to: '2026-09-10', days: 10, allowances: [] }),
        segment({ contractId: 'v2', version: 2, from: '2026-09-20', to: '2026-09-30', days: 11, allowances: [] }),
      ],
    };
    const line = payrollLine(gap, inputs());
    // fixed 3,200 + 3,520, variable 800 + 880
    expect(line).toMatchObject({ fixed: 6_720, variable: 1_680, earned: 8_400 });
    expect(line.parts.map((p) => [p.fixed, p.variable])).toEqual([
      [3_200, 800],
      [3_520, 880],
    ]);
    expect(line.warnings).toEqual([PART_MONTH(21)]);
    const { parts: _, ...rest } = line;
    const { parts: __, ...one } = payrollLine({ ...gap, segments: undefined }, inputs());
    expect(rest).toEqual(one);
  });

  it('with one of them by the hour, pays the latest alone for the whole month, and says so', () => {
    // by the hour to 14 October at 100 an hour, then a monthly salary of 12,000: the month on the salary, all 30 days
    const hourlyFirst = segment({ payBasis: 'hourly', hourlyRate: 100, gross: 8_666.67, to: '2026-10-14', days: 14, allowances: [] });
    const monthlyAfter = segment({ contractId: 'v2', number: 'CON-2026-0019', version: 2, from: '2026-10-15', days: 16 });
    const toMonthly = payrollLine({ ...salaried, allowances: monthlyAfter.allowances, segments: [hourlyFirst, monthlyAfter] }, inputs({ workedHours: 40 }));
    // 9,600 and 2,400 for 30 days, the transport 1,500 whole
    expect(toMonthly).toMatchObject({ fixed: 9_600, variable: 2_400, allowances: 1_500, parts: [{ contractId: 'v2', fixed: 9_600, variable: 2_400, allowances: 1_500 }] });
    expect(toMonthly.warnings).toContain(
      "2 contracts this month, one paid by the hour: the whole month is paid on the latest, CON-2026-0019 v2, as hours can't be split between contracts without attendance",
    );
    // the other way round: the hours at the new rate, 80 × 150 = 12,000
    const monthlyFirst = segment({ to: '2026-10-14', days: 14 });
    const hourlyAfter = segment({ contractId: 'v2', number: 'CON-2026-0019', version: 2, from: '2026-10-15', days: 16, payBasis: 'hourly', hourlyRate: 150, gross: 13_000, allowances: [] });
    const toHourly = payrollLine(
      { ...salaried, payBasis: 'hourly', hourlyRate: 150, gross: 13_000, allowances: [], segments: [monthlyFirst, hourlyAfter] },
      inputs({ workedHours: 80 }),
    );
    expect(toHourly).toMatchObject({ fixed: 12_000, variable: 0, earned: 12_000, parts: [{ contractId: 'v2', fixed: 12_000, variable: 0, allowances: 0 }] });
    expect(toHourly.warnings[0]).toMatch(/^2 contracts this month, one paid by the hour: the whole month is paid on the latest, CON-2026-0019 v2/);
    expect(splitSegments({ segments: [monthlyFirst, hourlyAfter] })).toBeNull();
    // both by the hour (a new rate mid-month): the latest rate for all the hours, 80 × 150
    const both = payrollLine(
      { ...salaried, payBasis: 'hourly', hourlyRate: 150, gross: 13_000, allowances: [], segments: [{ ...hourlyFirst, allowances: [] }, hourlyAfter] },
      inputs({ workedHours: 80 }),
    );
    expect(both).toMatchObject({ fixed: 12_000, earned: 12_000 });
    expect(both.warnings[0]).toMatch(/^2 contracts this month, both paid by the hour: the whole month is paid on the latest, CON-2026-0019 v2/);
  });

  it('a month on one contract, and a line made before 17 October 2026 (no segments), pay as before', () => {
    const one = payrollLine(shiftOf(270, { ...salaried, segments: [segment({ allowances: [] })] }), inputs({ workedHours: 229.5 }));
    const before = payrollLine(shiftOf(270), inputs({ workedHours: 229.5 }));
    expect(one.parts).toEqual([{ contractId: 'v1', fixed: 9_600, variable: 2_400, allowances: 0 }]);
    expect({ ...one, parts: before.parts }).toEqual(before);
    expect(before).toMatchObject({ attendanceCut: 1_440, earned: 10_560, net: 8_574.22 });
    expect([splitSegments(salaried), splitSegments({ segments: [segment({})] })]).toEqual([null, null]);
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

describe('payroll: the attendance deduction waived by the CEO (owner, 17 October 2026)', () => {
  // "if there is an attendance deduction, allow the CEO to wave the deduction by ticking a box"
  it('takes no attendance cut, and keeps what it was', () => {
    // 160 of 200 hours: 80%, below 90%: 20% of the fixed 9,600 = 1,920
    const cut = payrollLine(shiftOf(200), inputs({ workedHours: 160 }));
    expect(cut).toMatchObject({ attendanceRatio: 0.8, attendanceCut: 1_920, attendanceWaived: 0, earned: 10_080 });
    const waived = payrollLine(shiftOf(200), inputs({ workedHours: 160, attendanceWaived: true }));
    expect(waived).toMatchObject({ attendanceRatio: 0.8, attendanceScore: 0.8, attendanceCut: 0, attendanceWaived: 1_920, earned: 12_000 });
    // the rest as without the attendance cut
    expect(waived.net).toBe(payrollLine(salaried, inputs()).net);
  });

  it('leaves the KPI cut and the no-show cut as they are worked out', () => {
    // the attendance still counts in the KPI average (the rules of before 25 October 2026, which average it in): (80% +
    // 70%) ÷ 2 = 75%, below 80%: 25% of the variable 2,400 = 600
    const { kpiIncludesAttendance: _, ...sheet } = PAYROLL_RULE_DEFAULTS;
    const kpi = payrollLine(shiftOf(200), inputs({ workedHours: 160, softSkills: 70, attendanceWaived: true }), sheet);
    expect(kpi).toMatchObject({ attendanceCut: 0, attendanceWaived: 1_920, kpiScore: 0.75, kpiCut: 600, earned: 11_400 });
    // 100 of 200 hours: 50%, a cut of 4,800; 10 no-show days would cost 8,000, capped at the 7,200 left after the cut:
    // still 7,200 once the cut is waived, so 9,600 + 2,400 − 7,200 = 4,800 is earned
    // (the shift's 290:00 less the 10 days' 90:00)
    const capped = payrollLine(shiftOf(290), inputs({ workedHours: 100, noShowDays: 10, attendanceWaived: true }));
    expect(capped).toMatchObject({ attendanceCut: 0, attendanceWaived: 4_800, noShowCut: 7_200, earned: 4_800 });
  });

  it('waives nothing without a cut, nor for pay by the hour', () => {
    expect(payrollLine(shiftOf(200), inputs({ workedHours: 190, attendanceWaived: true }))).toMatchObject({ attendanceCut: 0, attendanceWaived: 0 });
    const hourly: PayrollTerms = { ...salaried, payBasis: 'hourly', gross: 15_600, hourlyRate: 150, insuredWage: 15_600 };
    expect(payrollLine(hourly, inputs({ workedHours: 80, attendanceWaived: true }))).toMatchObject({ attendanceCut: 0, attendanceWaived: 0, earned: 12_000 });
  });
});
