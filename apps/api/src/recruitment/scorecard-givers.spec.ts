import { givenScorecardRole, scorecardRole, scoresAsHr } from './scorecard-givers.js';

// Who gives a scorecard on an interview (owner, 29 October 2026: "then there should be interview comment and status for
// HR and hiring manager"; asked, "Score Card for each of them"). Every id here is invented.

const interview = { interviewerIds: ['ivan', 'iris'], hiringManagerId: 'hana' };

describe('HR scoring', () => {
  it('is HR’s and a Super Admin’s; the CEO’s only on a C-level vacancy', () => {
    expect(scoresAsHr({ manages: true, user: { roles: ['hr'] } }, false)).toBe(true);
    expect(scoresAsHr({ manages: true, user: { roles: ['super_admin'] } }, true)).toBe(true);
    expect(scoresAsHr({ manages: false, user: { roles: ['ceo'] } }, false)).toBe(false);
    expect(scoresAsHr({ manages: false, user: { roles: ['ceo'] } }, true)).toBe(true);
    expect(scoresAsHr({ manages: false, user: { roles: ['employee', 'manager'] } }, true)).toBe(false);
  });
});

describe('a scorecard’s role', () => {
  it('is an interviewer’s first, then the hiring manager’s, then HR’s', () => {
    expect(scorecardRole('ivan', interview, true)).toBe('interviewer');
    // the hiring manager on the panel scores as an interviewer
    expect(scorecardRole('hana', { ...interview, interviewerIds: ['hana'] }, true)).toBe('interviewer');
    expect(scorecardRole('hana', interview, false)).toBe('hiring_manager');
    expect(scorecardRole('hana', interview, true)).toBe('hiring_manager');
    expect(scorecardRole('hadi', interview, true)).toBe('hr');
  });

  it('is none for someone else, or without an employee profile', () => {
    expect(scorecardRole('omar', interview, false)).toBeNull();
    expect(scorecardRole(null, interview, true)).toBeNull();
    expect(scorecardRole(undefined, interview, true)).toBeNull();
    expect(scorecardRole('omar', { interviewerIds: [], hiringManagerId: null }, false)).toBeNull();
  });

  it('of one given is HR’s when neither an interviewer’s nor the hiring manager’s', () => {
    expect(givenScorecardRole('iris', interview)).toBe('interviewer');
    expect(givenScorecardRole('hana', interview)).toBe('hiring_manager');
    expect(givenScorecardRole('hadi', interview)).toBe('hr');
    expect(givenScorecardRole('hadi', { interviewerIds: [], hiringManagerId: null })).toBe('hr');
  });
});
