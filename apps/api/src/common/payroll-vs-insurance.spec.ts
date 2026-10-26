import {
  EMPTY_PAYROLL_INPUTS,
  lawRatesFor,
  monthlySalaryTax,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  payrollVsInsurance,
  vsInsuranceCountsText,
  vsInsuranceCycle,
  vsInsuranceGroups,
  vsInsuranceInputs,
  vsInsuranceRow,
  vsInsuranceRulesText,
  vsInsuranceStanding,
  vsInsuranceStatusText,
  vsInsuranceTerms,
  type PayrollRules,
  type PayrollTerms,
  type SavedPayrollInputs,
  type VsInsuranceSourceLine,
  type VsInsuranceSourceRun,
} from '@trendlix/shared';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "a comparison report between the actual payroll run and
// the social insurance data, and the differences in the social insurance and taxes between the 2 runs"): the B cycle for
// one line, hand-worked (a gross of 20,000 with allowances of 2,000, a registered wage of 12,000, basic 80%, the 2026
// rates), the differences, a person not registered, a freelancer, the switch on, pay by the hour, the groups and the
// words. Everyone here is invented.

const LAW = lawRatesFor(2026);
const RULES: PayrollRules = { ...PAYROLL_RULE_DEFAULTS, insureEveryone: false };
const RULES_EVERYONE: PayrollRules = { ...PAYROLL_RULE_DEFAULTS, insureEveryone: true };

/** A monthly line's terms for a whole month of 2026, on a 9-hour shift. */
function terms(over: Partial<PayrollTerms> = {}): PayrollTerms {
  return {
    year: 2026,
    payBasis: 'monthly',
    gross: 20000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [{ name: 'Transport', amount: 2000, taxable: true, insured: false }],
    paidDays: 30,
    segments: [
      {
        contractId: 'c1',
        number: 'CON-2026-0001',
        version: 1,
        from: '2026-09-01',
        to: '2026-09-30',
        days: 30,
        payBasis: 'monthly',
        gross: 20000,
        basicPercent: 80,
        hourlyRate: null,
        allowances: [{ name: 'Transport', amount: 2000, taxable: true, insured: false }],
      },
    ],
    statutory: true,
    insured: true,
    insuredWage: 12000,
    hoursPerDay: 9,
    expectedHours: 198,
    expectedDays: { workingDays: 22, holidays: 0 },
    ...over,
  };
}

let n = 0;
function line(t: PayrollTerms, inputs: SavedPayrollInputs = EMPTY_PAYROLL_INPUTS, over: Partial<VsInsuranceSourceLine> = {}): VsInsuranceSourceLine {
  n += 1;
  return {
    id: `line-${n}`,
    employeeId: `employee-${n}`,
    employeeCode: `EMP-${String(n).padStart(4, '0')}`,
    nameEn: `Person ${n}`,
    department: 'Sales › Field',
    jobTitle: 'Account Manager',
    employmentType: 'full_time',
    payBasis: t.payBasis,
    onHold: false,
    terms: t,
    inputs,
    result: payrollLine(t, inputs, RULES, LAW),
    ...over,
  };
}

const run = (lines: VsInsuranceSourceLine[], over: Partial<VsInsuranceSourceRun> = {}): VsInsuranceSourceRun => ({ id: 'run-1', month: '2026-09', status: 'paid', rules: RULES, law: LAW, lines, ...over });

