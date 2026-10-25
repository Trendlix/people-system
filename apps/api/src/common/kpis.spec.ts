import {
  EMPTY_PAYROLL_INPUTS,
  KPI_ATTENDANCE_POINTS_DEFAULT,
  KPI_DEFAULT_PILLAR_SET,
  KPI_FINAL_CAP,
  KPI_PILLARS,
  KPI_SAMPLE_TEMPLATES,
  KPI_SETTING_DEFAULTS,
  kpiAttendanceAchieved,
  kpiCalibrationStep,
  kpiDayBefore,
  kpiDeadlines,
  kpiDueChange,
  kpiEligibleType,
  kpiLevel,
  kpiMonthForPayroll,
  kpiMonthName,
  kpiOpeningMonth,
  kpiPast,
  kpiPayrollMonth,
  kpiPayScore,
  kpiPayText,
  kpiPercentText,
  kpiReminderDue,
  kpiScore,
  kpiScorecardMonthOn,
  kpiScorerOf,
  kpiSettingsProblems,
  kpiShownToEmployee,
  kpiStatusAfterScoring,
  kpiStepDeadline,
  kpiTemplateProblems,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  type KpiMetric,
  type KpiScoredMetric,
  type PayrollTerms,
} from '@trendlix/shared';

// The KPIs' rules (owner, 21 October 2026: "Full framework per role", "Self, manager, HR, sign-off", "Attendance: Yes, as
// the sheet", "Last month's KPI, this pay", "As the sheet: full at 80%+"; packages/shared kpis.ts). Invented figures.

/** A small template: one metric a pillar, targets 30 / 25 / 25 / 20, Attendance worth 20 in Discipline & Growth. */
const metrics: KpiScoredMetric[] = [
  { id: 'd', pillar: 'delivery', targetPoints: 30, criteria: [{ label: 'All on time', points: 30 }, { label: '1 late', points: 20 }, { label: 'Way ahead', points: 36 }] },
  { id: 'q', pillar: 'quality', targetPoints: 25, criteria: [{ label: 'No errors', points: 25 }, { label: 'Some', points: 10 }] },
  { id: 'c', pillar: 'clients', targetPoints: 25, criteria: [{ label: 'Great', points: 25 }, { label: 'Fine', points: 15 }, { label: 'Poor', points: 0 }] },
  { id: 'g', pillar: 'discipline', targetPoints: 20, criteria: [{ label: '2 courses', points: 20 }, { label: 'None', points: 0 }] },
];
const fullAttendance = { points: 20, achieved: 20 };

describe('the framework', () => {
  it('has the plan’s four pillars as the default, their weights adding up to 100, Attendance in Discipline & Growth', () => {
    expect(KPI_PILLARS.map((p) => [p.key, p.name, p.short, p.weight])).toEqual([
      ['delivery', 'Delivery & Timeliness', 'Delivery', 30],
      ['quality', 'Quality of Work', 'Quality', 25],
      ['clients', 'Clients & Teamwork', 'Clients', 25],
      ['discipline', 'Discipline & Growth', 'Discipline', 20],
    ]);
    expect(KPI_PILLARS.reduce((sum, p) => sum + p.weight, 0)).toBe(100);
    expect(KPI_DEFAULT_PILLAR_SET).toEqual({ pillars: KPI_PILLARS, attendancePillar: 'discipline' });
  });

  it('names the levels at their edges: each band from its lower edge, 100% exactly meeting expectations', () => {
    expect(kpiLevel(0)).toBe('unacceptable');
    expect(kpiLevel(49.9)).toBe('unacceptable');
    expect(kpiLevel(50)).toBe('unsatisfactory');
    expect(kpiLevel(69.9)).toBe('unsatisfactory');
    expect(kpiLevel(70)).toBe('needs_improvement');
    expect(kpiLevel(89.9)).toBe('needs_improvement');
    expect(kpiLevel(90)).toBe('meets');
    expect(kpiLevel(100)).toBe('meets');
    expect(kpiLevel(100.1)).toBe('above');
    expect(kpiLevel(110)).toBe('above');
  });

  it('writes percents whole when they are, else to one decimal', () => {
    expect(kpiPercentText(86)).toBe('86%');
    expect(kpiPercentText(89.64)).toBe('89.6%');
    expect(kpiPercentText(110)).toBe('110%');
  });
});

