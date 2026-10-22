import type { PayEvent, SalarySummary } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  changeText,
  compactAmount,
  eventTitle,
  eventView,
  firstSignedDate,
  fromToText,
  monthsAgoText,
  monthsLabel,
  niceTicks,
  signedPercent,
  stepChart,
  summaryFigures,
  type VersionRaise,
} from './salary-history';

/** A pay event as the API sends it, signed, with what a test changes. */
function event(over: Partial<PayEvent> & Pick<PayEvent, 'version'>): PayEvent {
  const gross = over.to?.gross ?? 10_000;
  return {
    contractId: `c${over.version}`,
    number: 'CON-2026-0001',
    change: 'hired',
    stage: 'signed',
    effectiveDate: '2026-01-01',
    endDate: '2026-12-31',
    payBasis: 'monthly',
    hourlyRate: null,
    from: null,
    to: { gross, allowances: 0, total: gross },
    allowances: [],
    difference: null,
    samePay: false,
    raise: false,
    reason: null,
    promotion: null,
    approvedBy: null,
    approvedAt: null,
    signedOn: '2025-12-20',
    insuredWageFrom: null,
    ...over,
  };
}

const hired = event({ version: 1, stage: 'replaced', effectiveDate: '2025-03-01', endDate: '2026-02-28' });
const raise = event({
  version: 2,
  change: 'amendment',
  stage: 'signed',
  effectiveDate: '2025-09-01',
  endDate: '2026-02-28',
  from: { gross: 10_000, allowances: 0, total: 10_000 },
  to: { gross: 12_500, allowances: 500, total: 13_000 },
  difference: { amount: 2_500, percent: 25 },
  raise: true,
  reason: 'annual',
  approvedBy: 'Hazem Magdy',
  approvedAt: '2025-08-20T09:30:00.000Z',
  insuredWageFrom: '2026-01-01',
});

describe('the words of the salary history', () => {
  it('names each event, a renewal with the same pay or new pay', () => {
    expect(eventTitle({ change: 'hired', samePay: false })).toBe('Hired');
    expect(eventTitle({ change: 'amendment', samePay: false })).toBe('Amendment');
    expect(eventTitle({ change: 'new_contract', samePay: false })).toBe('New contract');
    expect(eventTitle({ change: 'renewal', samePay: true })).toBe('Renewal · same pay');
    expect(eventTitle({ change: 'renewal', samePay: false })).toBe('Renewal · new pay');
  });

  it('writes a change of the gross with its sign and percent', () => {
    expect(changeText({ amount: 2_500, percent: 25 })).toBe('+EGP 2,500.00 (+25%)');
    expect(changeText({ amount: 1_250.5, percent: 12.5 })).toBe('+EGP 1,250.50 (+12.5%)');
    expect(changeText({ amount: -1_000, percent: -10 })).toBe('−EGP 1,000.00 (−10%)');
    // from nothing there is no percent
    expect(changeText({ amount: 5_000, percent: null })).toBe('+EGP 5,000.00');
    expect(changeText({ amount: 0, percent: 0 })).toBe('No change');
    expect(changeText(null)).toBeNull();
    expect(signedPercent(0.04)).toBe('+0%');
  });

  it('says how long ago in months and years', () => {
    expect(monthsAgoText(0)).toBe('this month');
    expect(monthsAgoText(-1)).toBe('this month');
    expect(monthsAgoText(1)).toBe('1 month ago');
    expect(monthsAgoText(3)).toBe('3 months ago');
    expect(monthsAgoText(12)).toBe('1 year ago');
    expect(monthsAgoText(14)).toBe('1 year and 2 months ago');
    expect(monthsAgoText(25)).toBe('2 years and 1 month ago');
  });

  it('writes an amount from what it was to what it is', () => {
    expect(fromToText(10_000, 12_500)).toBe('EGP 10,000.00 → EGP 12,500.00');
    expect(fromToText(500, 500)).toBe('EGP 500.00, as before');
    expect(fromToText(0, 0)).toBe('None');
    expect(fromToText(null, 10_000)).toBe('EGP 10,000.00');
    expect(fromToText(null, 0)).toBe('None');
  });
});

