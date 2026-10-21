import { describe, expect, it } from 'vitest';
import { KPI_PILLARS, type KpiScorecardMetric, type KpiScorecardSummary, type KpiScorecardView } from '@trendlix/shared';
import {
  actionButton,
  actionText,
  allKpisHref,
  attendanceText,
  averageChangeText,
  calibrateBody,
  calibrationMetrics,
  COMMENT_FIELD,
  doneText,
  formMetrics,
  isChange,
  kpiExcelHref,
  kpiExcelName,
  liveScore,
  NOTE_FIELD,
  openedText,
  othersWaiting,
  ownCardText,
  ownWaiting,
  payrollText,
  percentText,
  PICK_FIELD,
  pickText,
  picksBody,
  readDepartment,
  readMonth,
  readStatus,
  REASON_FIELD,
  scorecardBack,
  scorecardDoneHref,
  scorerText,
  sheetMode,
  signBody,
  startingComment,
  startingNotes,
  startingPicks,
  statusText,
  stepDeadlineText,
  stepTone,
  SUBMIT_FIELD,
  targetIndex,
  teamWaiting,
  unpicked,
  waitingLine,
} from './scorecard';

// A KPI scorecard as the pages word it and read its forms (owner, 21 October 2026: "Full framework per role"; "Self,
// manager, HR, sign-off"; "Attendance: Yes, as the sheet"; "Last month's KPI, this pay"). Every person here is invented.

const ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const MONA = { id: 'e-mona', employeeCode: 'EMP-0042', fullNameEn: 'Mona Adel' };

const metric = (id: string, pillar: 1 | 2 | 3 | 4, name: string, targetPoints: number, criteria: [string, number][], picks: Partial<KpiScorecardMetric> = {}): KpiScorecardMetric => ({
  id,
  pillar,
  name,
  definition: null,
  howMeasured: null,
  jdDuty: null,
  targetPoints,
  criteria: criteria.map(([label, points]) => ({ label, points })),
  self: null,
  manager: null,
  hr: null,
  points: null,
  ...picks,
});

const delivery = metric('m1', 1, 'Sprint tasks on time', 35, [['95–100%', 35], ['85–94%', 25], ['Below 85%', 10]], {
  self: { choice: 0, comment: 'Every sprint closed' },
  manager: { choice: 1, comment: null },
});
const quality = metric('m2', 2, 'Reopened bugs', 35, [['0', 35], ['1–2', 25], ['3 or more', 10]], { self: { choice: 0, comment: null }, manager: { choice: 0, comment: null } });
const clients = metric('m3', 3, 'PM feedback', 30, [['4.5 – 5', 30], ['4.0 – 4.4', 20], ['Below 4', 10], ['Beyond', 40]], { manager: { choice: 1, comment: null } });
const growth = metric('m4', 4, 'Development plan', 25, [['2 courses', 25], ['1 course', 20], ['None', 0]]);

const pillar = (id: 1 | 2 | 3 | 4, metrics: KpiScorecardMetric[]) => ({ ...KPI_PILLARS[id - 1], metrics, achieved: 0, max: 0, percent: 0, complete: false });

const summary = (over: Partial<KpiScorecardSummary> = {}): KpiScorecardSummary => ({
  id: ID,
  month: '2026-10',
  employee: MONA,
  jobTitle: 'Senior Frontend Developer',
  department: 'Frontend · Web Development',
  departmentId: 'd1',
  status: 'manager',
  templateVersion: 2,
  scorer: { kind: 'manager', name: 'Sara Ali' },
  finalPercent: null,
  level: null,
  selfMissed: false,
  calibrated: 0,
  signed: { employee: false, manager: false },
  unsigned: false,
  action: null,
  deadline: '2026-11-06',
  confidential: false,
  ...over,
});

