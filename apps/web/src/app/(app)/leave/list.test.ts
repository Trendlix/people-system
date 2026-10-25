import { describe, expect, it } from 'vitest';
import type { LeaveRequestView } from '../../../lib/types';
import {
  canSeeLeaveRequests,
  daysText,
  decidingAsTitle,
  defaultLeaveFilter,
  emptyLeaveText,
  hrCancelBody,
  hrStageName,
  LEAVE_COMMENT_READERS,
  LEAVE_FILTERS,
  leaveBack,
  leaveCalendarHref,
  leaveCommentReaders,
  leaveDecidedText,
  leaveDecisionBody,
  leaveDecisionButton,
  leaveDoneHref,
  leaveDoneText,
  leaveProgressText,
  leaveRequestsPath,
  leaveSentText,
  leaveStatusLabel,
  leaveStepText,
  leaveStepTone,
  leaveWhenText,
  periodText,
  placeOfEmployee,
  readLeaveFilter,
  readLeaveView,
  recordLeaveHref,
  recordsLeave,
  requestsLabel,
  stageTitle,
  standingInText,
  upcomingLeave,
  WAITING_LEAVE,
} from './list';

// invented people and requests
const ID = '0b8f2c1e-1111-4222-8333-444455556666';
const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

const request = (r: Partial<LeaveRequestView> = {}): LeaveRequestView => ({
  id: ID,
  employee: { id: ME, fullNameEn: 'Nour Adel', fullNameAr: 'نور عادل', department: 'Marketing', team: 'Content Team' },
  type: { id: 't1', key: 'annual', nameEn: 'Annual leave', nameAr: 'إجازة سنوية', paid: 'paid' },
  startDate: '2026-10-25',
  endDate: '2026-10-27',
  halfDay: false,
  days: 3,
  reason: null,
  status: 'with_manager',
  stage: 'manager',
  waitingForYou: false,
  canCancel: true,
  manager: { id: 'm1', fullNameEn: 'Omar Said' },
  rejectedStage: null,
  rejectReason: null,
  recordedByHr: false,
  documents: [],
  steps: [],
  balanceAfter: 18,
  createdAt: '2026-10-18T09:00:00.000Z',
  ...r,
});

describe('who sees leave requests (owner, 18 October 2026: "can you apply the leaves according to the law?")', () => {
  it('is HR, who decides and records them, and the CEO, who views them', () => {
    expect(canSeeLeaveRequests({ roles: ['hr'] })).toBe(true);
    expect(canSeeLeaveRequests({ roles: ['ceo'] })).toBe(true);
    expect(canSeeLeaveRequests({ roles: ['finance', 'manager', 'employee', 'admin', 'super_admin'] })).toBe(false);
    expect(recordsLeave({ roles: ['hr'] })).toBe(true);
    expect(recordsLeave({ roles: ['ceo'] })).toBe(false);
  });

  it('sends the request page back to the list, My Requests or My Team', () => {
    expect(leaveBack({ roles: ['hr'], employeeId: ME }, request())).toEqual({ href: '/leave', label: 'Leave Requests' });
    expect(leaveBack({ roles: ['employee'], employeeId: ME }, request())).toEqual({ href: '/my-requests#my-leave', label: 'My Requests' });
    expect(leaveBack({ roles: ['manager'], employeeId: 'other' }, request())).toEqual({ href: '/my-team', label: 'My Team' });
  });
});

