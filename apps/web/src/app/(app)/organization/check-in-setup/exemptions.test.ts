import { describe, expect, it } from 'vitest';
import type { CheckInExemptionView } from '../../../../lib/exemption-types';
import {
  addedExemptionsText,
  endedExemptionText,
  endExemptionConfirm,
  exemptButtonText,
  exemptionBody,
  exemptionCandidates,
  exemptionRowText,
  periodByText,
  periodText,
  reasonCount,
  seesExemptions,
  splitPeriods,
  stateBadge,
} from './exemptions';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"): the profile's section and Check-in Setup's list, their form and words.

const TODAY = '2026-10-25';

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of ([] as string[]).concat(v)) fd.append(k, one);
  return fd;
};

const view = (over: Partial<CheckInExemptionView> = {}): CheckInExemptionView => ({
  id: 'x1',
  employee: { id: 'e1', employeeCode: 'EMP-0012', fullNameEn: 'Lina Hassan', department: 'Design › Video' },
  reason: 'Works at the client’s site all month',
  startDate: '2026-10-25',
  endDate: null,
  state: 'current',
  createdAt: '2026-10-25T08:00:00.000Z',
  createdBy: 'Hazem Magdy',
  endedAt: null,
  endedBy: null,
  canEnd: true,
  ...over,
});

describe('who sees a person’s exemptions', () => {
  it('is HR, Admin (a Super Admin too), the CEO and the person themself', () => {
    expect(seesExemptions({ roles: ['hr'] }, 'e1')).toBe(true);
    expect(seesExemptions({ roles: ['super_admin'] }, 'e1')).toBe(true);
    expect(seesExemptions({ roles: ['ceo'] }, 'e1')).toBe(true);
    expect(seesExemptions({ roles: ['employee'], employeeId: 'e1' }, 'e1')).toBe(true);
    expect(seesExemptions({ roles: ['employee', 'manager'], employeeId: 'e2' }, 'e1')).toBe(false);
    expect(seesExemptions({ roles: ['finance'] }, 'e1')).toBe(false);
  });
});

describe('the form, as the API takes it', () => {
  it('reads the people chosen once each, the reason, and the days as DD/MM/YYYY', () => {
    const { body, problems } = exemptionBody(form({ employeeId: ['e1', 'e2', 'e1'], reason: '  On site  ', startDate: '01/11/2026', endDate: '30/11/2026' }), TODAY);
    expect(problems).toEqual([]);
    expect(body).toEqual({ employeeIds: ['e1', 'e2'], reason: 'On site', startDate: '2026-11-01', endDate: '2026-11-30' });
  });

  it('sends no days when left empty: from today, with no end', () => {
    expect(exemptionBody(form({ employeeId: 'e1', reason: 'On site', startDate: '', endDate: '' }), TODAY).body).toEqual({ employeeIds: ['e1'], reason: 'On site', startDate: null, endDate: null });
  });

  it('needs someone, a reason, real dates and the last day on or after the first', () => {
    expect(exemptionBody(form({ reason: 'On site' }), TODAY).problems).toEqual(['Choose at least one person to exempt.']);
    expect(exemptionBody(form({ employeeId: 'e1', reason: '   ' }), TODAY).problems).toEqual(['Write why they are exempt from check-in, e.g. works at the client’s site all month.']);
    expect(exemptionBody(form({ employeeId: 'e1', reason: 'x'.repeat(501) }), TODAY).problems).toEqual(['Keep the reason to 500 characters; it has 501.']);
    expect(exemptionBody(form({ employeeId: 'e1', reason: 'On site', startDate: '31/02/2026', endDate: 'soon' }), TODAY).problems).toEqual([
      'Enter the first day as DD/MM/YYYY, e.g. 01/11/2026, or leave it empty for today.',
      'Enter the last day as DD/MM/YYYY, e.g. 30/11/2026, or leave it empty for no end date.',
    ]);
    expect(exemptionBody(form({ employeeId: 'e1', reason: 'On site', startDate: '10/11/2026', endDate: '01/11/2026' }), TODAY).problems).toEqual(["The last day can't be before the first."]);
    // the last day before today, with the first left as today
    expect(exemptionBody(form({ employeeId: 'e1', reason: 'On site', endDate: '24/10/2026' }), TODAY).problems).toEqual(["The last day can't be before the first."]);
  });

  it('takes at most 100 people at once', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `e${i}`);
    expect(exemptionBody(form({ employeeId: ids, reason: 'On site' }), TODAY).problems).toEqual(['Exempt at most 100 people at once: 101 are chosen.']);
  });

  it('counts the reason and names the button', () => {
    expect(reasonCount('  On site ')).toBe('7/500');
    expect(exemptButtonText(1)).toBe('Exempt 1 person');
    expect(exemptButtonText(3)).toBe('Exempt 3 people');
  });
});