const view = (over: Partial<KpiScorecardView> = {}): KpiScorecardView => ({
  ...summary(),
  template: { id: 't1', version: 2, jobTitleId: 'j1' },
  pillars: [pillar(1, [delivery]), pillar(2, [quality]), pillar(3, [clients]), pillar(4, [growth])],
  attendance: { points: 25, achieved: 24, ratio: 0.96, score: 0.96, source: 'payroll' },
  score: null,
  selfScore: null,
  comments: { self: 'A good month', manager: 'Keep it up', hr: null, employeeSign: null, managerSign: null },
  steps: [],
  deadlines: { selfRating: '2026-11-03', manager: '2026-11-06', hr: '2026-11-08', signOff: '2026-11-10' },
  can: { selfRate: false, score: false, calibrate: false, signAsEmployee: false, signAsManager: false },
  payrollMonth: '2026-11',
  ...over,
});

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe('where a scorecard stands', () => {
  it('names the scoring step by who scores it', () => {
    expect(statusText('manager', 'manager')).toBe('With the manager');
    expect(statusText('manager', 'hr')).toBe('With HR');
    expect(statusText('manager', 'ceo')).toBe('With the CEO');
    expect(statusText('manager', 'super_admin')).toBe('With a Super Admin');
    expect(statusText('hr', 'manager')).toBe('With HR');
    expect(statusText('self_rating', 'ceo')).toBe('Self-rating');
    expect(statusText('final', 'manager')).toBe('Final');
  });

  it('says who scores it', () => {
    expect(scorerText({ kind: 'manager', name: 'Sara Ali' })).toBe('Sara Ali (manager)');
    expect(scorerText({ kind: 'manager', name: null })).toBe('The manager');
    expect(scorerText({ kind: 'hr', name: null })).toBe('HR: nobody is in charge of this person');
    expect(scorerText({ kind: 'ceo', name: 'Omar Nabil' })).toBe('Omar Nabil (the CEO)');
    expect(scorerText({ kind: 'super_admin', name: null })).toBe('A Super Admin');
  });

  it('writes a percent, or a dash for none', () => {
    expect(percentText(86)).toBe('86%');
    expect(percentText(89.64)).toBe('89.6%');
    expect(percentText(null)).toBe('—');
  });

  it('says the step it is at and by when, and the payroll it counts in', () => {
    expect(stepDeadlineText(view({ status: 'self_rating' }))).toBe('Self-rating by 03/11/2026');
    expect(stepDeadlineText(view({ status: 'manager' }))).toBe('Scoring by 06/11/2026');
    expect(stepDeadlineText(view({ status: 'hr' }))).toBe("HR's calibration by 08/11/2026");
    expect(stepDeadlineText(view({ status: 'sign_off' }))).toMatch(/^Sign-off by 10\/11\/2026/);
    expect(stepDeadlineText(view({ status: 'final' }))).toBeNull();
    expect(payrollText('2026-11')).toBe('Counts in the November 2026 payroll');
  });

  it('marks a missed self-rating, a calibration and a final without signatures in amber', () => {
    expect(stepTone('self_missed')).toBe('warn');
    expect(stepTone('calibrated')).toBe('warn');
    expect(stepTone('final_unsigned')).toBe('warn');
    expect(stepTone('scored')).toBe('ok');
    expect(stepTone('opened')).toBe('none');
  });
});

describe('what waits, and for whom', () => {
  const own = summary({ id: 'own', employee: { ...MONA, id: 'e-me' }, action: 'self_rate', status: 'self_rating', deadline: '2026-11-03' });
  const toScore = summary({ id: 'score', action: 'score' });
  const toSign = summary({ id: 'sign', action: 'sign', status: 'sign_off', deadline: '2026-11-10' });
  const toCalibrate = summary({ id: 'cal', action: 'calibrate', status: 'hr', deadline: '2026-11-08' });
  const nothing = summary({ id: 'none', action: null });
  const list = [own, toScore, toSign, toCalibrate, nothing];

  it('splits the caller’s own from other people’s', () => {
    expect(ownWaiting(list, 'e-me').map((s) => s.id)).toEqual(['own']);
    expect(othersWaiting(list, 'e-me').map((s) => s.id)).toEqual(['score', 'sign', 'cal']);
    // no employee profile: nothing is their own
    expect(ownWaiting(list, null)).toEqual([]);
    expect(teamWaiting(list, 'e-me').map((s) => s.id)).toEqual(['score', 'sign']);
  });

  it('says what to do and by when', () => {
    expect(actionText(toScore)).toBe('Score by 06/11/2026');
    expect(actionText(own)).toBe('Rate yourself by 03/11/2026');
    expect(actionText(toSign)).toBe('Sign by 10/11/2026');
    expect(actionText(toCalibrate)).toBe('Calibrate by 08/11/2026');
    expect(actionText(nothing)).toBeNull();
    // the scorer may start while the self-rating is open
    expect(actionText(summary({ action: 'score', status: 'self_rating', deadline: '2026-11-03' }))).toBe('Self-rating due 03/11/2026, then score');
    expect(actionButton(toScore)).toBe('Score');
    expect(actionButton(nothing)).toBe('Open');
  });

  it('words the employee’s own card and To Approve’s line', () => {
    expect(ownCardText(own)).toBe('Your October 2026 KPI: rate yourself by 03/11/2026');
    expect(ownCardText({ ...toSign, action: 'sign' })).toBe('Your October 2026 KPI: ready to sign by 10/11/2026');
    expect(waitingLine(toScore)).toBe('October 2026 · Score by 06/11/2026');
    expect(waitingLine(nothing)).toBe('October 2026');
  });

  it('goes back to My KPIs, All KPIs or Team KPIs', () => {
    expect(scorecardBack({ roles: ['employee'], employeeId: 'e-mona' }, summary())).toEqual({ href: '/kpis', label: 'My KPIs' });
    expect(scorecardBack({ roles: ['hr'], employeeId: 'e-hr' }, summary())).toEqual({ href: '/kpis/all', label: 'All KPIs' });
    expect(scorecardBack({ roles: ['super_admin'], employeeId: null }, summary())).toEqual({ href: '/kpis/all', label: 'All KPIs' });
    expect(scorecardBack({ roles: ['manager'], employeeId: 'e-sara' }, summary())).toEqual({ href: '/kpis/team', label: 'Team KPIs' });
  });
});