describe('the list’s filters', () => {
  it('start with Waiting for you for HR and All for the CEO, then every status', () => {
    expect(LEAVE_FILTERS.map((f) => f.value)).toEqual(['waiting', 'all', 'with_manager', 'with_hr', 'approved', 'rejected', 'cancelled']);
    expect(defaultLeaveFilter({ roles: ['hr'] })).toBe('waiting');
    expect(defaultLeaveFilter({ roles: ['ceo'] })).toBe('all');
    expect(readLeaveFilter({ status: 'approved' }, { roles: ['hr'] })).toBe('approved');
    expect(readLeaveFilter({ status: 'nonsense' }, { roles: ['hr'] })).toBe('waiting');
    expect(readLeaveFilter({}, { roles: ['ceo'] })).toBe('all');
  });

  it('ask the API for the status, the employee or all', () => {
    expect(leaveRequestsPath('all')).toBe('/leave/requests');
    expect(leaveRequestsPath('approved', ME)).toBe(`/leave/requests?status=approved&employeeId=${ME}`);
    expect(WAITING_LEAVE).toBe('/leave/requests?status=waiting');
  });

  it('keep the view and the calendar’s month and department in the address', () => {
    expect(readLeaveView({ view: 'calendar' })).toBe('calendar');
    expect(readLeaveView({})).toBe('list');
    expect(leaveCalendarHref('2026-11')).toBe('/leave?view=calendar&month=2026-11');
    expect(leaveCalendarHref('2026-11', ID)).toBe(`/leave?view=calendar&month=2026-11&department=${ID}`);
    // My Team's calendar has no view to name
    expect(leaveCalendarHref('2026-11', null, '/my-team')).toBe('/my-team?month=2026-11');
    expect(recordLeaveHref(ME)).toBe(`/leave/record?employee=${ME}`);
    expect(recordLeaveHref()).toBe('/leave/record');
    expect(leaveDoneHref(ID, 'hr_approve')).toBe(`/leave/${ID}?done=hr_approve`);
  });

  it('say so when nothing has the filter', () => {
    expect(emptyLeaveText('waiting')).toBe('No leave requests are waiting for you.');
    expect(requestsLabel(1)).toBe('1 request');
    expect(requestsLabel(4)).toBe('4 requests');
  });

  it('group by department and team, whichever way the API sends them', () => {
    expect(placeOfEmployee({ department: 'Marketing', team: 'Content Team' })).toBe('Marketing › Content Team');
    expect(placeOfEmployee({ department: 'Marketing › Content Team', team: 'Content Team' })).toBe('Marketing › Content Team');
    expect(placeOfEmployee({ department: 'Finance', team: null })).toBe('Finance');
    expect(placeOfEmployee({ department: null, team: null })).toBeNull();
  });
});

