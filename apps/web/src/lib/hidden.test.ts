import { HIDDEN } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { byDate, mergeAll } from '../app/(app)/contracts/list';
import { serviceLength } from '../app/(app)/dashboard/dashboard';
import { termLabel } from '../app/(app)/employees/[id]/contracts/dates';
import { FORMS_HIDDEN, formsGap } from '../app/(app)/employees/[id]/insurance/insurance';
import { directorySections, hiddenPlace } from '../app/(app)/employees/directory-groups';
import { leadHidden, leadLine } from './department-leads';
import { employmentHidden, filtersByJob, HIDDEN_LABEL, isHidden, labelOf, personCutOff, readsHidden, shownText } from './hidden';
import type { ContractListItem, DocumentItem, EmployeeSummary, Employment } from './types';

// What a developer is shown where the API hid a person's job or social insurance details (owner, 22 October 2026: "Hide
// per-person details", "and the social insurance"): Hidden, never "••••", an empty date or a crash.

describe('a hidden value', () => {
  it('is "••••", or a text made of hidden parts only', () => {
    expect(isHidden(HIDDEN)).toBe(true);
    expect(isHidden(`${HIDDEN} › ${HIDDEN}`)).toBe(true);
    expect(isHidden(`${HIDDEN} · ${HIDDEN}`)).toBe(true);
    for (const shown of ['Marketing', `Marketing › ${HIDDEN}`, '', null, undefined, 0, 'Hidden']) expect(isHidden(shown), String(shown)).toBe(false);
    // the label the screens put in its place reads hidden too
    expect(readsHidden(HIDDEN_LABEL)).toBe(true);
    expect(readsHidden('Marketing')).toBe(false);
  });

  it('shows as Hidden; a label from a list as Hidden, or nothing for one it doesn’t have', () => {
    expect(shownText(HIDDEN)).toBe('Hidden');
    expect(shownText('Senior Editor')).toBe('Senior Editor');
    expect(shownText(null)).toBeNull();
    const labels = { full_time: 'Full-time', part_time: 'Part-time' };
    expect(labelOf(labels, 'full_time')).toBe('Full-time');
    expect(labelOf(labels, HIDDEN)).toBe('Hidden');
    expect(labelOf(labels, 'contractor')).toBeUndefined();
    expect(labelOf(labels, 'toString')).toBeUndefined();
    expect(labelOf(labels, null)).toBeUndefined();
  });

  it('an employment hidden, a person cut off, a developer’s filters off', () => {
    expect(employmentHidden({ employmentType: HIDDEN })).toBe(true);
    expect(employmentHidden({ employmentType: 'full_time' })).toBe(false);
    expect(employmentHidden(null)).toBe(false);
    expect(personCutOff({ id: null })).toBe(true);
    expect(personCutOff({ id: '0e0e0e0e-1111-4222-8333-444455556666' })).toBe(false);
    expect(personCutOff(null)).toBe(false);
    expect(filtersByJob({ developer: true })).toBe(false);
    expect(filtersByJob({})).toBe(true);
  });
});

describe('the screens with hidden details', () => {
  it('a department’s head cut off: Hidden, on the Departments page and the org chart', () => {
    const cut = { id: null as unknown as string, fullNameEn: HIDDEN };
    expect(leadHidden(cut)).toBe(true);
    expect(leadLine(false, cut)).toBe('Head: Hidden');
    expect(leadLine(true, { id: 'p1', fullNameEn: 'Employee EMP-0182' })).toBe('Team lead: Employee EMP-0182');
  });

  it('the directory: everyone employed in one group, whatever their (hidden) place', () => {
    const row = (name: string, department: unknown) => ({ name, employment: { department } as EmployeeSummary['employment'] });
    const rows = [row('A', { id: null, nameEn: HIDDEN, parent: null }), row('B', { id: null, nameEn: HIDDEN, parent: { id: null, nameEn: HIDDEN } }), { name: 'C', employment: null }];
    const sections = directorySections(rows, undefined, hiddenPlace);
    expect(sections.map((s) => [s.label, s.groups.map((g) => [g.department, g.teams.map((t) => [t.team, t.rows.map((r) => r.name)])])])).toEqual([
      ['Active', [[HIDDEN, [[null, ['A', 'B']]]]]],
      ['Inactive', [[null, [[null, ['C']]]]]],
    ]);
  });

  it('contracts without their dates: sorted without crashing, the term Hidden', () => {
    const c = (number: string, startDate: string | null) => ({ number, startDate, endDate: null }) as unknown as ContractListItem;
    expect(byDate([c('C-2', null), c('C-1', null)], (x) => x.startDate).map((x) => x.number)).toEqual(['C-2', 'C-1']);
    expect(mergeAll([[], [c('C-1', null), c('C-3', null)]]).map((x) => x.number)).toEqual(['C-3', 'C-1']);
    expect(termLabel({ startDate: null, endDate: null })).toBe('Hidden');
    expect(termLabel({ startDate: '2026-11-01', endDate: '2027-10-31' })).toBe('01/11/2026 – 31/10/2027');
  });

  it('the Social Insurance tab: no crash on a hidden employment type, and why no form shows', () => {
    const hidden = { employmentType: HIDDEN, endDate: null } as unknown as Employment;
    const form = { slotKey: 'insurance_form_1' } as DocumentItem;
    expect(formsGap(hidden, [])).toEqual({ kind: 'hidden', text: FORMS_HIDDEN });
    expect(formsGap(hidden, [form])).toBeNull();
  });

  it('the dashboard: no length of service without a join date', () => {
    expect(serviceLength(null, '2026-10-22')).toBeNull();
    expect(serviceLength('2025-10-22', '2026-10-22')).toBe('1 year');
  });
});