describe('the SI cycle of one line', () => {
  const registered = line(terms());
  const b = vsInsuranceCycle(registered, RULES, LAW);

  it('is the same engine on the registered wage: 12,000 gross, no allowances, SI 1,320 and 2,250, tax on 12,000 − 1,320', () => {
    expect(b.fixed).toBe(9600);
    expect(b.variable).toBe(2400);
    expect(b.earned).toBe(12000);
    expect(b.allowances).toBe(0);
    expect(b.insuredWage).toBe(12000);
    expect(b.employeeInsurance).toBe(1320);
    expect(b.employerInsurance).toBe(2250);
    expect(b.monthlyTaxable).toBe(10680);
    const tax = monthlySalaryTax({ taxedPay: 12000, employeeInsurance: 1320 }, LAW);
    expect(b.monthlyTax).toBe(tax.monthlyTax);
    expect(b.monthlyTax).toBeGreaterThan(0);
    expect(b.martyrsFund).toBe(6);
    expect(b.net).toBe(Math.round((12000 - 1320 - tax.monthlyTax - 6) * 100) / 100);
    expect(b.companyCost).toBe(14250);
  });

  it('the actual run is as stored: 20,000 and the allowances, the same insurance, tax on 22,000 − 1,320', () => {
    const a = registered.result;
    expect(a).toMatchObject({ earned: 20000, allowances: 2000, insuredWage: 12000, employeeInsurance: 1320, employerInsurance: 2250, monthlyTaxable: 20680, martyrsFund: 11, companyCost: 24250 });
  });

  it('the row has the three blocks, the differences B − A: no change in the insurance, less tax, less net, 10,000 less cost', () => {
    const row = vsInsuranceRow(run([registered]), registered);
    expect(row.standing).toBe('registered');
    expect(row.actual).toMatchObject({ gross: 20000, allowances: 2000, paidDays: 30 });
    expect(row.insurance).toMatchObject({ gross: 12000, allowances: 0, employeeInsurance: 1320, employerInsurance: 2250 });
    expect(row.difference).toMatchObject({ employeeInsurance: 0, employerInsurance: 0, companyCost: -10000 });
    expect(row.difference!.monthlyTax).toBe(Math.round((b.monthlyTax - registered.result.monthlyTax) * 100) / 100);
    expect(row.difference!.monthlyTax).toBeLessThan(0);
    expect(row.difference!.martyrsFund).toBe(-5);
    expect(row.difference!.net).toBe(Math.round((b.net - registered.result.net) * 100) / 100);
    expect(row.difference!.net).toBeLessThan(0);
  });

  it('keeps the same attendance, no-show and leave inputs, the bonus and penalty days and the deductions, and drops the amount-based additions', () => {
    const t = terms({
      adjustments: [
        { id: 'a1', kind: 'addition', type: 'bonus_days', taxed: true, amount: null, days: 1, reason: 'A good month' },
        { id: 'a2', kind: 'addition', type: 'commission', taxed: true, amount: 3000, reason: 'Sales' },
        { id: 'a3', kind: 'addition', type: 'other', taxed: false, amount: 500, reason: 'A gift' },
        { id: 'a4', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1, reason: 'Late' },
        { id: 'a5', kind: 'deduction', type: 'loan_installment', taxed: false, amount: 1000, reason: 'Loan' },
      ],
    });
    const inputs: SavedPayrollInputs = { ...EMPTY_PAYROLL_INPUTS, workedHours: 150, noShowDays: 1, leaveDays: 2 };
    const bTerms = vsInsuranceTerms(t);
    expect(bTerms.adjustments!.map((a) => a.id)).toEqual(['a1', 'a4', 'a5']);
    expect(bTerms).toMatchObject({ gross: 12000, allowances: [], insured: true, insuredWage: 12000, basicPercent: 80, paidDays: 30 });
    expect(bTerms.segments![0]).toMatchObject({ gross: 12000, allowances: [], days: 30 });
    const result = vsInsuranceCycle(line(t, inputs), RULES, LAW);
    // a no-show day: 2 days of 12,000 ÷ 30 = 800; a bonus day: 9,600 ÷ 30 = 320; the leave days cost nothing
    expect(result.noShowCut).toBe(800);
    expect(result.bonus).toBe(320);
    expect(result.additionsTaxed).toBe(0);
    expect(result.additionsUntaxed).toBe(0);
    expect(result.adjustmentDeductions).toBe(1000);
    expect(result.penaltyCut).toBeGreaterThan(0);
    // the attendance measured on the same expected hours less the days off: 198 − 27 = 171, 150 worked
    expect(result.expectedHours).toBe(171);
    expect(result.attendanceCut).toBeGreaterThan(0);
  });

  it('a line saved with the grid’s figures keeps its bonus and penalty days, not its commission or settlements', () => {
    const inputs = vsInsuranceInputs({ ...EMPTY_PAYROLL_INPUTS, bonusDays: 1, penaltyDays: 0.5, commission: 2000, settlements: -100 }, 'monthly');
    expect(inputs).toMatchObject({ bonusDays: 1, penaltyDays: 0.5 });
    expect(inputs).not.toHaveProperty('commission');
    expect(inputs).not.toHaveProperty('settlements');
  });
});