describe('the automatic Attendance metric', () => {
  it('says where it was read and the month’s hours', () => {
    expect(attendanceText({ ratio: 0.96, score: 0.96, source: 'payroll' })).toEqual({
      source: "From the month's payroll line",
      detail: 'Worked 96% of the expected hours, attendance score 96%.',
    });
    expect(attendanceText({ ratio: 0.97, score: 1, source: 'attendance' }).detail).toBe('Worked 97% of the expected hours, attendance score 100%.');
    expect(attendanceText({ ratio: null, score: null, source: 'none' })).toEqual({
      source: 'Not counted: full points',
      detail: "Attendance isn't counted for this month, so it counts as full.",
    });
  });
});

describe('the picks a form starts from, and the live score', () => {
  it('gives the caller the form of their step', () => {
    expect(sheetMode({ selfRate: true, score: false, calibrate: false })).toBe('self');
    expect(sheetMode({ selfRate: false, score: true, calibrate: false })).toBe('score');
    expect(sheetMode({ selfRate: false, score: false, calibrate: true })).toBe('calibrate');
    expect(sheetMode({ selfRate: false, score: false, calibrate: false })).toBe('view');
  });

  it('starts from the caller’s own picks, HR from the manager’s', () => {
    const v = view();
    expect(startingPicks(v, 'self')).toEqual({ m1: 0, m2: 0, m3: null, m4: null });
    expect(startingPicks(v, 'score')).toEqual({ m1: 1, m2: 0, m3: 1, m4: null });
    expect(startingPicks(v, 'calibrate')).toEqual({ m1: 1, m2: 0, m3: 1, m4: null });
    expect(startingNotes(v, 'self')).toEqual({ m1: 'Every sprint closed', m2: '', m3: '', m4: '' });
    expect(startingComment(v, 'self')).toBe('A good month');
    expect(startingComment(v, 'score')).toBe('Keep it up');
    expect(startingComment(v, 'calibrate')).toBe('');
  });

  it('leaves out a pick that isn’t one of the metric’s criteria', () => {
    const v = view({ pillars: [pillar(1, [{ ...delivery, manager: { choice: 7, comment: null } }]), pillar(2, []), pillar(3, []), pillar(4, [])] });
    expect(startingPicks(v, 'score')).toEqual({ m1: null });
  });

  it('works the score out as the picks change, with the Attendance metric’s points', () => {
    const v = view();
    const none = liveScore(v, {});
    expect(none.complete).toBe(false);
    // Discipline & Growth: 24 of 25 attendance points + 0 of 25 for the plan = 48%
    expect(none.pillars[3]).toMatchObject({ achieved: 24, max: 50, percent: 48 });
    const all = liveScore(v, { m1: 0, m2: 0, m3: 0, m4: 0 });
    expect(all.complete).toBe(true);
    // 30 + 25 + 25 + 20 × 49/50
    expect(all.finalPercent).toBe(99.6);
    expect(all.level).toBe('meets');
    // a criterion worth more than its target
    expect(liveScore(v, { m1: 0, m2: 0, m3: 3, m4: 0 }).level).toBe('above');
    expect(unpicked([delivery, quality, clients, growth], { m1: 0, m3: 2 })).toEqual(['Reopened bugs', 'Development plan']);
  });

  it('marks the target and words a pick', () => {
    expect(targetIndex(clients)).toBe(0);
    expect(targetIndex({ targetPoints: 33, criteria: [{ label: 'a', points: 30 }] })).toBe(-1);
    expect(pickText(delivery, 1)).toBe('85–94% · 25 pts');
    expect(pickText(delivery, null)).toBeNull();
  });
});

