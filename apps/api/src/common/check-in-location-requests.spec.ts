import {
  maskForDeveloper,
  CLIENT_FOR_EVERYONE_TEXT,
  countsForEveryone,
  defaultValidity,
  homeOpenAlready,
  homeRequestProblems,
  LOCATION_REASON_NEEDED,
  locationStanding,
  overlapsOf,
  removesHome,
  setsLocationValidity,
  signedContractEnd,
  validitiesFor,
  validityProblems,
  validityText,
} from '@trendlix/shared';

// Requested check-in locations (owner, 24 October 2026: "allow the employee to request adding this location to his
// profile, taking the approval cycle for sure, with a reason behind requesting to add this location (Home Location -
// Remote Site - Client Location) with a comment reason"; "allow the HR to add an end date or lik it to the contract
// date. if renewed renew the due date of the checkin location"; "location to be allowed only to the requested employee
// not all of them if home or remote, all employees if a customer location"; packages/shared home-locations.ts): what is
// asked, how long one lasts and where it stands, the contract's end a renewal moves, who changes it, and the overlaps.

const TODAY = '2026-10-24';
const POINT = { latitude: 30.05, longitude: 31.25 };

describe('what is asked', () => {
  it('needs a remote site’s or a client location’s name, and the reason, for every type', () => {
    expect(homeRequestProblems({ ...POINT, type: 'home', reason: 'I work from home on Thursdays' })).toEqual([]);
    expect(homeRequestProblems({ ...POINT, type: 'remote_site', label: 'Studio in Zamalek', reason: 'Shoots there' })).toEqual([]);
    expect(homeRequestProblems({ ...POINT, type: 'client', reason: 'Weekly visits' })).toEqual(['Name the place: the client’s name, e.g. Acme Cairo office.']);
    expect(homeRequestProblems({ ...POINT, type: 'remote_site', label: 'Flat', reason: '  ' })).toEqual([LOCATION_REASON_NEEDED]);
    expect(homeRequestProblems({ ...POINT, type: 'home', reason: 'x'.repeat(1001) })[0]).toContain('1,000 characters');
  });

  it('takes a radius from 25 to 500 m, and an end date wished for a remote site or a client location only', () => {
    const base = { ...POINT, type: 'client' as const, label: 'Acme', reason: 'Visits', today: TODAY };
    expect(homeRequestProblems({ ...base, radiusMetres: 25, wishedEndDate: '2026-12-31' })).toEqual([]);
    expect(homeRequestProblems({ ...base, radiusMetres: 24 })[0]).toContain('from 25 to 500');
    expect(homeRequestProblems({ ...base, radiusMetres: 501 })[0]).toContain('from 25 to 500');
    expect(homeRequestProblems({ ...base, wishedEndDate: '2026-10-23' })).toEqual(['Choose an end date of today or later.']);
    expect(homeRequestProblems({ ...base, wishedEndDate: '2026-02-30' })[0]).toContain('as a date');
    expect(homeRequestProblems({ ...base, type: 'home', label: null, wishedEndDate: '2026-12-31' })[0]).toContain('HR links it to your contract');
  });

  it('asks a home as before when sent without a type: no reason needed', () => {
    expect(homeRequestProblems({ ...POINT, label: 'Home, Nasr City' })).toEqual([]);
  });

  it('is one being decided at a time of each type', () => {
    expect(homeOpenAlready('home')).toContain('home location request is being decided already');
    expect(homeOpenAlready('client')).toContain('client location request');
  });

  it('counts for everyone only as a client location, which the approval says first', () => {
    expect(countsForEveryone('client')).toBe(true);
    expect(countsForEveryone('home')).toBe(false);
    expect(countsForEveryone('remote_site')).toBe(false);
    expect(CLIENT_FOR_EVERYONE_TEXT).toBe('Approving makes this place count for everyone.');
  });
});