describe('scoring', () => {
  it('works pillar % out as achieved ÷ max and the final % as Σ pillar % × weight', () => {
    // delivery 20/30, quality 25/25, clients 15/25, discipline (20 + 20)/(20 + 20)
    const s = kpiScore(metrics, { d: 1, q: 0, c: 1, g: 0 }, fullAttendance);
    expect(s.pillars.map((p) => [p.achieved, p.max, p.percent])).toEqual([
      [20, 30, 66.7],
      [25, 25, 100],
      [15, 25, 60],
      [40, 40, 100],
    ]);
    // 30 × 2/3 + 25 + 25 × 0.6 + 20 = 20 + 25 + 15 + 20 = 80
    expect(s.finalPercent).toBe(80);
    expect(s.level).toBe('needs_improvement');
    expect(s.complete).toBe(true);
    expect(s.capped).toBe(false);
  });

  it('every target met is 100%: Meets expectations', () => {
    const s = kpiScore(metrics, { d: 0, q: 0, c: 0, g: 0 }, fullAttendance);
    expect(s.finalPercent).toBe(100);
    expect(s.level).toBe('meets');
  });

  it('takes a criterion worth more than its target past 100%, Above expectations', () => {
    // delivery 36/30 = 120% → 36 of the pillar's 30% weight; the rest at target: 36 + 25 + 25 + 20 = 106
    const s = kpiScore(metrics, { d: 2, q: 0, c: 0, g: 0 }, fullAttendance);
    expect(s.pillars[0].percent).toBe(120);
    expect(s.finalPercent).toBe(106);
    expect(s.level).toBe('above');
    expect(s.capped).toBe(false);
  });

  it('caps the final % at 110', () => {
    const generous: KpiScoredMetric[] = [
      { id: 'a', pillar: 'delivery', targetPoints: 10, criteria: [{ label: 'Way over', points: 20 }, { label: 'Target', points: 10 }] },
      { id: 'b', pillar: 'quality', targetPoints: 10, criteria: [{ label: 'Way over', points: 20 }, { label: 'Target', points: 10 }] },
      { id: 'c', pillar: 'clients', targetPoints: 10, criteria: [{ label: 'Target', points: 10 }, { label: 'None', points: 0 }] },
    ];
    // 30 × 2 + 25 × 2 + 25 + 20 = 155 → 110
    const s = kpiScore(generous, { a: 0, b: 0, c: 0 }, fullAttendance);
    expect(s.finalPercent).toBe(KPI_FINAL_CAP);
    expect(s.capped).toBe(true);
    expect(s.level).toBe('above');
  });

  it('counts metrics not picked yet as 0, and says the score is not complete', () => {
    const s = kpiScore(metrics, { d: 0 }, fullAttendance);
    expect(s.complete).toBe(false);
    expect(s.pillars[1]).toMatchObject({ achieved: 0, max: 25, percent: 0, complete: false });
    // Discipline & Growth: Attendance alone, 20 of 40
    expect(s.pillars[3]).toMatchObject({ achieved: 20, max: 40, percent: 50 });
  });

  it('has Discipline & Growth scored by Attendance alone when it has no metric of its own', () => {
    const s = kpiScore(metrics.slice(0, 3), { d: 0, q: 0, c: 0 }, { points: 20, achieved: 15 });
    expect(s.pillars[3]).toMatchObject({ achieved: 15, max: 20, percent: 75 });
    expect(s.finalPercent).toBe(95);
  });
});

describe('the Attendance metric', () => {
  it('is its points × the month’s attendance score, capped at 1, rounded to whole points', () => {
    expect(kpiAttendanceAchieved(20, 1)).toBe(20);
    expect(kpiAttendanceAchieved(20, 0.85)).toBe(17);
    expect(kpiAttendanceAchieved(20, 0.876)).toBe(18);
    expect(kpiAttendanceAchieved(25, 1.2)).toBe(25);
    expect(kpiAttendanceAchieved(20, -0.5)).toBe(0);
  });

  it('counts as full without a score, as payroll does', () => {
    expect(kpiAttendanceAchieved(20, null)).toBe(20);
    expect(kpiAttendanceAchieved(20, undefined)).toBe(20);
    expect(kpiAttendanceAchieved(20, Number.NaN)).toBe(20);
  });

  it('is worth 20 on a new template', () => {
    expect(KPI_ATTENDANCE_POINTS_DEFAULT).toBe(20);
  });
});