describe('what the forms send', () => {
  const metrics = formMetrics(view());

  it('saves the self-rating or the scoring as far as it is picked', () => {
    const { body, errors } = picksBody(form({ [PICK_FIELD('m1')]: '0', [NOTE_FIELD('m1')]: '  On time  ', [SUBMIT_FIELD]: '0', [COMMENT_FIELD]: '' }), metrics);
    expect(errors).toEqual([]);
    expect(body).toEqual({
      picks: [
        { metricId: 'm1', choice: 0, comment: 'On time' },
        { metricId: 'm2', choice: null, comment: null },
        { metricId: 'm3', choice: null, comment: null },
        { metricId: 'm4', choice: null, comment: null },
      ],
      comment: null,
      submit: false,
    });
  });

  it('sends it only with every metric picked', () => {
    const some = picksBody(form({ [PICK_FIELD('m1')]: '0', [PICK_FIELD('m2')]: '9', [SUBMIT_FIELD]: '1' }), metrics);
    expect(some.body).toBeNull();
    // a criterion that isn't one of the metric's counts as not picked
    expect(some.errors).toEqual(['Pick a criterion for every metric before sending: Reopened bugs, PM feedback, Development plan.']);
    const all = picksBody(form({ [PICK_FIELD('m1')]: '0', [PICK_FIELD('m2')]: '1', [PICK_FIELD('m3')]: '3', [PICK_FIELD('m4')]: '2', [SUBMIT_FIELD]: '1', [COMMENT_FIELD]: 'Good' }), metrics);
    expect(all.errors).toEqual([]);
    expect(all.body?.submit).toBe(true);
    expect(all.body?.comment).toBe('Good');
    expect(all.body?.picks.map((p) => p.choice)).toEqual([0, 1, 3, 2]);
  });

  it('refuses a comment past the limit', () => {
    expect(picksBody(form({ [NOTE_FIELD('m2')]: 'x'.repeat(1001) }), metrics).errors).toEqual(['The comment on Reopened bugs can be at most 1000 characters.']);
    expect(signBody(form({ [COMMENT_FIELD]: 'x'.repeat(1001) })).errors).toEqual(['Your comment can be at most 1000 characters.']);
  });

  it('calibrates with only the picks changed from the manager’s, each with its reason', () => {
    const cal = calibrationMetrics(view());
    expect(cal.map((m) => m.manager)).toEqual([1, 0, 1, null]);
    expect(isChange(1, 1)).toBe(false);
    expect(isChange(1, 0)).toBe(true);
    expect(isChange(null, null)).toBe(false);
    // m1 as the manager's, m3 changed with a reason, m4 picked where the manager picked none (a change too)
    const fd = form({
      [PICK_FIELD('m1')]: '1',
      [PICK_FIELD('m2')]: '0',
      [PICK_FIELD('m3')]: '0',
      [REASON_FIELD('m3')]: 'Client survey came in at 4.6',
      [PICK_FIELD('m4')]: '1',
      [REASON_FIELD('m4')]: 'One course certificate uploaded',
      [COMMENT_FIELD]: ' ',
    });
    expect(calibrateBody(fd, cal)).toEqual({
      body: {
        changes: [
          { metricId: 'm3', choice: 0, reason: 'Client survey came in at 4.6' },
          { metricId: 'm4', choice: 1, reason: 'One course certificate uploaded' },
        ],
        comment: null,
      },
      errors: [],
    });
  });

  it('needs the reason for every change', () => {
    const { body, errors } = calibrateBody(form({ [PICK_FIELD('m1')]: '2', [REASON_FIELD('m1')]: '  ' }), calibrationMetrics(view()));
    expect(body).toBeNull();
    expect(errors).toEqual(["Give the reason for changing the manager's pick on Sprint tasks on time."]);
  });

  it('takes the scoring as it is when nothing changed', () => {
    expect(calibrateBody(form({ [PICK_FIELD('m1')]: '1', [COMMENT_FIELD]: 'Fair' }), calibrationMetrics(view())).body).toEqual({ changes: [], comment: 'Fair' });
  });

  it('signs with an optional comment', () => {
    expect(signBody(form({}))).toEqual({ body: { comment: null }, errors: [] });
    expect(signBody(form({ [COMMENT_FIELD]: ' Thanks ' })).body).toEqual({ comment: 'Thanks' });
  });
});

