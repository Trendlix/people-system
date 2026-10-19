import { Prisma } from '../generated/prisma/client.js';
import { raiseChangeOf, raiseRequestView, suggestionView, type RequestRow } from './raise-requests.service.js';
import { stepFigures, stepView, typedFigure, type StepRow } from './raise-request-steps.js';

// The log of a raise request and what each viewer sees of it (owner, 17 October 2026: "all the request steps to be
// logged in the request"; "Keep salaries private", 16 October 2026): HR, Finance and the CEO everything; the employee
// their own suggestion, the decisions and comments, and their new salary once signed; the manager the reason, the
// comments and the decisions, never a figure but the percent they suggested themself.

const d = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));
const at = new Date('2026-10-17T08:00:00.000Z');

function step(id: number, kind: string, over: Partial<StepRow> = {}): StepRow {
  return {
    id: BigInt(id),
    requestId: 'q1',
    kind,
    decision: null,
    raiseReason: null,
    raiseReasonFrom: null,
    comment: null,
    figure: null,
    increaseAmount: null,
    increasePercent: null,
    gross: null,
    way: null,
    effectiveDate: null,
    contractNumber: null,
    actorId: 'u1',
    actor: { email: 'someone@trendlix.com' },
    at,
    ...over,
  };
}

/** A request's whole log, done: the employee asked +1,500 on 10,000; HR approved +10%; the CEO approved +12%; signed. */
const log: StepRow[] = [
  step(1, 'submitted', { raiseReason: 'performance', comment: 'Led the audit', figure: 'amount', increaseAmount: d(1500), increasePercent: d(15), gross: d(11500) }),
  step(2, 'hr_decision', { decision: 'approve_other', comment: 'Within the band', figure: 'percent', increaseAmount: d(1000), increasePercent: d(10), gross: d(11000) }),
  step(3, 'prepared', { way: 'amendment', effectiveDate: new Date('2026-11-01T00:00:00Z'), contractNumber: 'CON-2026-0001-A1' }),
  step(4, 'sent', { gross: d(11000), comment: 'For the November payroll' }),
  step(5, 'returned', { comment: 'Make it 12% instead' }),
  step(6, 'ceo_decision', { decision: 'approve_other', comment: 'Well earned', figure: 'percent', increaseAmount: d(1200), increasePercent: d(12), gross: d(11200) }),
  step(7, 'signed', { gross: d(11200), effectiveDate: new Date('2026-11-01T00:00:00Z'), contractNumber: 'CON-2026-0001-A1' }),
];

const figures = (v: ReturnType<typeof stepView>) => [v.figure, v.increaseAmount, v.increasePercent, v.gross];

describe('the figures a step is logged with', () => {
  it('the one typed as typed, the other worked out; without one typed, both worked out', () => {
    expect(stepFigures(10000, 11500, { kind: 'amount', value: 1500 })).toEqual({ figure: 'amount', increaseAmount: 1500, increasePercent: 15, gross: 11500 });
    expect(stepFigures(12345.67, 13271.6, { kind: 'percent', value: 7.5 })).toEqual({ figure: 'percent', increaseAmount: 925.93, increasePercent: 7.5, gross: 13271.6 });
    expect(stepFigures(10000, 11200, null)).toEqual({ figure: null, increaseAmount: 1200, increasePercent: 12, gross: 11200 });
    // no signed contract yet: what was typed only
    expect(stepFigures(null, null, { kind: 'percent', value: 5 })).toEqual({ figure: 'percent', increaseAmount: null, increasePercent: 5, gross: null });
  });

  it('a raise is an amount or a percent, not both', () => {
    expect(typedFigure(1500, undefined)).toEqual({ kind: 'amount', value: 1500 });
    expect(typedFigure(null, 7.5)).toEqual({ kind: 'percent', value: 7.5 });
    expect(typedFigure(undefined, null)).toBeNull();
    expect(() => typedFigure(1500, 10)).toThrow('Give the raise as an amount or a percent, not both.');
  });
});