describe('templates', () => {
  const metric = (over: Partial<KpiMetric> = {}): KpiMetric => ({
    pillar: 'delivery',
    name: 'On time',
    definition: null,
    howMeasured: null,
    jdDuty: null,
    targetPoints: 30,
    criteria: [
      { label: 'No delays', points: 30 },
      { label: '1–2 delays', points: 20 },
    ],
    ...over,
  });
  const full = [metric(), metric({ pillar: 'quality', name: 'Quality' }), metric({ pillar: 'clients', name: 'Clients' })];

  it('saves a draft with any pillars, but publishes one only with a metric in each of the first three', () => {
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric()] })).toEqual([]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric()] }, { publishing: true })).toEqual([
      'Add a metric to Quality of Work: every pillar is scored.',
      'Add a metric to Clients & Teamwork: every pillar is scored.',
    ]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: full }, { publishing: true })).toEqual([]);
  });

  it('says what is wrong with a metric, by its number and name', () => {
    const problems = kpiTemplateProblems({
      attendancePoints: 0,
      metrics: [
        metric({ name: '' }),
        metric({ name: 'Attendance' }),
        metric({ criteria: [{ label: 'Only one', points: 5 }] }),
        metric({ name: 'On time', criteria: [{ label: 'Same', points: 1 }, { label: 'same', points: 2.5 }] }),
      ],
    });
    expect(problems).toEqual([
      'Give the Attendance metric whole points from 1 to 200.',
      'Metric 1: give it a name.',
      'Metric 2 (Attendance): Attendance is filled in by the system already; name this metric otherwise.',
      'Metric 3 (On time): give it from 2 to 6 criteria.',
      'Metric 4 (On time): metric 3 has the same name.',
      'Metric 4 (On time): two criteria are labelled "same".',
      'Metric 4 (On time): criterion 2 needs whole points from 0 to 200.',
    ]);
  });

  it('refuses to publish a metric whose best criterion is below its target', () => {
    const low = metric({ name: 'Low', targetPoints: 40 });
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [...full, low] }, { publishing: true })).toEqual([
      'Metric 4 (Low): its best criterion gives fewer points than its target (40), so nobody could reach 100% of it.',
    ]);
  });

  it('offers the three samples, each publishable, their own attendance metric replaced by the automatic one', () => {
    expect(KPI_SAMPLE_TEMPLATES.map((s) => s.role)).toEqual(['Senior Frontend Developer', 'Video Producer', 'HR Specialist']);
    for (const s of KPI_SAMPLE_TEMPLATES) {
      expect(kpiTemplateProblems(s, { publishing: true })).toEqual([]);
      expect(s.metrics.some((m) => /attendance/i.test(m.name))).toBe(false);
    }
    expect(KPI_SAMPLE_TEMPLATES.map((s) => s.attendancePoints)).toEqual([25, 25, 20]);
    // a sample's target is its best criterion
    expect(KPI_SAMPLE_TEMPLATES[0].metrics[0]).toMatchObject({ name: 'Sprint tasks delivered on time', targetPoints: 35 });
  });
});

