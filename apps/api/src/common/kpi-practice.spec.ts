import {
  KPI_NO_PRACTICE_STEPS,
  KPI_PRACTICE_STEP_FOR,
  KPI_PRACTICE_STEPS,
  isKpiPracticeStep,
  kpiAttendanceSoFar,
  kpiDeadlinePassed,
  kpiFirstName,
  kpiPracticeMonthProblem,
  kpiPracticeMonths,
  kpiPracticeStepLabel,
  kpiPracticeSteps,
  kpiScorerWords,
  kpiStandInWho,
  kpiStandsIn,
  kpiStoodInText,
  startsKpiPractice,
} from '@trendlix/shared';

// Practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and
// Admin.. how?", "Practice scorecards"; packages/shared kpi-practice.ts): who starts them and stands in on them, the
// steps open without dates, the deadline bypass, the months offered, and their words. Invented names.

describe('practice KPI scorecards', () => {
  const STARTER = 'u-starter';

  it('are started by HR and a Super Admin only', () => {
    expect(startsKpiPractice({ roles: ['hr'] })).toBe(true);
    expect(startsKpiPractice({ roles: ['super_admin'] })).toBe(true);
    for (const roles of [['employee'], ['manager'], ['admin'], ['finance']]) expect(startsKpiPractice({ roles })).toBe(false);
    // the CEO too (owner, 25 October 2026: "Yes, the CEO too")
    expect(startsKpiPractice({ roles: ['ceo'] })).toBe(true);
  });

  it('are stood in on by their starter or any Super Admin, in their own session, and a real one never', () => {
    const card = { practice: true, practiceById: STARTER };
    expect(kpiStandsIn(card, { userId: STARTER, roles: ['hr'], viewingAs: false })).toBe(true);
    expect(kpiStandsIn(card, { userId: 'u-other-sa', roles: ['super_admin'], viewingAs: false })).toBe(true);
    // another HR person sees it, but doesn't take its steps
    expect(kpiStandsIn(card, { userId: 'u-other-hr', roles: ['hr'], viewingAs: false })).toBe(false);
    // viewing as someone, the Super Admin takes the steps as them instead
    expect(kpiStandsIn(card, { userId: 'u-viewed', roles: ['super_admin'], viewingAs: true })).toBe(false);
    expect(kpiStandsIn({ practice: false, practiceById: null }, { userId: STARTER, roles: ['super_admin'], viewingAs: false })).toBe(false);
    // its starter deleted since: a Super Admin still does
    expect(kpiStandsIn({ practice: true, practiceById: null }, { userId: STARTER, roles: ['hr'], viewingAs: false })).toBe(false);
  });

  it('open each step by where the scorecard stands alone, the scoring with the self-rating still open', () => {
    expect(kpiPracticeSteps({ status: 'self_rating' })).toEqual({ ...KPI_NO_PRACTICE_STEPS, self_rate: true, score: true });
    expect(kpiPracticeSteps({ status: 'manager' })).toEqual({ ...KPI_NO_PRACTICE_STEPS, score: true });
    expect(kpiPracticeSteps({ status: 'hr' })).toEqual({ ...KPI_NO_PRACTICE_STEPS, calibrate: true });
    expect(kpiPracticeSteps({ status: 'sign_off' })).toEqual({ ...KPI_NO_PRACTICE_STEPS, sign_employee: true, sign_manager: true });
    expect(kpiPracticeSteps({ status: 'sign_off', employeeSignedAt: new Date() })).toEqual({ ...KPI_NO_PRACTICE_STEPS, sign_manager: true });
    expect(kpiPracticeSteps({ status: 'sign_off', managerSignedAt: '2026-10-22T10:00:00Z' })).toEqual({ ...KPI_NO_PRACTICE_STEPS, sign_employee: true });
    expect(kpiPracticeSteps({ status: 'final', employeeSignedAt: new Date(), managerSignedAt: new Date() })).toEqual(KPI_NO_PRACTICE_STEPS);
    expect(KPI_PRACTICE_STEPS.every((s) => isKpiPracticeStep(s))).toBe(true);
    expect(isKpiPracticeStep('sign')).toBe(false);
    expect(KPI_PRACTICE_STEP_FOR).toEqual({ self_rate: 'employee', score: 'scorer', calibrate: 'hr', sign_employee: 'employee', sign_manager: 'scorer' });
  });

  it('are never held back by a deadline; a real one is until its day has gone by', () => {
    // the self-rating due by 3 November, on 22 October
    expect(kpiDeadlinePassed(true, '2026-11-03', '2026-10-22')).toBe(true);
    expect(kpiDeadlinePassed(false, '2026-11-03', '2026-10-22')).toBe(false);
    // "by the 3rd" holds all through the 3rd
    expect(kpiDeadlinePassed(false, '2026-11-03', '2026-11-03')).toBe(false);
    expect(kpiDeadlinePassed(false, '2026-11-03', '2026-11-04')).toBe(true);
  });

  it('may be for any month from the join month to this one, newest first', () => {
    expect(kpiPracticeMonths('2026-08-17', '2026-10-22')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(kpiPracticeMonths('2025-12-01', '2026-02-05')).toEqual(['2026-02', '2026-01', '2025-12']);
    // joining next month: none yet
    expect(kpiPracticeMonths('2026-11-01', '2026-10-22')).toEqual([]);
    // at most 24 offered
    expect(kpiPracticeMonths('2015-01-01', '2026-10-22')).toHaveLength(24);
    expect(kpiPracticeMonths('2015-01-01', '2026-10-22').at(-1)).toBe('2024-11');

    expect(kpiPracticeMonthProblem('2026-10', '2026-08-17', '2026-10-22')).toBeNull();
    expect(kpiPracticeMonthProblem('2026-08', '2026-08-17', '2026-10-22')).toBeNull();
    expect(kpiPracticeMonthProblem('2026-11', '2026-08-17', '2026-10-22')).toBe('Choose October 2026 or an earlier month: a practice scorecard is for a month that has begun.');
    expect(kpiPracticeMonthProblem('2026-07', '2026-08-17', '2026-10-22', 'Omar Ali')).toBe('Omar Ali joined in August 2026: choose that month or a later one.');
    // older than the 24 offered is still allowed
    expect(kpiPracticeMonthProblem('2016-03', '2015-01-01', '2026-10-22')).toBeNull();

    expect(kpiAttendanceSoFar('2026-10', '2026-10-22')).toBe(true);
    expect(kpiAttendanceSoFar('2026-09', '2026-10-22')).toBe(false);
  });

  it('name each step-in and whom it was taken for', () => {
    const card = { employeeName: 'Omar Ali Hassan', scorer: 'manager' };
    expect(KPI_PRACTICE_STEPS.map((s) => kpiPracticeStepLabel(s, card))).toEqual([
      'Rate as Omar (practice)',
      'Score as the manager',
      'Calibrate as HR',
      'Sign as Omar',
      'Sign as the manager',
    ]);
    expect(kpiPracticeStepLabel('score', { employeeName: 'Clara', scorer: 'ceo' })).toBe('Score as the CEO');
    expect(kpiPracticeStepLabel('sign_manager', { employeeName: 'Omar', scorer: 'hr' })).toBe('Sign as HR');
    expect(kpiScorerWords('super_admin')).toBe('a Super Admin');
    expect(kpiFirstName('  Nora   Teamed ')).toBe('Nora');

    expect(kpiStandInWho('employee', card)).toBe('Omar Ali Hassan');
    expect(kpiStandInWho('scorer', card)).toBe('the manager');
    expect(kpiStandInWho('hr', card)).toBe('HR');
    expect(kpiStoodInText('Hazem Magdy', 'scorer', card)).toBe('Hazem Magdy for the manager');
    expect(kpiStoodInText('Hazem Magdy', 'employee', card)).toBe('Hazem Magdy for Omar Ali Hassan');
  });
});