describe('who has a cycle', () => {
  it('a person not registered, with the switch off: A deducts no insurance, B blank', () => {
    const l = line(terms({ insured: false, insuredWage: 9000, gross: 9000, allowances: [], segments: undefined }));
    expect(vsInsuranceStanding(l.terms)).toBe('not_registered');
    const row = vsInsuranceRow(run([l]), l);
    expect(row.actual).toMatchObject({ gross: 9000, insuredWage: 0, employeeInsurance: 0, employerInsurance: 0 });
    expect(row.insurance).toBeNull();
    expect(row.difference).toBeNull();
  });

  it('with the switch on: A has the shares on the computed insured wage, flagged counted as insured, B still blank', () => {
    const t = terms({ insured: true, notRegistered: true, insuredWage: 9000, gross: 9000, allowances: [], segments: undefined });
    const l = line(t, EMPTY_PAYROLL_INPUTS, { result: payrollLine(t, EMPTY_PAYROLL_INPUTS, RULES_EVERYONE, LAW) });
    expect(vsInsuranceStanding(l.terms)).toBe('counted_as_insured');
    const row = vsInsuranceRow(run([l], { rules: RULES_EVERYONE }), l);
    expect(row.actual).toMatchObject({ insuredWage: 9000, employeeInsurance: 990, employerInsurance: 1687.5 });
    expect(row.insurance).toBeNull();
  });

  it('a freelancer: outside the labour law, A without insurance or tax, B blank', () => {
    const t = terms({ statutory: false, insured: false, insuredWage: 5000, gross: 5000, allowances: [], segments: undefined });
    const l = line(t, EMPTY_PAYROLL_INPUTS, { employmentType: 'freelance' });
    expect(vsInsuranceStanding(l.terms)).toBe('outside_law');
    const row = vsInsuranceRow(run([l]), l);
    expect(row.actual).toMatchObject({ gross: 5000, employeeInsurance: 0, monthlyTax: 0, martyrsFund: 0, net: 5000 });
    expect(row.insurance).toBeNull();
  });

  it('pay by the hour: the SI cycle is the registered wage as a monthly salary for the days paid, the hours left out', () => {
    const t = terms({ payBasis: 'hourly', hourlyRate: 100, gross: 8000, allowances: [], segments: undefined, insuredWage: 4000, hoursPerDay: null, expectedHours: null, expectedDays: null });
    const inputs: SavedPayrollInputs = { ...EMPTY_PAYROLL_INPUTS, workedHours: 60 };
    const l = line(t, inputs);
    expect(l.result.earned).toBe(6000);
    const b = vsInsuranceCycle(l, RULES, LAW);
    expect(b.earned).toBe(4000);
    expect(b.attendanceRatio).toBeNull();
    expect(b.employeeInsurance).toBe(440);
    expect(b.warnings).not.toContainEqual(expect.stringContaining('by the hour'));
  });
});