describe('a request in words', () => {
  it('says its days, half days too', () => {
    expect(daysText(1)).toBe('1 day');
    expect(daysText(2.5)).toBe('2.5 days');
    expect(daysText(0.5)).toBe('Half a day');
    expect(daysText(0)).toBe('0 days');
  });

  it('says when: one day with its weekday, or from the first to the last', () => {
    expect(periodText({ startDate: '2026-10-25', endDate: '2026-10-25', halfDay: false })).toBe('Sunday 25/10/2026');
    expect(periodText({ startDate: '2026-10-25', endDate: '2026-10-25', halfDay: true })).toBe('Sunday 25/10/2026 · half a day');
    expect(periodText({ startDate: '2026-10-25', endDate: '2026-10-27', halfDay: false })).toBe('25/10/2026 – 27/10/2026');
  });

  it('says where it stands, with the comment of a rejection or a cancellation', () => {
    expect(leaveProgressText(request())).toEqual({ text: 'With the direct manager (Omar Said)', reason: null });
    expect(leaveProgressText(request({ status: 'with_hr' })).text).toBe('Waiting for HR');
    expect(leaveProgressText(request({ status: 'rejected', rejectedStage: 'hr', rejectReason: ' Busy week ' }))).toEqual({ text: 'Rejected by HR', reason: 'Busy week' });
    expect(leaveProgressText(request({ status: 'approved', recordedByHr: true })).text).toBe('Recorded by HR');
    expect(leaveProgressText(request({ status: 'approved' })).text).toBe('Approved');
    const cancelled = request({ status: 'cancelled', steps: [{ id: '1', kind: 'cancelled', decision: null, comment: 'Came back early', actor: 'Mona (HR)', at: '2026-10-26T10:00:00Z' }] });
    expect(leaveProgressText(cancelled)).toEqual({ text: 'Cancelled by Mona (HR)', reason: 'Came back early' });
  });

  it('names who has it at the manager stage: the direct manager, or the team lead or head of department of someone without one (19 October 2026)', () => {
    expect(leaveProgressText(request({ manager: { id: 'l1', fullNameEn: 'Sara Ali', role: 'team_lead' } })).text).toBe('With the team lead (Sara Ali)');
    expect(leaveProgressText(request({ manager: { id: 'h1', fullNameEn: 'Hazem Magdy', role: 'department_head' } })).text).toBe(
      'With the head of department (Hazem Magdy)',
    );
    expect(leaveProgressText(request({ manager: { id: 'm1', fullNameEn: 'Omar Said', role: 'direct_manager' } })).text).toBe('With the direct manager (Omar Said)');
    // an API from before it: the direct manager
    expect(leaveProgressText(request({ manager: { id: 'm1', fullNameEn: 'Omar Said', role: null } })).text).toBe('With the direct manager (Omar Said)');
    expect(leaveProgressText(request({ manager: null })).text).toBe('With the direct manager');
    expect(leaveProgressText(request({ status: 'rejected', rejectedStage: 'manager', manager: { id: 'l1', fullNameEn: 'Sara Ali', role: 'team_lead' } })).text).toBe(
      'Rejected by the team lead',
    );
    expect(leaveProgressText(request({ status: 'rejected', rejectedStage: 'manager' })).text).toBe('Rejected by the direct manager');
    expect(stageTitle('manager', { role: 'team_lead' })).toBe('the Team Lead');
    expect(stageTitle('manager', { role: 'department_head' })).toBe('the Head of Department');
    expect(stageTitle('manager', null)).toBe('the Direct Manager');
    expect(stageTitle('hr', { role: 'team_lead' })).toBe('HR');
    expect(leaveDoneText({ done: 'sent' }, 'with_manager', { role: 'team_lead' })?.text).toBe(
      'Request sent. It goes to your team lead, then HR; each step shows on the request.',
    );
    expect(leaveDoneText({ done: 'sent' }, 'with_manager', { role: 'department_head' })?.text).toBe(
      'Request sent. It goes to your head of department, then HR; each step shows on the request.',
    );
  });

  it('words each step of its log, and marks the decisions', () => {
    expect(leaveStepText({ kind: 'submitted', decision: null, comment: null })).toBe('Asked for by the employee');
    expect(leaveStepText({ kind: 'no_manager', decision: null, comment: null })).toBe('No direct manager or lead: sent straight to HR');
    expect(leaveStepText({ kind: 'recorded_by_hr', decision: null, comment: null })).toBe('Recorded by HR, approved at once');
    expect(leaveStepText({ kind: 'manager_decision', decision: 'approve', comment: null })).toBe('The direct manager approved it');
    expect(leaveStepText({ kind: 'hr_decision', decision: 'reject', comment: 'No' })).toBe('HR rejected it');
    // the manager stage by who decides it (19 October 2026)
    expect(leaveStepText({ kind: 'manager_decision', decision: 'reject', comment: 'No' }, { role: 'team_lead' })).toBe('The team lead rejected it');
    expect(leaveStepText({ kind: 'manager_decision', decision: 'approve', comment: null }, { role: 'department_head' })).toBe('The head of department approved it');
    expect(leaveStepText({ kind: 'hr_decision', decision: 'approve', comment: null }, { role: 'team_lead' })).toBe('HR approved it');
    expect(leaveStepTone({ kind: 'hr_decision', decision: 'reject' })).toBe('danger');
    expect(leaveStepTone({ kind: 'recorded_by_hr', decision: null })).toBe('ok');
    expect(leaveStepTone({ kind: 'submitted', decision: null })).toBeNull();
    // leave coverage (25 October 2026): the cover changed by the employee, and a stand-in's decision
    expect(leaveStepText({ kind: 'cover_changed', decision: null, comment: null })).toBe('Cover changed');
    expect(standingInText({ fullNameEn: 'Ahmed Ali' })).toBe('standing in for Ahmed Ali');
    expect(standingInText(null)).toBeNull();
    expect(leaveDoneText({ done: 'cover' }, 'with_manager')?.text).toMatch(/^Cover saved/);
  });

  it('says what was just done on its page', () => {
    expect(leaveDoneText({ done: 'sent' }, 'with_manager')).toEqual({ text: 'Request sent. It goes to your direct manager, then HR; each step shows on the request.', tone: 'ok' });
    expect(leaveDoneText({ done: 'sent' }, 'with_hr')?.text).toBe('Request sent. It goes to HR; each step shows on the request.');
    expect(leaveDoneText({ done: 'recorded' }, 'approved')?.text).toContain('approved at once');
    expect(leaveDoneText({ done: 'moved' }, 'approved')?.tone).toBe('warn');
    expect(leaveDoneText({ done: 'manager_approve' }, 'with_hr')?.text).toBe('Approved: the request goes to HR.');
    expect(leaveDoneText({ done: 'hr_reject' }, 'rejected')?.text).toBe('Request rejected. The employee sees your comment.');
    expect(leaveDoneText({ done: 'finance_approve' }, 'approved')).toBeNull();
    expect(leaveDoneText({}, 'approved')).toBeNull();
    expect(leaveDecidedText('approve', 'hr')).toBe('Approved: the leave counts in the balance and in the month’s payroll.');
  });
});