describe('a step as each viewer sees it', () => {
  it('HR, Finance and the CEO: everything, in order', () => {
    const views = log.map((s) => stepView(s, 'full', { mine: false, done: true }));
    expect(views.map((v) => [v.id, v.kind, v.decision])).toEqual([
      ['1', 'submitted', null],
      ['2', 'hr_decision', 'approve_other'],
      ['3', 'prepared', null],
      ['4', 'sent', null],
      ['5', 'returned', null],
      ['6', 'ceo_decision', 'approve_other'],
      ['7', 'signed', null],
    ]);
    expect(figures(views[1])).toEqual(['percent', 1000, 10, 11000]);
    expect(views[2]).toMatchObject({ way: 'amendment', effectiveDate: '2026-11-01', contractNumber: 'CON-2026-0001-A1' });
    expect(views.map((v) => v.comment)).toEqual(['Led the audit', 'Within the band', null, 'For the November payroll', 'Make it 12% instead', 'Well earned', null]);
    expect(views[0]).toMatchObject({ by: { email: 'someone@trendlix.com' }, at, figuresHidden: false, raiseReason: 'performance' });
  });

  it('the employee, on their own request: their suggestion as typed, the decisions and comments, no figure of HR’s or the CEO’s', () => {
    const views = log.map((s) => stepView(s, 'self', { mine: true, done: false }));
    expect(figures(views[0])).toEqual(['amount', 1500, null, null]);
    for (const v of views.slice(1)) expect(figures(v)).toEqual([null, null, null, null]);
    expect(views.map((v) => v.decision)).toEqual([null, 'approve_other', null, null, null, 'approve_other', null]);
    // the comments HR and the CEO exchange stay between them
    expect(views.map((v) => v.comment)).toEqual(['Led the audit', 'Within the band', null, null, null, 'Well earned', null]);
    // the way, not the date, before the signing
    expect(views[2]).toMatchObject({ way: 'amendment', effectiveDate: null, contractNumber: 'CON-2026-0001-A1', figuresHidden: true });
  });

  it('the employee, once signed: their new salary and the date, on the signing only', () => {
    const views = log.map((s) => stepView(s, 'self', { mine: true, done: true }));
    expect(figures(views[6])).toEqual([null, null, null, 11200]);
    expect(views[6].effectiveDate).toBe('2026-11-01');
    expect(figures(views[5])).toEqual([null, null, null, null]);
    // a percent they suggested: the percent only, never the amount it comes to
    const percent = stepView(step(1, 'submitted', { figure: 'percent', increaseAmount: d(800), increasePercent: d(8), gross: d(10800) }), 'self', { mine: true, done: true });
    expect(figures(percent)).toEqual(['percent', null, 8, null]);
    // a gross they typed before 17 October 2026
    expect(figures(stepView(step(1, 'submitted', { gross: d(12000) }), 'self', { mine: true, done: false }))).toEqual([null, null, null, 12000]);
  });

  it('the manager: the reason, comments and decisions, never a figure, but the percent they suggested themself', () => {
    const views = log.map((s) => stepView(s, 'manager', { mine: false, done: true }));
    for (const v of views) expect(figures(v)).toEqual([null, null, null, null]);
    expect(views[0]).toMatchObject({ raiseReason: 'performance', comment: 'Led the audit' });
    expect(views[2].effectiveDate).toBe('2026-11-01'); // once signed, the date
    expect(views[4].comment).toBeNull();
    const own = step(1, 'submitted', { figure: 'percent', increaseAmount: d(800), increasePercent: d(8), gross: d(10800) });
    expect(figures(stepView(own, 'manager', { mine: true, done: false }))).toEqual(['percent', null, 8, null]);
    expect(figures(stepView(own, 'manager', { mine: false, done: false }))).toEqual([null, null, null, null]);
  });
});

describe('Effective from, on the log (owner, 17 October 2026: "in the request their should be a tab called Effective from")', () => {
  const asked = step(1, 'submitted', { raiseReason: 'annual', comment: 'A year with us', effectiveDate: new Date('2026-12-01T00:00:00Z') });
  const decided = step(2, 'hr_decision', { decision: 'approve', comment: 'Yes', effectiveDate: new Date('2027-01-01T00:00:00Z') });

  it('the month asked from, on the submitted step, for everyone who sees the request: a date, not a figure', () => {
    for (const viewer of ['full', 'self', 'manager'] as const) {
      for (const mine of [true, false]) expect(stepView(asked, viewer, { mine, done: false }).effectiveDate).toBe('2026-12-01');
    }
  });

  it('the date HR chose, on HR’s step: the raise’s, so HR, Finance and the CEO’s until it is signed', () => {
    expect(stepView(decided, 'full', { mine: false, done: false }).effectiveDate).toBe('2027-01-01');
    for (const viewer of ['self', 'manager'] as const) {
      expect(stepView(decided, viewer, { mine: true, done: false }).effectiveDate).toBeNull();
      expect(stepView(decided, viewer, { mine: true, done: true }).effectiveDate).toBe('2027-01-01');
    }
  });
});

