import { describe, expect, it } from 'vitest';
import type { HomeLocationView } from '../../../lib/home-location-types';
import {
  APPROVALS_HOME_DONE,
  approvedHomeOf,
  asksHome,
  decidingAsTitle,
  employeeHomeApi,
  employeePlacesApi,
  fromRefusal,
  HOME_TYPE_LINES,
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
  homeShownAs,
  homesApi,
  homeValidityBody,
  homeValidityText,
  homeWhatText,
  MY_HOMES_HREF,
  officeLockHint,
  openTypes,
  overlapText,
  placesInForce,
  placeStandingText,
  profileHomeText,
  profilePlaces,
  radiusText,
  seesHomes,
  startingValidity,
  validityChoices,
} from './home-locations';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"): the addresses, the words, the forms read
// as the API takes them, and the office network's hint for Office staff. Every person and point here is invented. Since
// 24 October 2026 (owner: "(Home Location - Remote Site - Client Location) with a comment reason"; "allow the HR to add an
// end date or lik it to the contract date"; "all employees if a customer location"): the types, how long one lasts, the
// overlaps, the profile's places, and the forms with them.

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
    expect(homesLabel(1)).toBe('1 check-in location request');
    expect(homesLabel(3)).toBe('3 check-in location requests');
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
    // one being decided at a time of each type (24 October 2026)
    expect(asksHome([approved, home({ status: 'with_ceo' })], 'home')).toBe(false);
    expect(asksHome([approved, home({ status: 'with_ceo' })], 'remote_site')).toBe(true);
    expect(asksHome([approved, home({ status: 'with_ceo' })])).toBe(true);
    expect(asksHome([home(), home({ type: 'remote_site' }), home({ type: 'client' })])).toBe(false);
    expect(openTypes([home(), home({ type: 'client', status: 'approved' })])).toEqual(['home']);
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
  const TODAY = '2026-10-24';
  const why = 'I work from home on Thursdays';

  it('reads the employee’s request: the type, the point to 6 decimals, the accuracy read, a tidied label, the reason', () => {
    expect(homeAskBody(form({ type: 'home', latitude: '30.1012345', longitude: '31.3801234', accuracy: '12.4', label: '  Home,  Nasr City ', reason: ` ${why} ` }), TODAY)).toEqual({
      body: { type: 'home', latitude: 30.101235, longitude: 31.380123, accuracy: 12, label: 'Home, Nasr City', reason: why },
      errors: [],
    });
    // put on the map: no accuracy, no label; no type sent: a home
    expect(homeAskBody(form({ latitude: '30.1', longitude: '31.3', accuracy: '', label: '', reason: why }), TODAY)).toEqual({
      body: { type: 'home', latitude: 30.1, longitude: 31.3, reason: why },
      errors: [],
    });
    // Arabic digits as a phone may type them
    expect(homeAskBody(form({ latitude: '٣٠٫١', longitude: '٣١٫٣', reason: why }), TODAY).body).toMatchObject({ latitude: 30.1, longitude: 31.3 });
  });

  it('reads a remote site or a client location with its name, radius and the end date wished (DD/MM/YYYY)', () => {
    expect(homeAskBody(form({ type: 'client', latitude: '30.1', longitude: '31.3', label: 'Acme', reason: 'Weekly visits', radiusMetres: '150', wishedEndDate: '31/12/2026' }), TODAY)).toEqual({
      body: { type: 'client', latitude: 30.1, longitude: 31.3, label: 'Acme', reason: 'Weekly visits', radiusMetres: 150, wishedEndDate: '2026-12-31' },
      errors: [],
    });
    // a home's end date isn't read: HR links it to the contract
    expect(homeAskBody(form({ type: 'home', latitude: '30.1', longitude: '31.3', reason: why, wishedEndDate: '31/12/2026' }), TODAY).body).not.toHaveProperty('wishedEndDate');
  });

  it('refuses a request without a point on the map, a name, a reason, a radius out of range, or a label too long', () => {
    expect(homeAskBody(form({ latitude: '', longitude: '', reason: why }), TODAY)).toEqual({ body: null, errors: ['Put your home on the map, or use your current location while at home.'] });
    expect(homeAskBody(form({ latitude: 'abc', longitude: '31', reason: why }), TODAY).errors).toEqual(['Put your home on the map, or use your current location while at home.']);
    expect(homeAskBody(form({ latitude: '30', longitude: '31', label: 'x'.repeat(201), reason: why }), TODAY).errors).toEqual(['Keep the label to 200 characters or fewer.']);
    expect(homeAskBody(form({ latitude: '30', longitude: '31' }), TODAY).errors).toEqual(['Write the reason: why you need this place to check in from.']);
    expect(homeAskBody(form({ type: 'remote_site', latitude: '30', longitude: '31', reason: why }), TODAY).errors).toEqual(['Name the place, e.g. Studio in Zamalek.']);
    expect(homeAskBody(form({ latitude: '30', longitude: '31', reason: why, radiusMetres: '600' }), TODAY).errors[0]).toContain('from 25 to 500');
    expect(homeAskBody(form({ type: 'client', latitude: '30', longitude: '31', label: 'Acme', reason: why, wishedEndDate: '31/02/2026' }), TODAY).errors).toContain(
      'Enter the end date you wish as DD/MM/YYYY, e.g. 31/12/2026.',
    );
    expect(homeAskBody(form({ type: 'client', latitude: '30', longitude: '31', label: 'Acme', reason: why, wishedEndDate: '01/10/2026' }), TODAY).errors).toEqual([
      'Choose an end date of today or later.',
    ]);
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

  it('reads how long HR approves it for: the type’s choices, a date typed DD/MM/YYYY, today or later', () => {
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'contract' }), 'hr', 'home', TODAY).body).toEqual({ decision: 'approve', radiusMetres: 100, validity: 'contract' });
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'until_date', validUntil: '31/12/2026' }), 'hr', 'remote_site', TODAY).body).toEqual({
      decision: 'approve',
      radiusMetres: 100,
      validity: 'until_date',
      validUntil: '2026-12-31',
    });
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'no_end' }), 'hr', 'client', TODAY).body).toMatchObject({ validity: 'no_end' });
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'no_end' }), 'hr', 'home', TODAY).errors[0]).toContain('until a date or until the contract ends');
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'until_date', validUntil: '' }), 'hr', 'home', TODAY).errors[0]).toContain('Enter the date');
    expect(homeDecisionBody(form({ decision: 'approve', radiusMetres: '100', validity: 'until_date', validUntil: '20/10/2026' }), 'hr', 'home', TODAY).errors).toEqual([
      'Choose an end date of today or later.',
    ]);
    // the CEO's step sends none
    expect(homeDecisionBody(form({ decision: 'approve', validity: 'contract' }), 'ceo', 'home', TODAY).body).toEqual({ decision: 'approve' });
  });

  it('starts HR’s step with the type’s default and the date wished', () => {
    expect(startingValidity(home())).toEqual({ validity: 'contract', validUntil: '' });
    expect(startingValidity(home({ type: 'remote_site', wishedEndDate: '2026-12-31' }))).toEqual({ validity: 'until_date', validUntil: '31/12/2026' });
    expect(startingValidity(home({ type: 'client' }))).toEqual({ validity: 'no_end', validUntil: '' });
    expect(validityChoices(home({ type: 'client' }))).toEqual(['until_date', 'no_end']);
    expect(validityChoices(home())).toEqual(['until_date', 'contract']);
  });

  it('reads HR’s change of how long an approved home or remote site lasts', () => {
    expect(homeValidityBody(form({ validity: 'until_date', validUntil: '31/12/2026', comment: ' Project ends ' }), 'remote_site', TODAY)).toEqual({
      body: { validity: 'until_date', validUntil: '2026-12-31', comment: 'Project ends' },
      errors: [],
    });
    expect(homeValidityBody(form({ validity: 'contract' }), 'home', TODAY).body).toEqual({ validity: 'contract' });
    expect(homeValidityBody(form({}), 'home', TODAY).errors[0]).toContain('Choose how long it lasts');
  });

  it('reads HR’s removal: a comment if given', () => {
    expect(homeRemoveBody(form({ comment: ' Moved ' }))).toEqual({ comment: 'Moved' });
    expect(homeRemoveBody(form({ comment: '' }))).toEqual({});
    expect(homeRemoveBody(undefined)).toEqual({});
  });
});

