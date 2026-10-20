import { describe, expect, it } from 'vitest';
import type { HomeLocationView } from '../../../lib/home-location-types';
import {
  APPROVALS_HOME_DONE,
  approvedHomeOf,
  asksHome,
  decidingAsTitle,
  employeeHomeApi,
  homeAskBody,
  homeCircle,
  homeDecisionBody,
  homeDecisionButton,
  homeDoneHref,
  homeDoneText,
  homeLocationHref,
  homeMapLabel,
  homeProgressText,
  homeRemoveBody,
  homesLabel,
  homeSourceText,
  homeStepText,
  homeStepTone,
  homeWhatText,
  MY_HOMES_HREF,
  officeLockHint,
  profileHomeText,
  radiusText,
  seesHomes,
} from './home-locations';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"): the addresses, the words, the forms read
// as the API takes them, and the office network's hint for Office staff. Every person and point here is invented.

const ID = '00000000-0000-4000-8000-000000000001';
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const base = {
  id: ID,
  kind: 'home',
  employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Walid Ali', fullNameAr: 'وليد علي', department: 'Design', team: null, workArrangement: 'wfh', checkInAnywhere: false },
  latitude: 30.101234,
  longitude: 31.380123,
  label: 'Home, Nasr City',
  radiusMetres: 100,
  accuracyMetres: 12,
  status: 'with_hr',
  stage: 'hr',
  waitingForYou: false,
  confidential: false,
  canWithdraw: true,
  canRemove: false,
  rejectedStage: null,
  rejectReason: null,
  approvedAt: null,
  endedAt: null,
  steps: [],
  createdAt: '2026-10-20T10:00:00.000Z',
} satisfies HomeLocationView;
const home = (more: Partial<HomeLocationView> = {}): HomeLocationView => ({ ...base, ...more });

describe('the addresses', () => {
  it('opens a request, says what was done, and finds a person’s approved home', () => {
    expect(homeLocationHref(ID)).toBe(`/home-locations/${ID}`);
    expect(homeDoneHref(ID, 'sent')).toBe(`/home-locations/${ID}?done=sent`);
    expect(homeDoneHref(ID, 'hr_approve')).toBe(`/home-locations/${ID}?done=hr_approve`);
    expect(MY_HOMES_HREF).toBe('/my-requests#my-home-location');
    expect(employeeHomeApi('e1')).toBe('/home-locations?employeeId=e1&status=approved');
  });

  it('is HR’s, the CEO’s and the Super Admin’s to see; never managers’, Finance’s or an Admin’s', () => {
    expect(seesHomes({ roles: ['hr'] }) && seesHomes({ roles: ['ceo'] }) && seesHomes({ roles: ['super_admin'] })).toBe(true);
    expect([seesHomes({ roles: ['manager'] }), seesHomes({ roles: ['finance'] }), seesHomes({ roles: ['admin'] }), seesHomes({ roles: ['employee'] })]).toEqual([false, false, false, false]);
  });
});