/** A request as the database has it, done, with the log above. */
function request(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'q1',
    employeeId: 'e1',
    employmentId: 'm1',
    requestedById: 'ben',
    requester: 'self',
    origin: 'request',
    raiseReason: 'performance',
    comment: 'Led the audit',
    suggestedIncrease: d(1500),
    suggestedPercent: null,
    suggestedGross: d(11500),
    effectiveFrom: null,
    status: 'done',
    contractId: 'c2',
    declinedById: null,
    declinedAt: null,
    declinedStage: null,
    declineReason: null,
    doneAt: at,
    createdAt: at,
    updatedAt: at,
    employee: { id: 'e1', employeeCode: 'TL-0001', fullNameEn: 'Ben' },
    requestedBy: { email: 'ben@trendlix.com' },
    declinedBy: null,
    contract: {
      id: 'c2',
      number: 'CON-2026-0001-A1',
      kind: 'amendment',
      version: 2,
      employmentId: 'm1',
      startDate: new Date('2026-11-01T00:00:00Z'),
      grossSalary: new Prisma.Decimal(11200),
      status: 'active',
      approval: 'approved',
      returnedReason: null,
      approvedAt: at,
    },
    steps: log,
    employment: {
      endDate: null,
      contracts: [
        {
          number: 'CON-2026-0001-A1',
          startDate: new Date('2026-11-01T00:00:00Z'),
          endDate: new Date('2027-06-30T00:00:00Z'),
          payBasis: 'monthly',
          grossSalary: new Prisma.Decimal(11200),
          hourlyRate: null,
          hoursPerWeek: null,
          allowances: [{ amount: new Prisma.Decimal(500), taxable: true, insured: false }],
        },
      ],
    },
    ...over,
  } as RequestRow;
}

describe('a request as each viewer sees it', () => {
  it('keeps what it answered before 17 October 2026: the comment as `reason`, the statuses, the raise and the decision', () => {
    const v = raiseRequestView(request(), 'full', 'hr', { grossSalary: 10000, endDate: '2027-06-30' });
    expect(v).toMatchObject({
      reason: 'Led the audit',
      comment: 'Led the audit',
      raiseReason: 'performance',
      status: 'done',
      suggestedGross: 11500,
      suggestion: { kind: 'amount', amount: 1500, percent: null, gross: 11500 },
      origin: 'request',
      raise: { number: 'CON-2026-0001-A1', way: 'amendment', change: 'amendment', stage: 'signed', effectiveDate: '2026-11-01', previousGross: 10000, newGross: 11200 },
      decision: null,
      inForce: {
        number: 'CON-2026-0001-A1',
        startDate: '2026-11-01',
        endDate: '2027-06-30',
        payBasis: 'monthly',
        grossSalary: 11200,
        // what the figures shown while deciding are worked out from (17 October 2026)
        hourlyRate: null,
        hoursPerWeek: null,
        allowances: [{ amount: 500, taxable: true, insured: false }],
      },
      amountsHidden: false,
    });
    expect(v.steps).toHaveLength(7);
  });

  it('the employee: their own suggestion, not the gross it comes to; their new salary once done', () => {
    const v = raiseRequestView(request(), 'self', 'ben');
    expect(v).toMatchObject({ suggestedGross: null, suggestion: { kind: 'amount', amount: 1500, percent: null, gross: null }, inForce: null, amountsHidden: true });
    expect(v.raise).toMatchObject({ previousGross: null, newGross: 11200, effectiveDate: '2026-11-01' });
    expect(v.steps[6].gross).toBe(11200);
    // before the signing, nothing of the new pay
    const approved = raiseRequestView(request({ status: 'approved', doneAt: null }), 'self', 'ben');
    expect(approved.raise).toMatchObject({ newGross: null, effectiveDate: null });
    expect(approved.steps.every((s) => s.gross === null)).toBe(true);
  });

  it('the manager: no figure at all, not even the employee’s suggestion; the reason, comments and decisions', () => {
    const v = raiseRequestView(request(), 'manager', 'mona');
    expect(v).toMatchObject({ suggestedGross: null, suggestion: null, inForce: null, raiseReason: 'performance', comment: 'Led the audit' });
    expect(v.raise).toMatchObject({ previousGross: null, newGross: null });
    expect(v.steps.map((s) => s.decision)).toEqual([null, 'approve_other', null, null, null, 'approve_other', null]);
    expect(v.steps.every((s) => s.increaseAmount === null && s.increasePercent === null && s.gross === null)).toBe(true);
  });

  it('a request from before 17 October 2026: no reason from the list, its text the comment, the gross typed as before', () => {
    const old = request({ raiseReason: null, comment: 'A year of good reviews', suggestedIncrease: null, suggestedGross: d(11000), status: 'with_hr', contract: null, steps: [step(1, 'submitted', { comment: 'A year of good reviews', gross: d(11000) })] });
    expect(raiseRequestView(old, 'self', 'ben')).toMatchObject({ reason: 'A year of good reviews', raiseReason: null, suggestedGross: 11000, suggestion: { kind: 'gross', gross: 11000 } });
    expect(raiseRequestView(old, 'manager', 'mona')).toMatchObject({ suggestedGross: null, suggestion: null });
  });

  it('Effective from: the month asked from, for every viewer; none on a request from before 17 October 2026', () => {
    const asked = request({ effectiveFrom: new Date('2026-11-01T00:00:00Z') });
    for (const viewer of ['full', 'self', 'manager'] as const) expect(raiseRequestView(asked, viewer, 'mona').effectiveFrom).toBe('2026-11-01');
    expect(raiseRequestView(request({ effectiveFrom: null }), 'self', 'ben').effectiveFrom).toBeNull();
  });

  it('the suggestion: who sees which part', () => {
    const percent = { suggestedIncrease: null, suggestedPercent: d(8), suggestedGross: d(10800) };
    expect(suggestionView(percent, 'full', false)).toEqual({ kind: 'percent', amount: null, percent: 8, gross: 10800 });
    expect(suggestionView(percent, 'self', true)).toEqual({ kind: 'percent', amount: null, percent: 8, gross: null });
    expect(suggestionView(percent, 'manager', true)).toEqual({ kind: 'percent', amount: null, percent: 8, gross: null });
    expect(suggestionView(percent, 'manager', false)).toBeNull();
    expect(suggestionView({ suggestedIncrease: null, suggestedPercent: null, suggestedGross: null }, 'full', true)).toBeNull();
  });
});

