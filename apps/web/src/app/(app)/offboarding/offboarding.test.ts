import { describe, expect, it } from 'vitest';
import type { OffboardingCaseView, RehireMatch } from '@trendlix/shared';
import { clearanceFormMarkup, signingOwners } from './clearance-form';
import {
  addItemForm,
  caseHref,
  casesHref,
  checklistForm,
  exitInterviewForm,
  formerApiPath,
  managesOffboarding,
  markItemForm,
  monthLabel,
  percentText,
  progressText,
  readCasesFilter,
  readFormerQuery,
  readTurnoverYear,
  rehireForm,
  rehireWarningText,
  seesOffboardingList,
  strongWarning,
  turnoverExcelHref,
} from './offboarding';

// Offboarding on the site (owner, 22 October 2026: the full module): who sees what, the pages' filters, the forms, the
// rehire warning and the printed clearance form.

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe('who sees offboarding', () => {
  it('lets HR, the CEO and a Super Admin handle cases; an Admin and Finance see the list for their items', () => {
    expect(managesOffboarding({ roles: ['hr'] })).toBe(true);
    expect(managesOffboarding({ roles: ['ceo'] })).toBe(true);
    expect(managesOffboarding({ roles: ['super_admin'] })).toBe(true);
    expect(managesOffboarding({ roles: ['admin'] })).toBe(false);
    expect(seesOffboardingList({ roles: ['admin'] })).toBe(true);
    expect(seesOffboardingList({ roles: ['finance'] })).toBe(true);
    expect(seesOffboardingList({ roles: ['employee', 'manager'] })).toBe(false);
  });
});