describe('the list and the profile', () => {
  it('says a row: the person with their code, the team, from and until', () => {
    expect(exemptionRowText(view())).toEqual({ person: 'Lina Hassan · EMP-0012', team: 'Design › Video', from: '25/10/2026', until: 'No end date' });
    expect(exemptionRowText(view({ endDate: '2026-11-30' })).until).toBe('30/11/2026');
    // a developer gets the code hidden: the name alone
    expect(exemptionRowText(view({ employee: { id: 'e1', employeeCode: '••••', fullNameEn: 'Employee 7K3Q', department: null } }))).toMatchObject({ person: 'Employee 7K3Q', team: null });
  });

  it('says the period, who added it and who ended it early', () => {
    expect(periodText(view({ startDate: '2026-11-01', endDate: '2026-11-30' }))).toBe('From 01/11/2026 until 30/11/2026');
    expect(periodText(view())).toBe('From 25/10/2026, no end date');
    expect(periodByText(view())).toBe('Added by Hazem Magdy on 25/10/2026');
    expect(periodByText(view({ endedAt: '2026-10-30T10:00:00.000Z', endedBy: 'Rania Girgis' }))).toBe('Added by Hazem Magdy on 25/10/2026 · ended early by Rania Girgis on 30/10/2026');
    expect(periodByText(view({ createdBy: null }))).toBe('Added on 25/10/2026');
  });

  it('badges the state, and puts the current first, then those to come, the ended apart newest first', () => {
    expect(stateBadge('current')).toEqual({ label: 'Current', tone: 'bg-ok-soft text-ok' });
    expect(stateBadge('upcoming').label).toBe('Upcoming');
    expect(stateBadge('ended').label).toBe('Ended');
    const periods = [
      view({ id: 'a', state: 'ended', startDate: '2026-01-01' }),
      view({ id: 'b', state: 'upcoming', startDate: '2026-12-01' }),
      view({ id: 'c', state: 'ended', startDate: '2026-06-01' }),
      view({ id: 'd', state: 'current', startDate: '2026-10-01' }),
    ];
    const { active, ended } = splitPeriods(periods);
    expect(active.map((p) => p.id)).toEqual(['d', 'b']);
    expect(ended.map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('offers to add everyone without a current or upcoming exemption, by name', () => {
    const candidates = [
      { id: 'e2', fullNameEn: 'Omar Khaled', employeeCode: 'EMP-0182', department: 'Sales' },
      { id: 'e1', fullNameEn: 'Lina Hassan', employeeCode: 'EMP-0012', department: 'Design' },
      { id: 'e3', fullNameEn: 'Amal Fathy', employeeCode: 'EMP-0007', department: null },
    ];
    expect(exemptionCandidates(candidates, [view()])).toEqual([
      { value: 'e3', label: 'Amal Fathy · EMP-0007' },
      { value: 'e2', label: 'Omar Khaled · EMP-0182 · Sales' },
    ]);
    expect(exemptionCandidates(candidates, [view({ state: 'ended' })]).map((o) => o.value)).toEqual(['e3', 'e1', 'e2']);
  });

  it('asks before ending: one started ends today, one not started is removed; and says what happened', () => {
    expect(endExemptionConfirm('Lina Hassan', view(), TODAY)).toBe(
      'End Lina Hassan’s exemption from check-in now? Today still counts as full; from tomorrow their working days count from their check-ins again.',
    );
    expect(endExemptionConfirm('Lina Hassan', view({ startDate: '2026-11-01' }), TODAY)).toBe('Remove Lina Hassan’s exemption from check-in? It hasn’t started yet, so it is removed.');
    expect(endedExemptionText('Lina Hassan', false)).toBe('Lina Hassan’s exemption from check-in ends today: from tomorrow their check-ins count again.');
    expect(endedExemptionText('Lina Hassan', true)).toBe('Removed Lina Hassan’s exemption from check-in: it hadn’t started.');
  });

  it('says what saving did: one person with the period, several by number', () => {
    expect(addedExemptionsText([view({ startDate: '2026-11-01', endDate: '2026-11-30' })])).toBe('Lina Hassan is exempt from check-in: from 01/11/2026 until 30/11/2026.');
    expect(addedExemptionsText([view(), view({ id: 'x2' })])).toBe('Exempted 2 people from check-in.');
  });
});