describe('how long an approved one lasts', () => {
  it('is a date or the contract for a home or a remote site; a date or no end for a client location', () => {
    expect(validitiesFor('home')).toEqual(['until_date', 'contract']);
    expect(validitiesFor('remote_site')).toEqual(['until_date', 'contract']);
    expect(validitiesFor('client')).toEqual(['until_date', 'no_end']);
  });

  it('starts as the contract for a home; the date wished, else the contract or no end, for the others', () => {
    expect(defaultValidity('home', '2026-12-31')).toBe('contract');
    expect(defaultValidity('remote_site', '2026-12-31')).toBe('until_date');
    expect(defaultValidity('remote_site', null)).toBe('contract');
    expect(defaultValidity('client', '2026-12-31')).toBe('until_date');
    expect(defaultValidity('client', null)).toBe('no_end');
  });

  it('checks what HR chooses', () => {
    expect(validityProblems('home', 'contract', null, TODAY)).toEqual([]);
    expect(validityProblems('client', 'no_end', null, TODAY)).toEqual([]);
    expect(validityProblems('home', 'no_end', null, TODAY)[0]).toContain('until a date or until the contract ends');
    expect(validityProblems('client', 'contract', null, TODAY)[0]).toContain('until a date or no end');
    expect(validityProblems('remote_site', 'until_date', null, TODAY)[0]).toContain('Enter the date');
    expect(validityProblems('remote_site', 'until_date', '2026-10-23', TODAY)).toEqual(['Choose an end date of today or later.']);
    expect(validityProblems('remote_site', 'until_date', TODAY, TODAY)).toEqual([]);
  });

  it('follows the latest end of the current employment’s signed contract: a renewal moves it', () => {
    const first = { status: 'active', endDate: '2026-12-31' };
    expect(signedContractEnd([first])).toBe('2026-12-31');
    // renewed: the first ended or superseded, the new one active to a later end
    expect(signedContractEnd([{ ...first, status: 'ended' }, { status: 'active', endDate: '2027-12-31' }])).toBe('2027-12-31');
    // a draft renewal doesn't count until signed
    expect(signedContractEnd([first, { status: 'draft', endDate: '2027-12-31' }])).toBe('2026-12-31');
    // open-ended, or none signed: no end
    expect(signedContractEnd([{ status: 'active', endDate: null }])).toBeNull();
    expect(signedContractEnd([])).toBeNull();
  });

  it('counts while approved and not past its last day; the contract’s only while they are employed', () => {
    const approved = { status: 'approved', validity: 'until_date', validUntil: '2026-10-31' };
    expect(locationStanding(approved, null, TODAY)).toEqual({ end: '2026-10-31', inForce: true });
    expect(locationStanding(approved, null, '2026-11-01')).toEqual({ end: '2026-10-31', inForce: false });
    const linked = { status: 'approved', validity: 'contract', validUntil: null };
    expect(locationStanding(linked, { employed: true, end: '2026-12-31' }, TODAY)).toEqual({ end: '2026-12-31', inForce: true });
    expect(locationStanding(linked, { employed: true, end: '2026-10-01' }, TODAY).inForce).toBe(false);
    expect(locationStanding(linked, { employed: true, end: '2027-10-01' }, TODAY).inForce).toBe(true);
    expect(locationStanding(linked, { employed: false, end: null }, TODAY).inForce).toBe(false);
    expect(locationStanding({ status: 'approved', validity: 'no_end', validUntil: null }, null, '2030-01-01')).toEqual({ end: null, inForce: true });
    expect(locationStanding({ status: 'with_ceo', validity: 'no_end', validUntil: null }, null, TODAY).inForce).toBe(false);
  });

  it('is said in words', () => {
    const show = (d: string) => d.split('-').reverse().join('/');
    expect(validityText('until_date', '2026-12-31', show)).toBe('Until 31/12/2026');
    expect(validityText('contract', '2027-06-30', show)).toBe('Until the contract ends (30/06/2027)');
    expect(validityText('contract', null, show)).toBe('Until the contract ends');
    expect(validityText('no_end', null, show)).toBe('No end');
  });
});