describe('deciding a request', () => {
  it('needs a decision, and a comment to reject', () => {
    expect(leaveDecisionBody(fd({}))).toEqual({ body: null, errors: ['Choose your decision: approve or reject.'] });
    expect(leaveDecisionBody(fd({ decision: 'approve' }))).toEqual({ body: { decision: 'approve' }, errors: [] });
    expect(leaveDecisionBody(fd({ decision: 'approve', comment: ' Enjoy ' }))).toEqual({ body: { decision: 'approve', comment: 'Enjoy' }, errors: [] });
    expect(leaveDecisionBody(fd({ decision: 'reject', comment: ' ' }))).toEqual({ body: null, errors: ['Write your comment: why the request is rejected.'] });
    expect(leaveDecisionBody(fd({ decision: 'reject', comment: 'Month end' })).body).toEqual({ decision: 'reject', comment: 'Month end' });
  });

  it('says on its button where the request goes next', () => {
    expect(leaveDecisionButton('approve', 'manager').label).toBe('Approve and send to HR');
    expect(leaveDecisionButton('approve', 'hr').label).toBe('Approve the leave');
    expect(leaveDecisionButton('reject', 'hr').label).toBe('Reject the request');
    expect(leaveDecisionButton('', 'hr').label).toBe('Save the decision');
  });

  it('needs HR’s comment to cancel an approved one', () => {
    expect(hrCancelBody(fd({ comment: ' ' })).body).toBeNull();
    expect(hrCancelBody(fd({ comment: 'Recorded twice' })).body).toEqual({ comment: 'Recorded twice' });
    // a permission's (19 October 2026), worded for it
    expect(hrCancelBody(fd({ comment: '' }), 'permission').errors).toEqual(['Write why the permission is cancelled: the employee sees it.']);
  });
});

describe('the employee’s leave coming up, on their dashboard', () => {
  const list = [
    request({ id: 'a', status: 'approved', startDate: '2026-11-10', endDate: '2026-11-12' }),
    request({ id: 'b', status: 'with_hr', startDate: '2026-10-20', endDate: '2026-10-21' }),
    request({ id: 'c', status: 'approved', startDate: '2026-10-01', endDate: '2026-10-02' }),
    request({ id: 'd', status: 'rejected', startDate: '2026-12-01', endDate: '2026-12-01' }),
    request({ id: 'e', status: 'approved', startDate: '2026-10-17', endDate: '2026-10-19' }),
  ];

  it('is the approved and the waiting ones not over yet, the soonest first', () => {
    expect(upcomingLeave(list, '2026-10-18').map((r) => r.id)).toEqual(['e', 'b', 'a']);
    expect(upcomingLeave(list, '2026-10-18', 1).map((r) => r.id)).toEqual(['e']);
  });

  it('says how far off it is, or that it is under way', () => {
    expect(leaveWhenText({ startDate: '2026-10-19', endDate: '2026-10-19' }, '2026-10-18')).toBe('Tomorrow');
    expect(leaveWhenText({ startDate: '2026-10-23', endDate: '2026-10-25' }, '2026-10-18')).toBe('In 5 days');
    expect(leaveWhenText({ startDate: '2026-10-17', endDate: '2026-10-19' }, '2026-10-18')).toBe('Under way, until 19/10/2026');
    expect(leaveWhenText({ startDate: '2026-10-17', endDate: '2026-10-18' }, '2026-10-18')).toBe('Ends today');
  });
});