describe('the pages’ addresses and filters', () => {
  it('reads the list’s filter, open unless chosen', () => {
    expect(readCasesFilter({})).toBe('open');
    expect(readCasesFilter({ status: 'completed' })).toBe('completed');
    expect(readCasesFilter({ status: 'all' })).toBe('all');
    expect(readCasesFilter({ status: 'whatever' })).toBe('open');
    expect(casesHref('open')).toBe('/offboarding');
    expect(casesHref('cancelled')).toBe('/offboarding?status=cancelled');
    expect(caseHref('abc')).toBe('/offboarding/abc');
    expect(turnoverExcelHref(2026)).toBe('/offboarding/turnover/excel?year=2026');
  });

  it('reads Former Employees’ filters, leaving out anything malformed', () => {
    const q = readFormerQuery({ year: '2026', reason: 'resigned', departmentId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' });
    expect(formerApiPath(q)).toBe('/offboarding/former?year=2026&reason=resigned&departmentId=0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e');
    expect(readFormerQuery({ year: '26', reason: 'bored', departmentId: 'x' })).toEqual({ year: null, reason: null, departmentId: null });
    expect(formerApiPath({ year: null, reason: null, departmentId: null })).toBe('/offboarding/former');
  });

  it('reads the turnover’s year, this year unless chosen', () => {
    expect(readTurnoverYear({}, '2026-10-22')).toBe(2026);
    expect(readTurnoverYear({ year: '2025' }, '2026-10-22')).toBe(2025);
    expect(readTurnoverYear({ year: '1999' }, '2026-10-22')).toBe(2026);
    expect(percentText(12.345)).toBe('12.3%');
    expect(percentText(null)).toBe('—');
    expect(monthLabel('2026-03')).toBe('March 2026');
    expect(progressText({ cleared: 3, total: 8 })).toBe('3 of 8 cleared');
  });
});

describe('the forms', () => {
  it('clears an item: done, not applicable or back to pending, with a note', () => {
    expect(markItemForm(form({ status: 'done', note: ' Keys back ' }))).toEqual({ body: { status: 'done', note: 'Keys back' }, errors: [] });
    expect(markItemForm(form({ status: 'pending' })).body).toEqual({ status: 'pending', note: null });
    expect(markItemForm(form({ status: 'maybe' })).errors).toEqual(['Choose done, not applicable or pending.']);
  });

  it('adds a one-off item with its name and owner', () => {
    expect(addItemForm(form({ label: '  Studio   key ', owner: 'admin' })).body).toEqual({ label: 'Studio key', owner: 'admin' });
    expect(addItemForm(form({ label: '', owner: 'it' })).errors).toEqual(['Give the item a name.', 'Choose who clears it.']);
  });

  it('reads the checklist’s rows in order, the empty new ones left out', () => {
    const fd = form({ 'label-0': 'Keys', 'owner-0': 'admin', 'id-0': 'a1', 'label-1': '', 'owner-1': 'hr', 'label-2': ' Laptop  returned ', 'owner-2': 'finance' });
    expect(checklistForm(fd).items).toEqual([
      { id: 'a1', label: 'Keys', owner: 'admin' },
      { label: 'Laptop returned', owner: 'finance' },
    ]);
  });

  it('needs a reason for rehire unless simply eligible', () => {
    expect(rehireForm(form({ eligibility: 'eligible' })).body).toEqual({ eligibility: 'eligible', reason: null });
    expect(rehireForm(form({ eligibility: 'not_eligible' })).errors).toEqual(['Say why they shouldn’t be hired again.']);
  });

  it('reads the exit interview’s answers, every rating from 1 to 5', () => {
    const good = form({ reason: 'pay', 'rating-role': '4', 'rating-manager': '5', 'rating-pay': '2', 'rating-growth': '3', 'rating-culture': '4', recommend: 'maybe', comments: ' ok ' });
    expect(exitInterviewForm(good).body).toEqual({ reason: 'pay', ratings: { role: 4, manager: 5, pay: 2, growth: 3, culture: 4 }, recommend: 'maybe', comments: 'ok' });
    expect(exitInterviewForm(form({ reason: 'pay', recommend: 'yes' })).errors).toHaveLength(5);
  });
});

describe('the rehire warning', () => {
  const match: RehireMatch = { employeeId: 'e1', fullNameEn: 'Leo Leaver', leftOn: '2026-10-21', endReason: 'terminated', eligibility: 'not_eligible', reason: 'Misconduct', matchedBy: 'email' };

  it('says who, when they left and their eligibility; a strong one when not eligible', () => {
    expect(rehireWarningText(match)).toBe('Leo Leaver (the same email) left on 21/10/2026. Rehire: Not eligible: Misconduct');
    expect(rehireWarningText({ ...match, eligibility: null, matchedBy: 'employee' })).toBe('Leo Leaver left on 21/10/2026. No rehire decision was recorded.');
    expect(strongWarning([match])).toBe(true);
    expect(strongWarning([{ ...match, eligibility: 'eligible' }])).toBe(false);
  });
});

describe('the clearance form', () => {
  const c = {
    employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Leo <Leaver>' },
    jobTitle: 'Editor',
    department: 'Production',
    joinDate: '2025-03-01',
    lastWorkingDay: '2026-10-21',
    endReason: 'terminated',
    items: [
      { id: 'i1', kind: 'assets', label: 'Assets returned', owner: 'assets', status: 'done', doneBy: 'The system', doneAt: null, note: null, canMark: false },
      { id: 'i2', kind: 'manual', label: 'Access cards and keys returned', owner: 'admin', status: 'pending', doneBy: null, doneAt: null, note: 'Two cards', canMark: true },
      { id: 'i3', kind: 'manual', label: 'Email and system accounts disabled', owner: 'admin', status: 'not_applicable', doneBy: 'Adam', doneAt: '2026-10-21T10:00:00Z', note: null, canMark: true },
    ],
    holdings: [{ assetCode: 'PK-CAM-0001', assetName: 'Camera', custodyCode: 'CUS-0001', custodyKind: 'assignment', dueDate: null }],
  } as unknown as OffboardingCaseView;

  it('prints who is leaving, every item with its owner and state, what they still hold, and a signature for each owner once', () => {
    const html = clearanceFormMarkup(c, { company: 'TrendLIX', logoSrc: null });
    expect(html).toContain('Clearance Form');
    expect(html).toContain('Leo &lt;Leaver&gt;');
    expect(html).not.toContain('<Leaver>');
    expect(html).toContain('Access cards and keys returned');
    expect(html).toContain('Not applicable');
    expect(html).toContain('PK-CAM-0001');
    expect(html).toContain('Terminated');
    expect(signingOwners(c)).toEqual(['assets', 'admin']);
    expect(html.match(/class="signature"/g)).toHaveLength(3);
  });
});