describe('who changes an approved one', () => {
  const hr = { roles: ['hr'] as const };
  const ceo = { roles: ['ceo'] as const };
  const parties = { own: false, confidential: false };

  it('lets HR change a home’s or a remote site’s validity; a client location is changed on Check-in Setup', () => {
    expect(setsLocationValidity(hr, { ...parties, status: 'approved', type: 'remote_site' })).toBe(true);
    expect(setsLocationValidity(hr, { ...parties, status: 'approved', type: 'client' })).toBe(false);
    expect(setsLocationValidity(hr, { ...parties, status: 'with_ceo', type: 'home' })).toBe(false);
    expect(setsLocationValidity(hr, { ...parties, own: true, status: 'approved', type: 'home' })).toBe(false);
    // a C-level person's: the CEO, not HR
    expect(setsLocationValidity(hr, { ...parties, confidential: true, status: 'approved', type: 'home' })).toBe(false);
    expect(setsLocationValidity(ceo, { ...parties, confidential: true, status: 'approved', type: 'home' })).toBe(true);
  });

  it('never removes a client location as a request: it is the company’s once approved', () => {
    expect(removesHome(hr, { ...parties, status: 'approved', type: 'remote_site' })).toBe(true);
    expect(removesHome(hr, { ...parties, status: 'approved', type: 'client' })).toBe(false);
  });
});

describe('overlaps (a warning, never a block)', () => {
  it('lists the places whose circles meet the request’s, nearest first', () => {
    const head = { label: 'Head', kind: 'office' as const, latitude: 30.05, longitude: 31.2509, radiusMetres: 150 };
    const far = { label: 'Far', kind: 'sub_location' as const, latitude: 30.2, longitude: 31.25, radiusMetres: 100 };
    const near = { label: 'Near', kind: 'client' as const, latitude: 30.0501, longitude: 31.25, radiusMetres: 30 };
    const found = overlapsOf({ ...POINT, radiusMetres: 100 }, [head, far, near]);
    expect(found.map((o) => o.label)).toEqual(['Near', 'Head']);
    expect(found[0]).toEqual({ label: 'Near', kind: 'client', radiusMetres: 30, distanceMetres: 11 });
  });
});

describe('a developer’s sight of them', () => {
  it('hides a request’s point, name, reason and how far it is from the places it overlaps', () => {
    const request = {
      id: 'h1',
      type: 'remote_site',
      latitude: 30.05,
      longitude: 31.25,
      label: 'Flat in Zamalek',
      reason: 'Shoots at my flat',
      radiusMetres: 100,
      overlaps: [{ label: 'Head', kind: 'office', radiusMetres: 150, distanceMetres: 120 }],
    };
    for (const path of ['/api/home-locations', '/api/home-locations/h1', '/api/me/home-locations']) {
      const shown = maskForDeveloper(request, path) as typeof request;
      expect(shown).toMatchObject({ latitude: null, longitude: null, label: null, type: 'remote_site', radiusMetres: 100 });
      expect(shown.reason).not.toBe(request.reason);
      expect(shown.overlaps[0]).toMatchObject({ label: null, distanceMetres: null });
    }
  });

  it('hides the name of the place a press was within on the attendance pages, never on Check-in Setup', () => {
    const day = { punches: [{ kind: 'in', place: 'remote', locationName: 'Flat in Zamalek', locationKind: 'remote_site' }] };
    expect((maskForDeveloper(day, '/api/me/attendance/today') as typeof day).punches[0]).toMatchObject({ locationName: null, locationKind: 'remote_site' });
    expect((maskForDeveloper(day, '/api/attendance') as typeof day).punches[0].locationName).toBeNull();
    const setup = [{ id: 'l1', name: 'Acme', kind: 'client', latitude: 30.05, longitude: 31.25, radiusMetres: 120 }];
    expect(maskForDeveloper(setup, '/api/attendance/check-in-setup/locations')).toEqual(setup);
  });
});
