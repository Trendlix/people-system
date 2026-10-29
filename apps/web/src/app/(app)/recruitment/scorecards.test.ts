import { describe, expect, it } from 'vitest';
import { ownScorecardRole, scorecardDue, scorecardHeading, scorecardHref, scorecardRoleLabel, scorecardSummary } from './scorecards';

// Scorecards from HR and the hiring manager (owner, 29 October 2026: "then there should be interview comment and status
// for HR and hiring manager"; asked, "Score Card for each of them"). Every id here is invented.

const panel = [
  { employeeId: 'ivan', name: 'Ivan', feedbackGiven: true },
  { employeeId: 'iris', name: 'Iris', feedbackGiven: false },
];
const open = { reschedule: false, cancel: false, mark: false, feedback: true, meeting: false };

describe('a scorecard’s role', () => {
  it('is said on its badge; none from an API that didn’t say', () => {
    expect(scorecardRoleLabel({ role: 'interviewer' })).toBe('Interviewer');
    expect(scorecardRoleLabel({ role: 'hiring_manager' })).toBe('Hiring manager');
    expect(scorecardRoleLabel({ role: 'hr' })).toBe('HR');
    expect(scorecardRoleLabel({})).toBeNull();
  });

  it('of one’s own is an interviewer’s on the panel, else the hiring manager’s, else HR’s', () => {
    expect(ownScorecardRole({ interviewers: panel }, 'ivan', 'ivan')).toBe('interviewer');
    expect(ownScorecardRole({ interviewers: panel }, 'hana', 'hana')).toBe('hiring_manager');
    expect(ownScorecardRole({ interviewers: panel }, 'hadi', 'hana')).toBe('hr');
    expect(ownScorecardRole({ interviewers: panel }, 'hadi', null)).toBe('hr');
  });

  it('heads the form', () => {
    expect(scorecardHeading(false, 'interviewer')).toBe('Give your scorecard');
    expect(scorecardHeading(true, 'interviewer')).toBe('Your scorecard');
    expect(scorecardHeading(false, 'hiring_manager')).toBe('Give your scorecard as the hiring manager');
    expect(scorecardHeading(true, 'hr')).toBe('Your scorecard as HR');
  });
});

describe('the scorecards’ line', () => {
  it('says HR’s, the hiring manager’s and the interviewers’ recommendations', () => {
    expect(
      scorecardSummary([
        { role: 'interviewer', recommendation: 'yes' },
        { role: 'hr', recommendation: 'yes' },
        { role: 'interviewer', recommendation: 'no' },
        { role: 'hiring_manager', recommendation: 'strong_yes' },
      ]),
    ).toBe('Scorecards: HR Yes · Hiring manager Strong yes · 2 interviewers (1 Yes, 1 No)');
  });

  it('counts several of HR’s or the hiring manager’s, in the recommendations’ order', () => {
    expect(
      scorecardSummary([
        { role: 'hr', recommendation: 'no' },
        { role: 'hr', recommendation: 'strong_yes' },
        { role: 'hiring_manager', recommendation: 'yes' },
        { role: 'hiring_manager', recommendation: 'yes' },
      ]),
    ).toBe('Scorecards: 2 from HR (1 Strong yes, 1 No) · 2 from the hiring manager (2 Yes)');
    expect(scorecardSummary([{ role: 'interviewer', recommendation: 'strong_no' }])).toBe('Scorecards: 1 interviewer (Strong no)');
  });

  it('takes one without its role (an earlier API) for an interviewer’s, and says nothing for none', () => {
    expect(scorecardSummary([{ recommendation: 'yes' }, { role: 'hr', recommendation: 'no' }])).toBe('Scorecards: HR No · 1 interviewer (Yes)');
    expect(scorecardSummary([])).toBeNull();
  });
});

describe('a scorecard due', () => {
  it('is one the API lets them give and they haven’t, on the panel or not', () => {
    expect(scorecardDue({ can: open, interviewers: panel, myFeedbackGiven: false }, 'hana')).toBe(true);
    expect(scorecardDue({ can: open, interviewers: panel, myFeedbackGiven: true }, 'hana')).toBe(false);
    expect(scorecardDue({ can: { ...open, feedback: false }, interviewers: panel, myFeedbackGiven: false }, 'hana')).toBe(false);
  });

  it('from an API before it, only an interviewer’s', () => {
    expect(scorecardDue({ can: open, interviewers: panel }, 'iris')).toBe(true);
    expect(scorecardDue({ can: open, interviewers: panel }, 'ivan')).toBe(false);
    expect(scorecardDue({ can: open, interviewers: panel }, 'hana')).toBe(false);
    expect(scorecardDue({ can: open, interviewers: panel }, null)).toBe(false);
  });

  it('is given on the applicant’s interviews', () => {
    expect(scorecardHref('abc')).toBe('/recruitment/applicants/abc#applicant-interviews');
  });
});