describe('the types (24 October 2026: "Home Location - Remote Site - Client Location")', () => {
  it('says each and how a check-in within it shows', () => {
    expect(HOME_TYPE_LINES).toEqual({ home: 'Home location', remote_site: 'Remote site', client: 'Client location' });
    expect(homeShownAs(home())).toBe('Home');
    expect(homeShownAs(home({ type: 'remote_site', label: 'Studio' }))).toBe('Remote site · Studio');
    expect(homeShownAs(home({ type: 'client', label: 'Acme' }))).toBe('Client · Acme');
    expect(homeWhatText(home({ type: 'client', label: 'Acme', radiusMetres: 120 }))).toBe('Client location: Acme · 120 m');
    expect(profileHomeText(home({ type: 'remote_site', approvedAt: '2026-10-20T11:00:00.000Z' }))).toBe('Remote site: approved 20/10/2026 · 100 m');
  });

  it('says where an approved one stands: in force with its end, ended, a client location for everyone', () => {
    const approved = { status: 'approved' as const, approvedAt: '2026-10-20T11:00:00.000Z' };
    expect(homeProgressText(home({ ...approved, type: 'remote_site', label: 'Studio', inForce: true })).text).toBe('Approved 20/10/2026: a check-in within 100 m of it shows as Remote site · Studio');
    expect(homeProgressText(home({ ...approved, type: 'client', label: 'Acme', inForce: true })).text).toBe(
      'Approved 20/10/2026: a check-in within 100 m of it shows as Client · Acme, for every employee',
    );
    expect(homeProgressText(home({ ...approved, inForce: false, endsOn: '2026-10-23' })).text).toBe('Ended 23/10/2026: a check-in there no longer shows as Home');
    expect(homeProgressText(home({ ...approved, inForce: false, endsOn: null })).text).toBe('Ended with the employment: a check-in there no longer shows as Home');
    expect(homeProgressText(home({ ...approved, type: 'client', label: 'Acme', inForce: false, location: { id: 'l1', name: 'Acme', endedAt: '2026-10-23T10:00:00.000Z' } })).text).toBe(
      'Ended on Check-in Setup: a check-in there no longer shows as Client · Acme',
    );
    expect(homeValidityText(home({ validity: 'contract', endsOn: '2027-06-30' }))).toBe('Until the contract ends (30/06/2027)');
    expect(homeValidityText(home({ validity: 'until_date', validUntil: '2026-12-31', endsOn: '2026-12-31' }))).toBe('Until 31/12/2026');
    expect(homeValidityText(home({ validity: 'no_end' }))).toBe('No end');
    expect(homeValidityText(home())).toBeNull();
  });

  it('words what was just done, and a validity changed', () => {
    expect(homeDoneText({ done: 'ceo_approve' }, home({ type: 'client', label: 'Acme' }))?.text).toContain('a client location for every employee now');
    expect(homeDoneText({ done: 'ceo_approve' }, home({ type: 'remote_site', label: 'Studio' }))?.text).toBe('Approved: check-ins within it now show as Remote site · Studio.');
    expect(homeDoneText({ done: 'validity' }, home())?.text).toBe('Saved: how long it lasts is changed.');
    expect(homeStepText({ kind: 'validity_changed', decision: null, radiusMetres: null })).toBe('How long it lasts changed');
    expect(homeDecisionButton('approve', 'ceo', false, 'client').label).toBe('Approve the client location');
    expect(homeDecisionButton('reject', 'hr', false, 'remote_site').label).toBe('Reject the remote site');
    expect(homeMapLabel(home({ type: 'remote_site', label: 'Studio' }), true)).toBe('Map of your remote site and the 100 m around it');
    expect(homeMapLabel(home({ type: 'client', label: 'Acme' }))).toBe('Map of the client location Acme and the 100 m around it');
  });

  it('warns of the places it overlaps', () => {
    expect(overlapText({ label: 'Head office', kind: 'office', radiusMetres: 150, distanceMetres: 120 })).toBe('Overlaps Head office (main office) · 120 m apart');
    expect(overlapText({ label: null, kind: 'home', radiusMetres: 100, distanceMetres: 40 })).toBe('Overlaps their approved home · 40 m apart');
    expect(overlapText({ label: null, kind: 'remote_site', radiusMetres: 100, distanceMetres: null })).toBe('Overlaps one of their remote sites');
  });

  it('lists a person’s places on the profile: being decided, in force, ended; not those gone', () => {
    const list = [
      home({ id: 'a' }),
      home({ id: 'b', status: 'approved', inForce: true }),
      home({ id: 'c', status: 'approved', inForce: false }),
      home({ id: 'd', status: 'rejected' }),
      home({ id: 'e', status: 'removed' }),
    ];
    expect(profilePlaces(list).map((r) => [r.id, placeStandingText(r)])).toEqual([
      ['a', 'Being decided'],
      ['b', 'In force'],
      ['c', 'Ended'],
    ]);
    expect(placesInForce(list).map((r) => r.id)).toEqual(['b']);
    expect(approvedHomeOf([home({ id: 'x', status: 'approved', type: 'remote_site' })])).toBeNull();
  });

  it('reads HR’s lists by status and type, a person’s places, and a form opened from a refused check-in', () => {
    expect(homesApi()).toBe('/home-locations');
    expect(homesApi({ status: 'approved', type: 'client' })).toBe('/home-locations?status=approved&type=client');
    expect(employeePlacesApi('e1')).toBe('/home-locations?employeeId=e1');
    expect(fromRefusal({ from: 'refusal' })).toBe(true);
    expect(fromRefusal({})).toBe(false);
  });
});