describe('the summary', () => {
  const summary: SalarySummary = {
    startingGross: 10_000,
    currentGross: 12_500,
    change: { amount: 2_500, percent: 25 },
    raises: 1,
    lastRaise: { date: '2025-09-01', monthsAgo: 13 },
    next: null,
  };

  it('opens with the starting and current gross, the change, and the raises with the last one', () => {
    expect(summaryFigures(summary, '2025-03-01')).toEqual([
      { key: 'starting', label: 'Starting gross', value: 'EGP 10,000.00', note: 'From 01/03/2025' },
      { key: 'current', label: 'Current gross', value: 'EGP 12,500.00', note: null },
      { key: 'change', label: 'Change since joining', value: '+EGP 2,500.00 (+25%)', note: null },
      { key: 'raises', label: 'Raises', value: '1', note: 'Last on 01/09/2025, 1 year and 1 month ago' },
    ]);
  });

  it('adds the next signed raise, and says when there is none yet', () => {
    const figures = summaryFigures(
      { ...summary, raises: 0, lastRaise: null, change: { amount: 0, percent: 0 }, next: { date: '2026-12-01', gross: 13_000 } },
      null,
    );
    expect(figures.find((f) => f.key === 'starting')?.note).toBeNull();
    expect(figures.find((f) => f.key === 'change')?.value).toBe('No change');
    expect(figures.find((f) => f.key === 'raises')?.note).toBe('None yet');
    expect(figures.at(-1)).toEqual({ key: 'next', label: 'Next raise', value: 'EGP 13,000.00', note: 'From 01/12/2026, signed' });
  });

  it('starts from the first signed version', () => {
    expect(firstSignedDate([raise, hired])).toBe('2025-03-01');
    expect(firstSignedDate([event({ version: 1, stage: 'draft' })])).toBeNull();
  });
});

describe('an event on the timeline', () => {
  it('shows the hire with its pay alone', () => {
    const v = eventView(hired);
    expect(v).toMatchObject({
      title: 'Hired',
      reference: 'CON-2026-0001 · version 1',
      stageLabel: 'Replaced',
      signed: true,
      gross: 'EGP 10,000.00',
      change: null,
    });
    expect(v.effective).toBe('01/03/2025 – 28/02/2026');
    expect(v.allowances).toBe('None');
    expect(v.reason).toBeNull();
  });

  it('shows a raise from → to, with its change, reason, the CEO’s approval and insured-wage date', () => {
    const v = eventView(raise);
    expect(v.title).toBe('Amendment');
    // an amendment keeps the contract's end: only from when
    expect(v.effective).toBe('From 01/09/2025');
    expect(v.gross).toBe('EGP 10,000.00 → EGP 12,500.00');
    expect(v.change).toBe('+EGP 2,500.00 (+25%)');
    expect(v.allowances).toBe('EGP 0.00 → EGP 500.00');
    expect(v.total).toBe('EGP 10,000.00 → EGP 13,000.00');
    expect(v.reason).toBe('Annual raise');
    expect(v.decision).toBe('Approved by Hazem Magdy on 20/08/2025, 12:30 PM');
    expect(v.returnedReason).toBeNull();
    expect(v.insuredWage).toBe('Follows the new pay from 01/01/2026');
    expect(v.signedOn).toBe('20/12/2025');
    expect(v.documentsReady).toBe(true);
  });

  it('has no CEO’s decision, Form 2 or wait for documents on a version that needs no approval', () => {
    const v = eventView(hired);
    expect(v.decision).toBeNull();
    expect(v.insuredWage).toBeNull();
    expect(v.form2).toBeNull();
    expect(v.documentsReady).toBe(true);
  });

  it('says "Same pay" for a renewal as it was, and shows a promotion and pay by the hour', () => {
    const renewal = eventView(
      event({
        version: 3,
        change: 'renewal',
        samePay: true,
        from: { gross: 12_500, allowances: 500, total: 13_000 },
        to: { gross: 12_500, allowances: 500, total: 13_000 },
        difference: { amount: 0, percent: 0 },
      }),
    );
    expect(renewal.title).toBe('Renewal · same pay');
    expect(renewal.change).toBe('Same pay');
    expect(renewal.allowances).toBe('EGP 500.00, as before');
    const promoted = eventView(
      event({
        version: 2,
        change: 'new_contract',
        stage: 'pending_ceo',
        promotion: { jobTitle: 'Senior Designer', grade: 'G4' },
        payBasis: 'hourly',
        hourlyRate: 150,
      }),
    );
    expect(promoted.stageLabel).toBe('With the CEO');
    expect(promoted.signed).toBe(false);
    expect(promoted.promotion).toBe('Senior Designer, grade G4');
    expect(promoted.hourly).toBe('EGP 150.00 an hour; the gross is the monthly estimate');
    expect(eventView(event({ version: 2, promotion: { jobTitle: null, grade: 'G4' } })).promotion).toBe('grade G4');
  });
});