describe('the CEO’s other reason, on the log (owner, 19 October 2026: "i might want to ammend the raise reason, not only the money")', () => {
  const decided = step(6, 'ceo_decision', { decision: 'approve', comment: 'Fine', raiseReason: 'annual', raiseReasonFrom: 'performance' });

  it('from and to, for everyone who sees the request: a reason, not a figure', () => {
    for (const viewer of ['full', 'self', 'manager'] as const) {
      expect(stepView(decided, viewer, { mine: true, done: false })).toMatchObject({ raiseReason: 'annual', raiseReasonFrom: 'performance' });
    }
    expect(stepView(step(6, 'ceo_decision', { decision: 'approve' }), 'full', { mine: false, done: false })).toMatchObject({ raiseReason: null, raiseReasonFrom: null });
  });
});

describe('a request prepared directly by HR (owner, 19 October 2026: every raise on Raise Requests)', () => {
  const contract = (kind: string, startDate: string) => ({ kind, startDate: new Date(`${startDate}T00:00:00Z`) });

  it('says where it came from, and what its raise is to the version before: an amendment, a new contract or a renewal', () => {
    expect(raiseRequestView(request({ origin: 'direct', requester: 'hr' }), 'full', 'hr').origin).toBe('direct');
    expect(raiseChangeOf(contract('amendment', '2026-11-01'), { endDate: '2027-06-30' })).toBe('amendment');
    expect(raiseChangeOf(contract('contract', '2026-11-01'), { endDate: '2027-06-30' })).toBe('new_contract');
    expect(raiseChangeOf(contract('contract', '2027-07-01'), { endDate: '2027-06-30' })).toBe('renewal');
    // an open-ended one has no end: a contract after it is within its term
    expect(raiseChangeOf(contract('contract', '2027-07-01'), { endDate: null })).toBe('new_contract');
    expect(raiseChangeOf(contract('contract', '2027-07-01'), null)).toBe('new_contract');
    const renewal = request({ origin: 'direct', contract: { ...request().contract!, kind: 'contract', startDate: new Date('2027-07-01T00:00:00Z') } });
    expect(raiseRequestView(renewal, 'manager', 'mona', { grossSalary: 10000, endDate: '2027-06-30' }).raise).toMatchObject({ change: 'renewal', previousGross: null });
  });
});