describe('the report', () => {
  const registered = line(terms(), EMPTY_PAYROLL_INPUTS, { nameEn: 'Rana Registered', department: 'Sales › Field' });
  const counted = (() => {
    const t = terms({ insured: true, notRegistered: true, insuredWage: 9000, gross: 9000, allowances: [], segments: undefined });
    return line(t, EMPTY_PAYROLL_INPUTS, { nameEn: 'Nour Notyet', department: 'Sales', result: payrollLine(t, EMPTY_PAYROLL_INPUTS, RULES_EVERYONE, LAW) });
  })();
  const freelancer = line(terms({ statutory: false, insured: false, insuredWage: 5000, gross: 5000, allowances: [], segments: undefined }), EMPTY_PAYROLL_INPUTS, {
    nameEn: 'Fady Free',
    department: null,
    employmentType: 'freelance',
  });
  const september = run([freelancer, counted, registered], { rules: RULES_EVERYONE });
  const october = run([{ ...registered, id: 'line-oct' }], { id: 'run-2', month: '2026-10', status: 'draft' });
  const report = payrollVsInsurance([october, september]);

  it('has a row per line, by department (none last), name, then month; the runs oldest first with their rules', () => {
    expect(report.rows.map((r) => [r.employee.fullNameEn, r.month, r.standing])).toEqual([
      ['Nour Notyet', '2026-09', 'counted_as_insured'],
      ['Rana Registered', '2026-09', 'registered'],
      ['Rana Registered', '2026-10', 'registered'],
      ['Fady Free', '2026-09', 'outside_law'],
    ]);
    expect(report.runs.map((r) => [r.month, r.status, r.insureEveryone, r.lines])).toEqual([
      ['2026-09', 'paid', true, 3],
      ['2026-10', 'draft', false, 1],
    ]);
    expect(report.runs[0].law).toEqual({ year: 2026, employeeInsuranceRate: 0.11, employerInsuranceRate: 0.1875, insurableWageMin: 2700, insurableWageMax: 16700 });
  });

  it('totals: A over everyone, B and the differences over the registered rows, the counts by standing', () => {
    const t = report.totals;
    expect(t).toMatchObject({ rows: 4, people: 3, registered: 2, notRegistered: 1, countedAsInsured: 1, outsideLaw: 1 });
    const rows = report.rows;
    expect(t.actual.companyCost).toBe(Math.round(rows.reduce((s, r) => s + r.actual.companyCost, 0) * 100) / 100);
    expect(t.actualRegistered.companyCost).toBe(24250 * 2);
    expect(t.insurance.companyCost).toBe(14250 * 2);
    expect(t.difference.companyCost).toBe(-20000);
    expect(t.difference.employeeInsurance).toBe(0);
    expect(t.insurance.employeeInsurance).toBe(2640);
  });

  it('groups by department then team, those without one last, with each group’s totals', () => {
    const groups = vsInsuranceGroups(report.rows);
    expect(groups.map((g) => [g.department, g.teams.map((t) => [t.team, t.rows.length])])).toEqual([
      ['Sales', [[null, 1], ['Field', 2]]],
      [null, [[null, 1]]],
    ]);
    expect(groups[0].totals).toMatchObject({ rows: 3, people: 2, registered: 2, countedAsInsured: 1 });
    expect(groups[0].teams[1].totals.difference.companyCost).toBe(-20000);
    expect(groups[1].totals).toMatchObject({ outsideLaw: 1, registered: 0 });
    expect(groups[1].totals.insurance.net).toBe(0);
  });

  it('says the status, the rules and the counts in words', () => {
    expect(vsInsuranceStatusText('draft')).toBe('Draft: may change');
    expect(vsInsuranceStatusText('pending_ceo')).toBe('With the CEO: may still change');
    expect(vsInsuranceStatusText('paid')).toBe('Paid');
    expect(vsInsuranceRulesText(report.runs[0])).toBe(
      'Social insurance 11% employee and 18.75% company on the insured wage, within EGP 2,700.00 to 16,700.00; tax by the 2026 rates set by law; Social insurance for everyone: on.',
    );
    expect(vsInsuranceCountsText(report.totals)).toBe('3 people on the payroll: 2 registered, 1 not registered (1 counted as insured), 1 outside the labour law. The differences are summed over the registered people.');
    expect(vsInsuranceCountsText({ people: 1, registered: 1, notRegistered: 0, countedAsInsured: 0, outsideLaw: 0 })).toBe(
      '1 person on the payroll: 1 registered, 0 not registered, 0 outside the labour law. The differences are summed over the registered people.',
    );
  });
});