describe('a C-level person’s request (owner, 19 October 2026: "make C level Employees details not visible to HR")', () => {
  const clevel = (r: Partial<LeaveRequestView> = {}) => request({ confidential: true, ...r });

  it('is with the CEO, not HR, while HR’s stage waits', () => {
    expect(leaveStatusLabel('with_hr', true)).toBe('With the CEO');
    expect(leaveStatusLabel('with_hr', false)).toBe('With HR');
    expect(leaveStatusLabel('with_hr')).toBe('With HR');
    expect(leaveStatusLabel('with_manager', true)).toBe('With the manager');
    expect(leaveStatusLabel('approved', true)).toBe('Approved');
    expect(leaveProgressText(clevel({ status: 'with_hr', stage: 'hr' })).text).toBe('Waiting for the CEO');
    expect(leaveProgressText(request({ status: 'with_hr', stage: 'hr' })).text).toBe('Waiting for HR');
    expect(hrStageName(true)).toBe('the CEO');
    expect(hrStageName(undefined)).toBe('HR');
  });

  it('goes on to the CEO once the manager approves it', () => {
    expect(leaveDecisionButton('approve', 'manager', true).label).toBe('Approve and send to the CEO');
    expect(leaveDecisionButton('approve', 'manager').label).toBe('Approve and send to HR');
    expect(leaveDecisionButton('approve', 'hr', true).label).toBe('Approve the leave');
    expect(leaveDecidedText('approve', 'manager', true)).toBe('Approved: the request goes to the CEO.');
    expect(leaveDoneText({ done: 'manager_approve' }, 'with_hr', null, true)?.text).toBe('Approved: the request goes to the CEO.');
    expect(leaveSentText('with_manager', null, true)).toBe('Request sent. It goes to your direct manager, then the CEO; each step shows on the request.');
    expect(leaveSentText('with_hr', null, true)).toBe('Request sent. It goes to the CEO; each step shows on the request.');
    expect(leaveDoneText({ done: 'sent' }, 'with_hr', null, true)?.text).toBe('Request sent. It goes to the CEO; each step shows on the request.');
  });

  it('names HR’s stage, not who decided it, once decided: the log says who', () => {
    expect(leaveStepText({ kind: 'hr_decision', decision: 'approve', comment: null }, null, true)).toBe('Approved at HR’s stage');
    expect(leaveStepText({ kind: 'hr_decision', decision: 'reject', comment: 'No' }, null, true)).toBe('Rejected at HR’s stage');
    expect(leaveStepText({ kind: 'hr_decision', decision: 'approve', comment: null }, null)).toBe('HR approved it');
    // the manager stage as before
    expect(leaveStepText({ kind: 'manager_decision', decision: 'approve', comment: null }, null, true)).toBe('The direct manager approved it');
    expect(leaveProgressText(clevel({ status: 'rejected', stage: null, rejectedStage: 'hr', rejectReason: 'Overlaps the board meeting' }))).toEqual({
      text: 'Rejected at HR’s stage',
      reason: 'Overlaps the board meeting',
    });
    expect(leaveProgressText(clevel({ status: 'rejected', stage: null, rejectedStage: 'manager', rejectReason: 'No' })).text).toBe('Rejected by the direct manager');
  });

  it('is decided as the CEO by the CEO, and as HR by HR with Super Admin', () => {
    expect(decidingAsTitle({ roles: ['ceo'] }, 'hr', null, true)).toBe('the CEO, at HR’s Stage');
    expect(decidingAsTitle({ roles: ['hr', 'super_admin'] }, 'hr', null, true)).toBe('HR');
    expect(decidingAsTitle({ roles: ['hr'] }, 'hr', null, false)).toBe('HR');
    expect(decidingAsTitle({ roles: ['ceo'] }, 'manager', { role: 'team_lead' }, true)).toBe('the Team Lead');
  });

  it('tells the approver HR doesn’t read the comment', () => {
    expect(leaveCommentReaders(true)).toBe('The employee sees your comment, and so do the direct manager, the CEO and the Super Admin.');
    expect(leaveCommentReaders(false)).toBe(LEAVE_COMMENT_READERS);
  });
});