describe('the steps', () => {
  it('has the CEO score a C-level person (a Super Admin the CEO), the person in charge everyone else, HR when nobody is', () => {
    expect(kpiScorerOf({ confidential: true, isCeo: false, approverId: 'm' })).toBe('ceo');
    expect(kpiScorerOf({ confidential: true, isCeo: true, approverId: null })).toBe('super_admin');
    expect(kpiScorerOf({ confidential: false, isCeo: false, approverId: 'm' })).toBe('manager');
    expect(kpiScorerOf({ confidential: false, isCeo: false, approverId: null })).toBe('hr');
  });

  it('calibrates as a step of its own only after a manager’s scoring', () => {
    expect(kpiCalibrationStep('manager')).toBe(true);
    expect(kpiStatusAfterScoring('manager')).toBe('hr');
    for (const scorer of ['hr', 'ceo', 'super_admin']) {
      expect(kpiCalibrationStep(scorer)).toBe(false);
      expect(kpiStatusAfterScoring(scorer)).toBe('sign_off');
    }
  });

  it('shows the employee the scoring from the sign-off on', () => {
    expect(['self_rating', 'manager', 'hr'].map(kpiShownToEmployee)).toEqual([false, false, false]);
    expect(['sign_off', 'final'].map(kpiShownToEmployee)).toEqual([true, true]);
  });

  it('gives a scorecard to everyone but freelancers and unpaid interns', () => {
    expect(['full_time', 'part_time', 'trainee'].map(kpiEligibleType)).toEqual([true, true, true]);
    expect(['freelance', 'intern'].map(kpiEligibleType)).toEqual([false, false]);
  });
});

describe('months and deadlines', () => {
  it('opens a month’s scorecard on the 1st of the next and counts it in that month’s payroll', () => {
    expect(kpiOpeningMonth('2026-10')).toBe('2026-11');
    expect(kpiOpeningMonth('2026-12')).toBe('2027-01');
    expect(kpiScorecardMonthOn('2026-11-01')).toBe('2026-10');
    expect(kpiScorecardMonthOn('2027-01-15')).toBe('2026-12');
    expect(kpiPayrollMonth('2026-10')).toBe('2026-11');
    expect(kpiMonthForPayroll('2026-11')).toBe('2026-10');
    expect(kpiMonthName('2026-10')).toBe('October 2026');
  });

  it('dates the deadlines in the next month: 3rd, 6th, 8th, 10th by default', () => {
    expect(kpiDeadlines('2026-10', KPI_SETTING_DEFAULTS)).toEqual({ selfRating: '2026-11-03', manager: '2026-11-06', hr: '2026-11-08', signOff: '2026-11-10' });
    expect(kpiDeadlines('2026-12', { selfRatingDay: 2, managerDay: 5, hrDay: 7, signOffDay: 28 }).signOff).toBe('2027-01-28');
    expect(kpiStepDeadline('manager', kpiDeadlines('2026-10'))).toBe('2026-11-06');
    expect(kpiStepDeadline('final', kpiDeadlines('2026-10'))).toBeNull();
  });

  it('lets a step be taken all through its deadline day', () => {
    expect(kpiPast('2026-11-03', '2026-11-03')).toBe(false);
    expect(kpiPast('2026-11-03', '2026-11-04')).toBe(true);
  });

  it('moves a self-rating not sent by its day on, and makes a scorecard not signed by its day final', () => {
    const d = kpiDeadlines('2026-10');
    expect(kpiDueChange('self_rating', d, '2026-11-03')).toBeNull();
    expect(kpiDueChange('self_rating', d, '2026-11-04')).toBe('self_missed');
    expect(kpiDueChange('sign_off', d, '2026-11-10')).toBeNull();
    expect(kpiDueChange('sign_off', d, '2026-11-11')).toBe('final_unsigned');
    // the other steps wait for their people, whatever the day
    expect(kpiDueChange('manager', d, '2026-11-20')).toBeNull();
    expect(kpiDueChange('hr', d, '2026-11-20')).toBeNull();
  });

  it('reminds the day before the step’s deadline, once', () => {
    const d = kpiDeadlines('2026-10');
    expect(kpiDayBefore('2026-11-03')).toBe('2026-11-02');
    expect(kpiDayBefore('2026-11-01')).toBeNull();
    expect(kpiReminderDue('self_rating', d, '2026-11-02', [])).toBe('self_rating');
    expect(kpiReminderDue('self_rating', d, '2026-11-02', ['self_rating'])).toBeNull();
    expect(kpiReminderDue('self_rating', d, '2026-11-01', [])).toBeNull();
    expect(kpiReminderDue('manager', d, '2026-11-05', [])).toBe('manager');
    expect(kpiReminderDue('hr', d, '2026-11-07', [])).toBe('hr');
    expect(kpiReminderDue('sign_off', d, '2026-11-09', [])).toBe('sign_off');
    expect(kpiReminderDue('final', d, '2026-11-09', [])).toBeNull();
  });

  it('checks the settings: whole days from 1 to 28, each after the one before', () => {
    expect(kpiSettingsProblems(KPI_SETTING_DEFAULTS)).toEqual([]);
    expect(kpiSettingsProblems({ selfRatingDay: 0, managerDay: 6, hrDay: 8, signOffDay: 29 })).toEqual([
      'Self-rating by: choose a day from 1 to 28.',
      'Sign-off by: choose a day from 1 to 28.',
    ]);
    expect(kpiSettingsProblems({ selfRatingDay: 5, managerDay: 5, hrDay: 4, signOffDay: 10 })).toEqual([
      'The manager’s scoring must be due after the self-rating: choose a later day.',
      'HR’s calibration must be due after the manager’s scoring: choose a later day.',
    ]);
  });
});