describe('the Pay History, in the timeline', () => {
  /** A version's raise as the contracts send it. */
  const versionRaise = (over: Partial<VersionRaise> = {}): VersionRaise => ({
    approval: 'approved',
    sentAt: '2025-08-18T08:00:00.000Z',
    approvedBy: { email: 'ceo@trendlix.com' },
    approvedAt: '2025-08-20T09:30:00.000Z',
    returnedReason: null,
    form2From: null,
    insuredWageFrom: '2026-01-01',
    ...over,
  });

  it('says "(Form 2)" after the insured-wage date once it is filed, and offers HR to record or change it', () => {
    const filed = eventView({ ...raise, insuredWageFrom: '2025-10-01' }, versionRaise({ form2From: '2025-10-01', insuredWageFrom: '2025-10-01' }));
    expect(filed.insuredWage).toBe('Follows the new pay from 01/10/2025 (Form 2)');
    expect(filed.form2).toEqual({ effective: '2025-09-01', form2From: '2025-10-01' });
    const none = eventView(raise, versionRaise());
    expect(none.insuredWage).toBe('Follows the new pay from 01/01/2026');
    expect(none.form2).toEqual({ effective: '2025-09-01', form2From: null });
  });

  it('records Form 2 only on a raise the CEO approved, signed or not', () => {
    const approved = event({ ...raise, stage: 'approved', signedOn: null });
    expect(eventView(approved, versionRaise()).form2).not.toBeNull();
    const waiting = event({ ...raise, stage: 'pending_ceo', approvedAt: null, approvedBy: null, signedOn: null });
    expect(eventView(waiting, versionRaise({ approval: 'pending_ceo', approvedAt: null, approvedBy: null })).form2).toBeNull();
    // without its version (the contracts not loaded), nothing to record it on
    expect(eventView(raise).form2).toBeNull();
  });

  it('says where the CEO’s step stands before the approval, with the reason of a return', () => {
    const waiting = event({ ...raise, stage: 'pending_ceo', approvedAt: null, approvedBy: null, signedOn: null });
    expect(eventView(waiting, versionRaise({ approval: 'pending_ceo', approvedAt: null, approvedBy: null })).decision).toBe(
      'With the CEO since 18/08/2025',
    );
    const returned = event({ ...raise, stage: 'returned', approvedAt: null, approvedBy: null, signedOn: null });
    const back = eventView(returned, versionRaise({ approval: 'draft', approvedAt: null, approvedBy: null, returnedReason: 'Make it from January.' }));
    expect(back.decision).toBe('Returned to HR');
    expect(back.returnedReason).toBe('Make it from January.');
    const draft = event({ ...raise, stage: 'draft', approvedAt: null, approvedBy: null, signedOn: null });
    expect(eventView(draft, versionRaise({ approval: 'draft', sentAt: null, approvedAt: null, approvedBy: null })).decision).toBe('Not sent to the CEO yet');
  });

  it('words the CEO’s step from the event alone when its version isn’t loaded', () => {
    const at = (stage: PayEvent['stage']) => eventView(event({ ...raise, stage, approvedAt: null, approvedBy: null })).decision;
    expect(at('pending_ceo')).toBe('With the CEO');
    expect(at('returned')).toBe('Returned to HR');
    expect(at('draft')).toBe('Not sent to the CEO yet');
    expect(at('approved')).toBe('Approved');
    // the API's approver, by name, is preferred to the version's sign-in email
    expect(eventView(raise, versionRaise()).decision).toBe('Approved by Hazem Magdy on 20/08/2025, 12:30 PM');
  });

  it('has the documents generated once the CEO approved a change of pay', () => {
    expect(eventView(event({ ...raise, stage: 'pending_ceo' })).documentsReady).toBe(false);
    expect(eventView(event({ ...raise, stage: 'returned' })).documentsReady).toBe(false);
    expect(eventView(event({ ...raise, stage: 'approved' })).documentsReady).toBe(true);
    expect(eventView(event({ ...raise, stage: 'replaced' })).documentsReady).toBe(true);
    // a renewal with the same pay needs no approval
    expect(eventView(event({ version: 3, change: 'renewal', samePay: true, stage: 'draft' })).documentsReady).toBe(true);
  });

  it('counts months for the pay received and the salary review', () => {
    expect(monthsLabel(1)).toBe('1 month');
    expect(monthsLabel(14)).toBe('14 months');
  });
});

