import { describe, expect, it } from 'vitest';
import type { StaffingUnitView } from '@trendlix/shared';
import { editsStaffing } from './setup';
import { limitNowText, peopleNowText, STAFFING_HREF, staffingBody, staffingGroups, staffingSavedText, takesLimit, unitLimitText } from './staffing';

// Organization → Leave → Staffing (owner, 25 October 2026: "Warn and need HR"): the teams' limits for annual leave.

const unit = (u: Partial<StaffingUnitView> & Pick<StaffingUnitView, 'id' | 'nameEn'>): StaffingUnitView => ({
  parent: null,
  team: false,
  hasTeams: false,
  members: 0,
  limit: null,
  updatedAt: null,
  ...u,
});

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe('Staffing', () => {
  it('lists each department with its teams under it', () => {
    const creative = unit({ id: 'd1', nameEn: 'Creative', hasTeams: true, members: 6 });
    const video = unit({ id: 't1', nameEn: 'Video', team: true, parent: { id: 'd1', nameEn: 'Creative' }, members: 4 });
    const design = unit({ id: 't2', nameEn: 'Design', team: true, parent: { id: 'd1', nameEn: 'Creative' }, members: 2 });
    const finance = unit({ id: 'd2', nameEn: 'Finance', members: 3 });
    const groups = staffingGroups([creative, video, design, finance]);
    expect(groups.map((g) => [g.department.nameEn, g.teams.map((t) => t.nameEn)])).toEqual([
      ['Creative', ['Video', 'Design']],
      ['Finance', []],
    ]);
    // a team whose department isn't listed stands on its own
    expect(staffingGroups([video]).map((g) => g.department.nameEn)).toEqual(['Video']);
  });

  it('says each row’s limit: a team’s, a department’s without teams, never a department’s with teams', () => {
    expect(unitLimitText(unit({ id: 't', nameEn: 'Video', team: true, limit: { maxOff: 2, minAtWorkPercent: 50 } }))).toBe('At most 2 people on annual leave at once · At least 50% at work');
    expect(unitLimitText(unit({ id: 'd', nameEn: 'Finance', limit: { maxOff: 1, minAtWorkPercent: null } }))).toBe('At most 1 person on annual leave at once');
    expect(unitLimitText(unit({ id: 'd', nameEn: 'Finance' }))).toBe('No limit');
    expect(unitLimitText(unit({ id: 'd', nameEn: 'Creative', hasTeams: true }))).toBe('Set on its teams');
    expect(takesLimit({ team: false, hasTeams: true })).toBe(false);
    expect(takesLimit({ team: true, hasTeams: false })).toBe(true);
  });

  it('says what the limit means with the people now', () => {
    expect(limitNowText(unit({ id: 't', nameEn: 'Video', team: true, members: 4, limit: { maxOff: 2, minAtWorkPercent: null } }))).toBe('With 4 people now, at least 2 are at work on any day.');
    // 50% of 3 is 2, rounded up; the stricter of the two wins
    expect(limitNowText(unit({ id: 't', nameEn: 'Video', team: true, members: 3, limit: { maxOff: 2, minAtWorkPercent: 50 } }))).toBe('With 3 people now, at least 2 are at work on any day.');
    expect(limitNowText(unit({ id: 't', nameEn: 'Video', team: true, members: 2, limit: { maxOff: 1, minAtWorkPercent: null } }))).toBe('With 2 people now, at least 1 is at work on any day.');
    expect(limitNowText(unit({ id: 't', nameEn: 'Video', team: true, members: 0, limit: { maxOff: 1, minAtWorkPercent: null } }))).toBeNull();
    expect(limitNowText(unit({ id: 't', nameEn: 'Video', team: true, members: 4 }))).toBeNull();
    expect(peopleNowText(1)).toBe('1 person');
    expect(peopleNowText(0)).toBe('Nobody yet');
  });

  it('reads a row’s form: whole numbers or empty, both empty removes it', () => {
    expect(staffingBody(form({ maxOff: '2', minAtWorkPercent: '50' }))).toEqual({ body: { maxOff: 2, minAtWorkPercent: 50 }, errors: [] });
    expect(staffingBody(form({ maxOff: '', minAtWorkPercent: '60%' }))).toEqual({ body: { maxOff: null, minAtWorkPercent: 60 }, errors: [] });
    expect(staffingBody(form({ maxOff: '٢', minAtWorkPercent: '' }))).toEqual({ body: { maxOff: 2, minAtWorkPercent: null }, errors: [] });
    expect(staffingBody(form({ maxOff: '', minAtWorkPercent: '' }))).toEqual({ body: { maxOff: null, minAtWorkPercent: null }, errors: [] });
    expect(staffingBody(form({ maxOff: '1.5', minAtWorkPercent: '0' })).errors).toEqual([
      'Enter the most people on annual leave at once as a whole number from 0 to 500, or leave it empty.',
      'Enter the least share at work as a whole percent from 1 to 100, or leave it empty.',
    ]);
    expect(staffingBody(form({ maxOff: '501', minAtWorkPercent: '101' })).errors).toHaveLength(2);
  });

  it('says what was saved, and who sets it', () => {
    expect(staffingSavedText('Video', { maxOff: 2, minAtWorkPercent: 50 })).toBe('Saved: Video, at most 2 people on annual leave at once · at least 50% at work.');
    expect(staffingSavedText('Video', { maxOff: null, minAtWorkPercent: 75 })).toBe('Saved: Video, at least 75% at work.');
    expect(staffingSavedText('Video', { maxOff: null, minAtWorkPercent: null })).toBe('Video has no staffing limit now.');
    expect(editsStaffing({ roles: ['hr'] })).toBe(true);
    expect(editsStaffing({ roles: ['super_admin'] })).toBe(true);
    expect(editsStaffing({ roles: ['ceo'] })).toBe(false);
    expect(editsStaffing({ roles: ['admin'] })).toBe(false);
    expect(STAFFING_HREF).toBe('/organization/leave#staffing');
  });
});