describe('the words', () => {
  it('says where it stands', () => {
    expect(homeProgressText(home()).text).toBe('With HR, who decides it first; then the CEO');
    expect(homeProgressText(home({ confidential: true })).text).toBe('With the CEO, who takes HR’s step and then decides it');
    expect(homeProgressText(home({ status: 'with_ceo' })).text).toBe('HR approved it: with the CEO now');
    expect(homeProgressText(home({ status: 'approved', approvedAt: '2026-10-20T11:00:00.000Z', radiusMetres: 150 })).text).toBe(
      'Approved 20/10/2026: a check-in within 150 m of it shows as Home',
    );
    expect(homeProgressText(home({ status: 'rejected', rejectedStage: 'ceo', rejectReason: 'Not needed' }))).toEqual({ text: 'Rejected by the CEO', reason: 'Not needed' });
    expect(homeProgressText(home({ status: 'rejected', rejectedStage: 'hr', rejectReason: 'No' })).text).toBe('Rejected by HR');
    expect(homeProgressText(home({ status: 'replaced' })).text).toBe('Replaced by a newer home location: its point is deleted');
    expect(homeProgressText(home({ status: 'removed' })).text).toBe('Removed: its point is deleted');
    expect(homeProgressText(home({ status: 'withdrawn' })).text).toBe('Withdrawn while it was being decided: its point is deleted');
  });

  it('says what it is in a line, and its date and radius on the profile', () => {
    expect(homeWhatText(home())).toBe('Home, Nasr City · 100 m');
    expect(homeWhatText(home({ label: null, radiusMetres: 1200 }))).toBe('Point on the map · 1,200 m');
    expect(homeWhatText(home({ latitude: null, longitude: null, label: null }))).toBe('Point deleted');
    expect(profileHomeText(home({ approvedAt: '2026-10-20T11:00:00.000Z' }))).toBe('Home location: approved 20/10/2026 · 100 m');
    expect(radiusText(5000)).toBe('5,000 m');
    expect(homesLabel(1)).toBe('1 home location request');
    expect(homesLabel(3)).toBe('3 home location requests');
    expect(homeSourceText(12)).toBe('Read on the employee’s device, within ±12 m');
    expect(homeSourceText(null)).toBe('Put on the map by the employee');
  });

  it('words each step, a C-level person’s HR step as the CEO’s', () => {
    expect(homeStepText({ kind: 'submitted', decision: null, radiusMetres: 100 })).toBe('Asked for by the employee, 100 m to start with');
    expect(homeStepText({ kind: 'hr_decision', decision: 'approve', radiusMetres: 150 })).toBe('HR approved it, within 150 m');
    expect(homeStepText({ kind: 'hr_decision', decision: 'approve', radiusMetres: 150 }, true)).toBe('Approved at HR’s step, within 150 m');
    expect(homeStepText({ kind: 'hr_decision', decision: 'reject', radiusMetres: null })).toBe('HR rejected it');
    expect(homeStepText({ kind: 'ceo_decision', decision: 'approve', radiusMetres: null })).toBe('The CEO approved it: in force');
    expect(homeStepText({ kind: 'removed', decision: null, radiusMetres: null })).toBe('Removed: its point deleted');
    expect([homeStepTone({ kind: 'hr_decision', decision: 'approve' }), homeStepTone({ kind: 'ceo_decision', decision: 'reject' }), homeStepTone({ kind: 'submitted', decision: null })]).toEqual([
      'ok',
      'danger',
      null,
    ]);
  });

  it('says what was just done', () => {
    expect(homeDoneText({ done: 'sent' }, home())?.text).toBe('Sent. HR decides it first, then the CEO; you can follow it here.');
    expect(homeDoneText({ done: 'sent' }, home({ confidential: true }))?.text).toBe('Sent. The CEO decides it; you can follow it here.');
    expect(homeDoneText({ done: 'hr_approve' }, home())?.text).toBe('Approved at HR’s step: it is with the CEO now.');
    expect(homeDoneText({ done: 'ceo_approve' }, home())?.text).toBe('Approved: check-ins within it now show as Home.');
    expect(homeDoneText({ done: 'ceo_reject' }, home())?.text).toContain('its point is deleted');
    expect(homeDoneText({ done: 'moved' }, home())?.tone).toBe('warn');
    expect(homeDoneText({ done: 'nonsense' }, home())).toBeNull();
    expect(homeDoneText({}, home())).toBeNull();
    expect(Object.keys(APPROVALS_HOME_DONE)).toEqual(['home-hr-approve', 'home-ceo-approve', 'home-hr-reject', 'home-ceo-reject']);
  });

  it('titles the decision by its step', () => {
    expect(decidingAsTitle('hr')).toBe('Your Decision as HR');
    expect(decidingAsTitle('hr', true)).toBe('Your Decision as the CEO, at HR’s Step');
    expect(decidingAsTitle('ceo')).toBe('Your Decision as the CEO');
    expect(homeDecisionButton('approve', 'hr').label).toBe('Approve and send to the CEO');
    expect(homeDecisionButton('approve', 'hr', true).label).toBe('Approve HR’s step');
    expect(homeDecisionButton('approve', 'ceo').label).toBe('Approve the home location');
    expect(homeDecisionButton('reject', 'ceo').label).toBe('Reject the home location');
    expect(homeDecisionButton('', 'hr').label).toBe('Save the decision');
  });

  it('tells Office staff the office network’s lock still holds at home, unless HR lets them check in anywhere', () => {
    expect(officeLockHint({ workArrangement: 'office' })).toContain('a check-in from home is still refused off it');
    expect(officeLockHint({ workArrangement: 'office', checkInAnywhere: true })).toBeNull();
    expect(officeLockHint({ workArrangement: 'hybrid' })).toBeNull();
    expect(officeLockHint({ workArrangement: 'wfh' })).toBeNull();
    expect(officeLockHint(null)).toBeNull();
  });

  it('finds the home in force, and whether another may be asked now', () => {
    const approved = home({ id: 'a', status: 'approved' });
    expect(approvedHomeOf([home(), approved])?.id).toBe('a');
    expect(approvedHomeOf([home({ status: 'removed' })])).toBeNull();
    expect(asksHome([approved])).toBe(true);
    expect(asksHome([approved, home({ status: 'with_ceo' })])).toBe(false);
    expect(asksHome([])).toBe(true);
  });
});