describe('the payroll', () => {
  /** A salaried line: gross 12,000, variable 2,400 (20%). */
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
  const kpi = (finalPercent: number) => ({ month: '2026-09', scorecardId: 's1', finalPercent, level: kpiLevel(finalPercent) });

  it('pays the variable part in full from 80%, in proportion below, and in full with no final scorecard', () => {
    expect(kpiPayScore(kpi(85), 80)).toBe(1);
    expect(kpiPayScore(kpi(80), 80)).toBe(1);
    expect(kpiPayScore(kpi(70), 80)).toBe(0.7);
    expect(kpiPayScore(null, 80)).toBe(1);
  });

  it('cuts nothing at 85%, 30% of the variable part at 70%, and nothing without a final scorecard', () => {
    expect(payrollLine({ ...terms, kpi: kpi(85) }, EMPTY_PAYROLL_INPUTS).kpiCut).toBe(0);
    const at70 = payrollLine({ ...terms, kpi: kpi(70) }, EMPTY_PAYROLL_INPUTS);
    expect(at70.kpiScore).toBe(0.7);
    expect(at70.kpiCut).toBe(720); // 30% of 2,400
    expect(payrollLine({ ...terms, kpi: null }, EMPTY_PAYROLL_INPUTS).kpiCut).toBe(0);
  });

  it('takes the scorecard’s final % alone: the KPI inputs of before are left aside on a line with it', () => {
    const typed = { ...EMPTY_PAYROLL_INPUTS, performance: 40 };
    expect(payrollLine({ ...terms, kpi: kpi(85) }, typed).kpiCut).toBe(0);
    expect(payrollLine({ ...terms, kpi: null }, typed).kpiCut).toBe(0);
  });

  it('works a line made before the KPIs module out as it was: its KPI inputs averaged with the attendance', () => {
    // (1 + 0.4) / 2 = 0.7, below 80%: 30% of the variable cut; with the rules of then (no kpiIncludesAttendance: 25 October 2026)
    const { kpiIncludesAttendance: _, ...then } = PAYROLL_RULE_DEFAULTS;
    const old = payrollLine(terms, { ...EMPTY_PAYROLL_INPUTS, performance: 40 }, then);
    expect(old.kpiScore).toBe(0.7);
    expect(old.kpiCut).toBe(720);
    expect(payrollLine(terms, EMPTY_PAYROLL_INPUTS).kpiCut).toBe(0);
  });

  it('never cuts pay by the hour for the KPI', () => {
    const hourly = payrollLine({ ...terms, payBasis: 'hourly', hourlyRate: 100, kpi: kpi(40) }, { ...EMPTY_PAYROLL_INPUTS, workedHours: 10 });
    expect(hourly.kpiCut).toBe(0);
    expect(hourly.kpiScore).toBe(1);
  });

  it('says the line’s KPI in words', () => {
    expect(kpiPayText('2026-09', kpi(86), 80)).toBe('KPI (September 2026): 86% · Needs improvement · paid in full (80%+)');
    expect(kpiPayText('2026-09', kpi(70), 80)).toBe('KPI (September 2026): 70% · Needs improvement · variable paid at 70%');
    expect(kpiPayText('2026-09', null, 80)).toBe('KPI (September 2026): no final scorecard · not cut');
  });
});