describe('the chart', () => {
  it('rounds the axis to clean ticks from 0, past the highest gross', () => {
    expect(niceTicks(12_500)).toEqual([0, 5_000, 10_000, 15_000]);
    expect(niceTicks(10_000)).toEqual([0, 2_500, 5_000, 7_500, 10_000, 12_500]);
    expect(niceTicks(7_200)).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(compactAmount(0)).toBe('0');
    expect(compactAmount(2_500)).toBe('2.5K');
    expect(compactAmount(15_000)).toBe('15K');
    expect(compactAmount(1_250_000)).toBe('1.25M');
    expect(compactAmount(500)).toBe('500');
  });

  it('is nothing until a version is signed', () => {
    expect(stepChart({ events: [event({ version: 1, stage: 'draft' })], joinDate: '2026-01-01', endDate: null, today: '2026-10-16' })).toBeNull();
  });

  // a developer gets no employment or contract dates (owner, 22 October 2026: "Hide per-person details")
  it('is nothing, and an event’s dates Hidden, without the dates', () => {
    const undated = event({ version: 1, effectiveDate: null as unknown as string, endDate: null });
    expect(stepChart({ events: [undated], joinDate: null, endDate: null, today: '2026-10-16' })).toBeNull();
    expect(eventView(undated).effective).toBe('Hidden');
  });

  it('steps at each signed effective date, to scale from the join date to today', () => {
    const chart = stepChart(
      {
        events: [
          hired,
          raise,
          event({ version: 3, stage: 'draft', effectiveDate: '2026-03-01', to: { gross: 99_000, allowances: 0, total: 99_000 } }),
        ],
        joinDate: '2025-03-01',
        endDate: null,
        today: '2026-03-01',
      },
      { width: 400, height: 200 },
    )!;
    expect(chart.plot).toEqual({ left: 44, top: 16, right: 384, bottom: 172 });
    // the draft isn't paid: the axis goes to 15K, not 99K
    expect(chart.yTicks.map((t) => t.label)).toEqual(['0', '5K', '10K', '15K']);
    expect(chart.yTicks[0].y).toBe(172);
    expect(chart.yTicks.at(-1)!.y).toBe(16);
    expect(chart.points.map((p) => [p.date, p.gross, p.state])).toEqual([
      ['2025-03-01', 10_000, 'past'],
      ['2025-09-01', 12_500, 'current'],
    ]);
    // 01/03/2025 at the left edge; 01/09/2025 is 184 of the 365 days along
    expect(chart.points[0].x).toBe(44);
    expect(chart.points[1].x).toBe(Math.round((44 + (184 / 365) * 340) * 10) / 10);
    expect(chart.points[1].y).toBe(Math.round((172 - (12_500 / 15_000) * 156) * 10) / 10);
    // today is the end: nothing drawn after it
    expect(chart.future).toBeNull();
    expect(chart.today).toBeNull();
    expect(chart.solid).toBe(`M44 ${chart.points[0].y} H${chart.points[1].x} V${chart.points[1].y} H384`);
    expect(chart.xTicks.map((t) => t.label)).toEqual(['Mar 2025', 'May 2025', 'Jul 2025', 'Sep 2025', 'Nov 2025', 'Jan 2026', 'Mar 2026']);
    expect(chart.description).toBe(
      'Gross salary from 01/03/2025 to today: EGP 10,000.00 at the start, EGP 12,500.00 now, 1 change of the gross in between. Every change is listed in the timeline below.',
    );
  });

  it('draws a signed raise still to come after today, a month on, and marks today', () => {
    const next = event({
      version: 3,
      change: 'amendment',
      effectiveDate: '2026-12-01',
      to: { gross: 14_000, allowances: 0, total: 14_000 },
      raise: true,
    });
    const chart = stepChart({ events: [hired, raise, next], joinDate: '2025-03-01', endDate: null, today: '2026-10-16' })!;
    expect(chart.points.map((p) => p.state)).toEqual(['past', 'current', 'upcoming']);
    expect(chart.today).not.toBeNull();
    expect(chart.future).toMatch(/^M\S+ \S+ H\S+ V\S+ H624$/);
    // fewer ticks once the span is longer: every six months, up to 01/01/2027, a month after the raise to come
    expect(chart.xTicks.map((t) => t.label)).toEqual(['Jul 2025', 'Jan 2026', 'Jul 2026', 'Jan 2027']);
    expect(chart.xTicks.at(-1)!.x).toBe(624);
    expect(chart.description).toContain('To come: EGP 14,000.00 from 01/12/2026.');
  });

  it('runs to the end of a past employment, the last version past rather than current', () => {
    const chart = stepChart({ events: [hired, raise], joinDate: '2025-03-01', endDate: '2026-02-28', today: '2026-10-16' })!;
    expect(chart.points.map((p) => p.state)).toEqual(['past', 'past']);
    expect(chart.today).toBeNull();
    expect(chart.future).toBeNull();
    expect(chart.description).toContain('from 01/03/2025 to 28/02/2026');
    expect(chart.description).toContain('EGP 12,500.00 at the end');
  });

  it('draws it all as to come for someone whose signed contract starts after today', () => {
    const chart = stepChart({ events: [event({ version: 1, effectiveDate: '2026-11-01' })], joinDate: '2026-11-01', endDate: null, today: '2026-10-16' })!;
    expect(chart.solid).toBeNull();
    expect(chart.future).toMatch(/^M44 \S+ H624$/);
    expect(chart.points.map((p) => p.state)).toEqual(['upcoming']);
    expect(chart.today).toBeNull();
    expect(chart.description).toBe('Gross salary: nothing in force yet. To come: EGP 10,000.00 from 01/11/2026. Every change is listed in the timeline below.');
  });

  it('keeps the later version of two from the same day, and has room for someone who joined today', () => {
    const same = event({ version: 2, change: 'new_contract', effectiveDate: '2025-03-01', to: { gross: 11_000, allowances: 0, total: 11_000 } });
    const chart = stepChart({ events: [hired, same], joinDate: '2025-03-01', endDate: null, today: '2025-03-01' })!;
    expect(chart.points.map((p) => p.gross)).toEqual([11_000]);
    expect(chart.points[0].state).toBe('current');
    expect(chart.solid).toMatch(/ H624$/);
  });
});