describe('the map', () => {
  it('draws the point with its radius (another while HR types one), none once deleted', () => {
    expect(homeCircle(home())).toEqual({ latitude: 30.101234, longitude: 31.380123, radiusMetres: 100 });
    expect(homeCircle(home(), 250)).toEqual({ latitude: 30.101234, longitude: 31.380123, radiusMetres: 250 });
    expect(homeCircle(home({ latitude: null, longitude: null }))).toBeNull();
    expect(homeMapLabel(home())).toBe('Map of Walid Ali’s home location and the 100 m around it');
    expect(homeMapLabel(home(), true)).toBe('Map of your home location and the 100 m around it');
  });
});

describe('the forms', () => {
  it('reads the employee’s request: the point to 6 decimals, the accuracy read, a tidied label', () => {
    expect(homeAskBody(form({ latitude: '30.1012345', longitude: '31.3801234', accuracy: '12.4', label: '  Home,  Nasr City ' }))).toEqual({
      body: { latitude: 30.101235, longitude: 31.380123, accuracy: 12, label: 'Home, Nasr City' },
      errors: [],
    });
    // put on the map: no accuracy, no label
    expect(homeAskBody(form({ latitude: '30.1', longitude: '31.3', accuracy: '', label: '' }))).toEqual({ body: { latitude: 30.1, longitude: 31.3 }, errors: [] });
    // Arabic digits as a phone may type them
    expect(homeAskBody(form({ latitude: '٣٠٫١', longitude: '٣١٫٣' })).body).toEqual({ latitude: 30.1, longitude: 31.3 });
  });

  it('refuses a request without a point on the map, or a label too long', () => {
    expect(homeAskBody(form({ latitude: '', longitude: '' }))).toEqual({ body: null, errors: ['Put your home on the map, or use your current location while at home.'] });
    expect(homeAskBody(form({ latitude: 'abc', longitude: '31' })).errors).toEqual(['Put your home on the map, or use your current location while at home.']);
    expect(homeAskBody(form({ latitude: '30', longitude: '31', label: 'x'.repeat(201) })).errors).toEqual(['Keep the label to 200 characters or fewer.']);
  });

  it('reads a decision: HR’s approval with the radius, a rejection with its comment, the CEO’s without a radius', () => {
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '150', comment: 'Checked' }), 'hr')).toEqual({
      body: { decision: 'approve', radiusMetres: 150, comment: 'Checked' },
      errors: [],
    });
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '١٢٠' }), 'hr').body).toEqual({ decision: 'approve', radiusMetres: 120 });
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '9000' }), 'hr').errors).toEqual(['Enter the radius in whole metres from 20 to 5,000, e.g. 100.']);
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '' }), 'hr').errors).toHaveLength(1);
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '9000' }), 'ceo')).toEqual({ body: { decision: 'approve' }, errors: [] });
    expect(homeDecisionBody(form({ decision: 'reject', radiusMetres: '150' }), 'hr').errors).toEqual(['Write your comment: why the home location is rejected.']);
    expect(homeDecisionBody(form({ decision: 'reject', comment: 'Not a home', radiusMetres: '150' }), 'hr').body).toEqual({ decision: 'reject', comment: 'Not a home' });
    expect(homeDecisionBody(form({}), 'hr').errors).toEqual(['Choose your decision: approve or reject.']);
  });

  it('reads HR’s removal: a comment if given', () => {
    expect(homeRemoveBody(form({ comment: ' Moved ' }))).toEqual({ comment: 'Moved' });
    expect(homeRemoveBody(form({ comment: '' }))).toEqual({});
    expect(homeRemoveBody(undefined)).toEqual({});
  });
});