describe('once something is done', () => {
  it('says what was done, on the scorecard’s page', () => {
    expect(scorecardDoneHref(ID, 'self_sent')).toBe(`/kpis/scorecards/${ID}?done=self_sent`);
    const v = view();
    expect(doneText({ done: 'self_saved' }, v)?.text).toBe('Your self-rating is saved, not sent yet. Send it by 03/11/2026.');
    expect(doneText({ done: 'self_sent' }, v)?.text).toMatch(/^Your self-rating is sent\. Your manager scores the month next/);
    expect(doneText({ done: 'self_sent' }, view({ scorer: { kind: 'ceo', name: null } }))?.text).toMatch(/The CEO scores the month next/);
    expect(doneText({ done: 'score_saved' }, v)?.text).toBe('Your scoring is saved, not sent yet. Send it by 06/11/2026.');
    expect(doneText({ done: 'score_sent' }, view({ status: 'hr' }))?.text).toBe('Your scoring is sent to HR to calibrate.');
    expect(doneText({ done: 'score_sent' }, view({ status: 'sign_off' }))?.text).toMatch(/ready for the employee and the manager to sign/);
    expect(doneText({ done: 'calibrated' }, v)?.text).toMatch(/^Calibrated and sent for sign-off/);
    expect(doneText({ done: 'signed' }, view({ status: 'final' }))?.text).toBe('Signed. The scorecard is final.');
    expect(doneText({ done: 'signed' }, view({ status: 'sign_off' }))?.text).toBe('Signed. It is final once both have signed, or after 10/11/2026 anyway.');
    expect(doneText({ done: 'moved' }, v)).toEqual({ text: expect.stringMatching(/moved on/), tone: 'warn' });
    expect(doneText({ done: 'other' }, v)).toBeNull();
    expect(doneText({}, v)).toBeNull();
  });
});

describe('All KPIs', () => {
  it('compares the average with the month before', () => {
    expect(averageChangeText(88.6, 86.8, '2026-10')).toBe('+1.8 pts vs September 2026');
    expect(averageChangeText(85, 87.5, '2026-10')).toBe('−2.5 pts vs September 2026');
    expect(averageChangeText(85, 85, '2026-01')).toBe('Same as December 2025');
    expect(averageChangeText(85, null, '2026-10')).toBe('None scored in September 2026 to compare');
    expect(averageChangeText(null, 80, '2026-10')).toBeNull();
  });

  it('says what opening the month did', () => {
    expect(openedText({ month: '2026-09', opened: 12 })).toBe('12 scorecards opened for September 2026. Each person is told to rate themself.');
    expect(openedText({ month: '2026-09', opened: 1 })).toMatch(/^1 scorecard opened/);
    expect(openedText({ month: '2026-09', opened: 0 })).toMatch(/^No new scorecards for September 2026/);
  });

  it('reads the month and the filters from the address, only when they are one', () => {
    expect(readMonth({ month: '2026-10' })).toBe('2026-10');
    expect(readMonth({ month: '2026-13' })).toBeNull();
    expect(readMonth({ month: ['2026-10'] })).toBeNull();
    expect(readStatus({ status: 'sign_off' })).toBe('sign_off');
    expect(readStatus({ status: 'approved' })).toBeNull();
    expect(readDepartment({ department: ID })).toBe(ID);
    expect(readDepartment({ department: 'web' })).toBeNull();
  });

  it('keeps the month and filters in the address, and names the workbook', () => {
    expect(allKpisHref({})).toBe('/kpis/all');
    expect(allKpisHref({ month: '2026-10', status: 'hr', department: ID })).toBe(`/kpis/all?month=2026-10&status=hr&department=${ID}`);
    expect(kpiExcelHref('2026-10')).toBe('/kpis/all/excel?month=2026-10');
    expect(kpiExcelName('2026-10')).toBe('KPIs October 2026.xlsx');
  });
});
