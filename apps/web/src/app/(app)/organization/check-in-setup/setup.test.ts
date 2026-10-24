import { NO_WEB_KEY_TEXT, SIGNED_IP_PROBLEM_TEXT, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addedText,
  addressesBody,
  chipsOf,
  clientEndBody,
  clientEndText,
  clientLocationsOf,
  clientShownAsText,
  endClientConfirm,
  GPS_ALLOWANCE_TEXT,
  GPS_NO_LOCATION_TEXT,
  gpsLockBody,
  gpsLockSaved,
  gpsLockText,
  readRequestFilters,
  requestFilterHref,
  requestFilterLabel,
  requestRowText,
  requestsApi,
  coordinateFrom,
  faintCircles,
  linkButtonText,
  linkOptions,
  mainAndSubs,
  makeMainConfirm,
  moreText,
  radiusHint,
  removeConfirm,
  shownAsText,
  withChosen,
  withinText,
  locationBody,
  locationFrom,
  locationRuleBody,
  locationRuleSaved,
  locationRuleText,
  locationText,
  lockText,
  networksBody,
  networkStatus,
  officeAddressesFrom,
  removesLocations,
  seesCheckInSetup,
  type NetworksState,
} from './setup';
import { coordinateText } from '../../../../lib/map-point';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"; check-ins locked to the office
// network, the same day): who keeps it, the forms read as the API takes them, and what the page says of the lock.

const as = (...roles: Role[]) => ({ roles });
const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
};

describe('who keeps the check-in setup', () => {
  it('is HR and Admin (a Super Admin as an Admin); a Super Admin removes a location', () => {
    for (const r of ['hr', 'admin', 'super_admin'] as const) expect(seesCheckInSetup(as(r))).toBe(true);
    for (const r of ['employee', 'manager', 'finance', 'ceo'] as const) expect(seesCheckInSetup(as(r))).toBe(false);
    expect([removesLocations(as('super_admin')), removesLocations(as('hr')), removesLocations(as('admin'))]).toEqual([true, false, false]);
  });
});

describe('a check-in location', () => {
  const LAT = "Enter the location's latitude from -90 to 90, e.g. 30.0596.";
  const LNG = "Enter the location's longitude from -180 to 180, e.g. 31.3462.";
  const BOTH = "Enter the location's latitude and longitude, e.g. 30.0596 and 31.3462, or use your current location.";
  const RADIUS = "Enter the location's radius in whole metres from 20 to 5,000, e.g. 150.";
  const at = (latitude: string, longitude: string, radius = '150', name = 'Head office') => locationFrom({ name, latitude, longitude, radius });

  it('reads the name, the point to 6 decimals and the radius in whole metres', () => {
    expect(at('30.0596', '31.3462')).toEqual({ body: { name: 'Head office', latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 }, problems: [] });
    expect(at('30.05961234', '-31.34629876', '200').body).toMatchObject({ latitude: 30.059612, longitude: -31.346299, radiusMetres: 200 });
    // Arabic digits and decimal mark, as a phone may type them
    expect(at('٣٠٫٠٥٩٦', '٣١٫٣٤٦٢', '١٥٠').body).toMatchObject({ latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 });
    expect(at('30.0596', '31.3462', '').body.radiusMetres).toBe(150);
    expect(at('30.0596', '31.3462', '150', '  Studio   B ').body.name).toBe('Studio B');
  });

  it('splits both pasted from a map into Latitude', () => {
    expect(at('30.059612, 31.346123', '').body).toMatchObject({ latitude: 30.059612, longitude: 31.346123 });
    expect(at(' 30.0596 ، 31.3462 ', '').problems).toEqual([]);
  });

  it('needs a name and both coordinates, and says what is wrong as the API does', () => {
    expect(at('30.0596', '31.3462', '150', ' ').problems).toEqual(['Name the location, e.g. Head office.']);
    expect(at('', '').problems).toEqual([BOTH]);
    expect(at('30.0596', '').problems).toEqual([BOTH]);
    expect(at('95', '31.3462').problems).toEqual([LAT]);
    expect(at('30.0596', '181').problems).toEqual([LNG]);
    expect(at('north', '31.3462').problems).toEqual([LAT]);
    expect(at('30.0596', '31.3462', '10').problems).toEqual([RADIUS]);
    expect(at('30.0596', '31.3462', '150.5').problems).toEqual([RADIUS]);
    expect([coordinateFrom(''), coordinateFrom('  '), coordinateFrom('−30.5'), coordinateFrom('30,5')]).toEqual([null, null, -30.5, NaN]);
  });

  it('is read from its form, and said in the list', () => {
    const fd = form([
      ['name', 'Studio'],
      ['latitude', '30.0444'],
      ['longitude', '31.2357'],
      ['radiusMetres', '100'],
    ]);
    expect(locationBody(fd)).toEqual({ body: { name: 'Studio', latitude: 30.0444, longitude: 31.2357, radiusMetres: 100 }, problems: [] });
    expect(locationText({ latitude: 30.0596, longitude: 31.3462, radiusMetres: 1200 })).toBe('30.059600, 31.346200 · within 1,200 m');
    expect([coordinateText(30.0596), coordinateText(null), coordinateText(undefined)]).toEqual(['30.059600', '', '']);
  });
});

describe('the office networks', () => {
  it('reads the rows and the switch, leaving out empty rows, as the API keeps them', () => {
    const fd = form([
      ['lock', 'false'],
      ['lock', 'true'],
      ['networkLabel', 'Main office line'],
      ['networkRange', '41.33.10.7/24'],
      ['networkLabel', ''],
      ['networkRange', ' '],
      ['networkLabel', 'Fibre'],
      ['networkRange', '2001:DB8:1234:5678::/64'],
    ]);
    expect(networksBody(fd)).toEqual({
      body: {
        lock: true,
        networks: [
          { label: 'Main office line', range: '41.33.10.0/24' },
          { label: 'Fibre', range: '2001:db8:1234:5678::/64' },
        ],
      },
      problems: [],
    });
    expect(networksBody(form([['lock', 'false']])).body).toEqual({ lock: false, networks: [] });
    expect(networksBody(form([['networkLabel', 'Wi-Fi'], ['networkRange', '192.168.1.0/24']])).problems[0]).toContain('is a private address');
  });

  const state = (more: Partial<NetworksState> = {}): NetworksState => ({
    lock: false,
    networks: [{ label: 'Main office line', range: '41.33.10.0/24' }],
    serverKey: true,
    inForce: false,
    here: { signed: true, ip: '41.33.10.77', network: 'Main office line' },
    ...more,
  });

  it('is ready with the key on both sides, saying the address the page came from', () => {
    expect(networkStatus(state(), true)).toEqual({ ready: true, text: 'Ready: the website and the server share the key. You are on 41.33.10.77, the office network Main office line.' });
    expect(networkStatus(state({ here: { signed: true, ip: '197.45.1.9', network: null } }), true).text).toContain('which isn’t one of the office networks');
  });

  it('says what is missing: the server’s key, the website’s, or a key that doesn’t match', () => {
    expect(networkStatus(state({ serverKey: false, here: { signed: false, problem: 'no_server_key' } }), true)).toEqual({ ready: false, text: SIGNED_IP_PROBLEM_TEXT.no_server_key });
    expect(networkStatus(state({ here: { signed: false, problem: 'unsigned' } }), false)).toEqual({ ready: false, text: NO_WEB_KEY_TEXT });
    expect(networkStatus(state({ here: { signed: false, problem: 'unsigned' } }), true).text).toContain('couldn’t be read on this page');
    expect(networkStatus(state({ here: { signed: false, problem: 'bad_signature' } }), true)).toEqual({ ready: false, text: SIGNED_IP_PROBLEM_TEXT.bad_signature });
    expect(SIGNED_IP_PROBLEM_TEXT.no_server_key).toMatch(/^Needs the server key: run deploy\/web-key\.sh/);
  });

  it('says how the lock stands', () => {
    expect(lockText(state({ lock: true, inForce: true }))).toMatch(/^On: Office staff/);
    expect(lockText(state({ lock: true, serverKey: false }))).toContain('the server has no key, so no one is refused');
    expect(lockText(state({ lock: true, networks: [] }))).toContain('there is no office network');
    expect(lockText(state())).toMatch(/^Off:/);
  });
});

describe('check-ins without a location (owner, 20 October 2026: "Company switch + exceptions")', () => {
  it('reads the switch as the API takes it, off unless ticked', () => {
    expect(locationRuleBody(form([['refuseWithoutLocation', 'false']]))).toEqual({ refuseWithoutLocation: false });
    expect(locationRuleBody(form([['refuseWithoutLocation', 'false'], ['refuseWithoutLocation', 'true']]))).toEqual({ refuseWithoutLocation: true });
    expect(locationRuleBody(form([]))).toEqual({ refuseWithoutLocation: false });
  });

  it('says where it stands: off; on, with the exemption, the office network when it is ready, and the app', () => {
    expect(locationRuleText({ refuseWithoutLocation: false }, true)).toBe(
      'Off: on the website a check-in without a location is kept as location unknown. In the app a location is always needed.',
    );
    const on = locationRuleText({ refuseWithoutLocation: true }, true);
    expect(on).toContain('refused, unless HR lets the person check in without one on their profile');
    expect(on).toContain('A press from an office network without one counts as at the office.');
    expect(locationRuleText({ refuseWithoutLocation: true }, false)).toContain('a press from the office without a location is refused too');
    expect(locationRuleText({ refuseWithoutLocation: true }, null)).not.toContain('office network');
    expect([locationRuleSaved(true), locationRuleSaved(false)]).toEqual([
      'Saved. Check-ins and check-outs without a location are refused from now on.',
      'Saved. Check-ins without a location are kept as location unknown again.',
    ]);
  });
});

describe('the main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations are like sub locations")', () => {
  const MAIN = { id: 'm', name: 'Trendlix Al Mahrouki', latitude: 30.082812, longitude: 31.323006, radiusMetres: 20, isMain: true };
  const STUDIO = { id: 's', name: 'Studio', latitude: 30.0841, longitude: 31.3245, radiusMetres: 50, isMain: false };
  const CLIENT = { id: 'c', name: 'Client X', latitude: 29.9792, longitude: 31.1342, radiusMetres: 200, isMain: false };

  it('lays out the main office apart from the sub-locations, in the API’s order', () => {
    expect(mainAndSubs([MAIN, STUDIO, CLIENT])).toEqual({ main: MAIN, subs: [STUDIO, CLIENT] });
    expect(mainAndSubs([STUDIO, MAIN])).toEqual({ main: MAIN, subs: [STUDIO] });
    expect(mainAndSubs([])).toEqual({ main: null, subs: [] });
    // no main among them (never through the API): every one a sub-location
    expect(mainAndSubs([STUDIO])).toEqual({ main: null, subs: [STUDIO] });
    // an API from before sub-locations: the first was the office
    const old: { id: string; name: string; isMain?: boolean }[] = [{ id: 'a', name: 'Office' }, { id: 'b', name: 'Annex' }];
    expect(mainAndSubs(old)).toEqual({ main: old[0], subs: [old[1]] });
  });

  it('says the radius, hints a wider one under 50 m, and how a sub-location shows', () => {
    expect([withinText(20), withinText(1500)]).toEqual(['Within 20 m', 'Within 1,500 m']);
    expect(radiusHint(20)).toBe('Phones are often 10–30 m off; 50–80 m is safer.');
    expect(radiusHint(49)).not.toBeNull();
    expect([radiusHint(50), radiusHint(150)]).toEqual([null, null]);
    expect(shownAsText(' Client  X ')).toBe('Remote - Client X');
    expect(faintCircles([STUDIO])).toEqual([{ latitude: STUDIO.latitude, longitude: STUDIO.longitude, radiusMetres: 50, name: 'Studio (sub-location)' }]);
  });

  it('shows the first five linked people as chips, then “+N more”', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(chipsOf(people)).toEqual({ shown: ['a', 'b', 'c', 'd', 'e'], more: 2 });
    expect(chipsOf(people.slice(0, 5))).toEqual({ shown: people.slice(0, 5), more: 0 });
    expect(chipsOf([])).toEqual({ shown: [], more: 0 });
    expect(moreText(2)).toBe('+2 more');
  });

  it('offers to link those not linked nor chosen yet, by name, code and department; each chosen once', () => {
    const candidates = [
      { id: '1', fullNameEn: 'Walid Wahba', employeeCode: 'EMP-0003', department: 'Design' },
      { id: '2', fullNameEn: 'Lina Linked', employeeCode: 'EMP-0001', department: null },
      { id: '3', fullNameEn: 'Omar Office', employeeCode: 'EMP-0002', department: 'Sales' },
    ];
    expect(linkOptions(candidates, ['3'])).toEqual([
      { value: '2', label: 'Lina Linked · EMP-0001' },
      { value: '1', label: 'Walid Wahba · EMP-0003 · Design' },
    ]);
    expect(linkOptions(candidates, ['1', '2', '3'])).toEqual([]);
    expect(withChosen(['1'], '2')).toEqual(['1', '2']);
    expect(withChosen(['1', '2'], '1')).toEqual(['1', '2']);
    expect(withChosen(['1'], '')).toEqual(['1']);
    expect([linkButtonText(1), linkButtonText(3)]).toEqual(['Link 1 person', 'Link 3 people']);
  });

  it('asks before Make main and removing, and says what was added', () => {
    expect(makeMainConfirm('Studio', 'Head office')).toBe(
      'Make Studio the main office? Check-ins within it will count as Office for everyone, and Head office becomes a sub-location: check-ins there will show as Remote - Head office.',
    );
    expect(makeMainConfirm('Studio', null)).toBe('Make Studio the main office? Check-ins within it will count as Office for everyone.');
    expect(removeConfirm('Studio', false)).toContain('Its people are unlinked');
    expect(removeConfirm('Head office', true)).toContain('every check-in on the system is kept as location unknown');
    expect(addedText('Head office', true)).toBe('Added Head office, the main office: check-ins within it count as Office.');
    expect(addedText('Studio', false)).toBe('Added Studio: check-ins within it show as Remote - Studio.');
  });

  it('says the lock lets Office staff check in at a sub-location they are linked to', () => {
    expect(lockText({ lock: true, inForce: true, serverKey: true, networks: [{ label: 'Main office line', range: '41.33.10.0/24' }] })).toContain('or at a sub-location they are linked to');
  });
});

describe('Zoho People’s check-in addresses (moved from Your Rules, 20 October 2026)', () => {
  it('sends one address a line, trimmed, the empty lines dropped, refusing one twice as the API does', () => {
    expect(officeAddressesFrom('  Trendlix \n\n15, Al Doctor Al Mahrouqi Street\r\n')).toEqual(['Trendlix', '15, Al Doctor Al Mahrouqi Street']);
    expect(addressesBody(form([['officeAddresses', 'Trendlix\n13, Al Doctor Al Mahrouqi Street']]))).toEqual({
      body: { officeAddresses: ['Trendlix', '13, Al Doctor Al Mahrouqi Street'] },
      problems: [],
    });
    expect(addressesBody(form([['officeAddresses', 'Trendlix\ntrendlix']])).problems).toEqual(['"trendlix" is there twice: keep it once.']);
  });
});

describe('the GPS lock (owner, 24 October 2026: "Yes, add a GPS lock too")', () => {
  it('reads the switch and the "too rough" limit as the API takes them, 200 m unless typed', () => {
    expect(gpsLockBody(form([['lock', 'false'], ['lock', 'true'], ['roughMetres', '150']]))).toEqual({ body: { lock: true, roughMetres: 150 }, problems: [] });
    expect(gpsLockBody(form([['lock', 'false'], ['roughMetres', '']]))).toEqual({ body: { lock: false, roughMetres: 200 }, problems: [] });
    expect(gpsLockBody(form([['lock', 'false'], ['roughMetres', '٣٠٠']])).body.roughMetres).toBe(300);
    expect(gpsLockBody(form([['roughMetres', '40']])).problems[0]).toContain('from 50 to 500');
    expect(gpsLockBody(form([['roughMetres', '1.5']])).problems[0]).toContain('from 50 to 500');
  });

  it('says where it stands: on with the limit, and either lock with the network’s on; on without the main office; off', () => {
    const on = gpsLockText({ lock: true, roughMetres: 200, inForce: true });
    expect(on).toMatch(/^On: Office staff check in and out only inside a check-in location/);
    expect(on).toContain('less accurate than 200 m is refused as too rough');
    expect(on).not.toContain('either');
    expect(gpsLockText({ lock: true, roughMetres: 200, inForce: true }, true)).toContain('a press passes when either does');
    expect(gpsLockText({ lock: true, roughMetres: 200, inForce: false })).toContain('there is no main office yet, so no one is refused');
    expect(gpsLockText({ lock: false, roughMetres: 200, inForce: false })).toMatch(/^Off: a check-in outside every check-in location is kept as remote/);
    expect(GPS_ALLOWANCE_TEXT).toContain('less its accuracy (at most 100 m), is within the radius');
    expect([gpsLockSaved(true), gpsLockSaved(false)]).toEqual([
      'Saved. Office staff now check in and out inside the check-in locations only.',
      'Saved. Check-ins outside the check-in locations are kept as remote again, never refused.',
    ]);
  });

  it('says either lock passing is enough on the networks’ status, and the GPS lock’s rule without a location', () => {
    const networks = { lock: true, inForce: true, serverKey: true, networks: [{ label: 'Main office line', range: '41.33.10.0/24' }] };
    expect(lockText(networks)).not.toContain('either');
    expect(lockText(networks, true)).toContain('a press passes when either does');
    expect(locationRuleText({ refuseWithoutLocation: false }, null, true)).toContain(GPS_NO_LOCATION_TEXT);
    expect(locationRuleText({ refuseWithoutLocation: true }, true, true)).toContain('whatever this switch says');
    expect(locationRuleText({ refuseWithoutLocation: true }, true)).not.toContain('GPS');
  });
});

describe('the client locations (owner, 24 October 2026: "all employees if a customer location")', () => {
  const MAIN = { id: 'm', name: 'Head', isMain: true, kind: 'office' as const };
  const STUDIO = { id: 's', name: 'Studio', isMain: false, kind: 'office' as const };
  const ACME = { id: 'c', name: 'Acme', isMain: false, kind: 'client' as const, validUntil: null, endedAt: null };

  it('are laid out apart from the main office and the sub-locations', () => {
    expect(mainAndSubs([MAIN, ACME, STUDIO])).toEqual({ main: MAIN, subs: [STUDIO] });
    expect(clientLocationsOf([MAIN, ACME, STUDIO])).toEqual([ACME]);
    // a client location is never taken for the main office, even with none
    expect(mainAndSubs([ACME])).toEqual({ main: null, subs: [] });
  });

  it('show as "Client · Acme", how long they last, and are drawn faintly as client locations', () => {
    expect(clientShownAsText(' Acme  Cairo ')).toBe('Client · Acme Cairo');
    expect(clientEndText(ACME)).toBe('No end');
    expect(clientEndText({ validUntil: '2026-12-31' })).toBe('Until 31/12/2026');
    expect(clientEndText({ validUntil: '2026-12-31', endedAt: '2026-10-25T08:00:00.000Z' })).toBe('Ended 25/10/2026');
    expect(faintCircles([{ name: 'Acme', latitude: 30, longitude: 31, radiusMetres: 120, kind: 'client' }])[0].name).toBe('Acme (client location)');
  });

  it('take a new end as a date, today or later, or no end; and ask before ending one', () => {
    const today = '2026-10-24';
    expect(clientEndBody(form([['ends', 'no_end'], ['validUntil', 'whatever']]), today)).toEqual({ body: { validUntil: null }, problems: [] });
    expect(clientEndBody(form([['ends', 'until_date'], ['validUntil', '31/12/2026']]), today)).toEqual({ body: { validUntil: '2026-12-31' }, problems: [] });
    expect(clientEndBody(form([['ends', 'until_date'], ['validUntil', '24/10/2026']]), today).body).toEqual({ validUntil: '2026-10-24' });
    expect(clientEndBody(form([['ends', 'until_date'], ['validUntil', '23/10/2026']]), today)).toEqual({ body: null, problems: ['Choose an end date of today or later.'] });
    expect(clientEndBody(form([['ends', 'until_date'], ['validUntil', '31/02/2026']]), today).problems[0]).toContain('DD/MM/YYYY');
    expect(endClientConfirm('Acme')).toBe('End Acme now? Check-ins within it stop counting for everyone from now on; it stays listed as ended, with its request.');
  });
});

describe('the requested check-in locations (owner, 24 October 2026: "Home Location - Remote Site - Client Location")', () => {
  it('reads the filters from the address: every type and the approved ones unless chosen', () => {
    expect(readRequestFilters({})).toEqual({ type: 'all', status: 'approved' });
    expect(readRequestFilters({ type: 'client', status: 'open' })).toEqual({ type: 'client', status: 'open' });
    expect(readRequestFilters({ type: 'nope', status: 'with_hr' })).toEqual({ type: 'all', status: 'approved' });
    expect(readRequestFilters({ type: ['home'], status: 'rejected' })).toEqual({ type: 'all', status: 'rejected' });
  });

  it('asks the API for them, and links to the other filters at the list', () => {
    expect(requestsApi({ type: 'all', status: 'approved' })).toBe('/home-locations?status=approved');
    expect(requestsApi({ type: 'remote_site', status: 'waiting' })).toBe('/home-locations?status=waiting&type=remote_site');
    expect(requestsApi({ type: 'all', status: 'all' })).toBe('/home-locations');
    expect(requestFilterHref({ type: 'all', status: 'approved' }, { type: 'client' })).toBe('?type=client#home-locations');
    expect(requestFilterHref({ type: 'client', status: 'approved' }, { status: 'all' })).toBe('?type=client&status=all#home-locations');
    expect(requestFilterHref({ type: 'client', status: 'open' }, { type: 'all', status: 'approved' })).toBe('?#home-locations');
    expect(['all', 'home', 'remote_site', 'client', 'open', 'waiting', 'rejected'].map(requestFilterLabel)).toEqual([
      'All',
      'Home Location',
      'Remote Site',
      'Client Location',
      'Being decided',
      'Waiting for you',
      'Rejected',
    ]);
  });

  it('says each in a row: its type, name, status, how long it lasts, and whether it has ended', () => {
    const base = { label: 'Flat', latitude: 30.05, status: 'approved' as const, confidential: false };
    expect(requestRowText({ ...base, type: 'remote_site', validity: 'until_date', endsOn: '2026-12-31', inForce: true })).toEqual({
      type: 'Remote Site',
      name: 'Flat',
      status: 'Approved',
      lasts: 'Until 31/12/2026',
      ended: false,
    });
    expect(requestRowText({ ...base, type: 'home', label: null, validity: 'contract', endsOn: '2027-06-30', inForce: false })).toMatchObject({
      name: 'No label',
      lasts: 'Until the contract ends (30/06/2027)',
      ended: true,
    });
    expect(requestRowText({ ...base, type: 'client', label: 'Acme', validity: 'no_end', location: { name: 'Acme (2)', endedAt: '2026-10-25T08:00:00.000Z' }, inForce: false })).toMatchObject({
      name: 'Acme (2)',
      lasts: 'Ended 25/10/2026',
      ended: true,
    });
    // a request of before, without a type: a home; being decided, no end said yet; a C-level person's with HR is with the CEO
    expect(requestRowText({ label: null, latitude: 30, status: 'with_hr', confidential: true })).toEqual({ type: 'Home Location', name: 'No label', status: 'With the CEO', lasts: null, ended: false });
    expect(requestRowText({ ...base, latitude: null, label: null, status: 'rejected' }).name).toBe('Point deleted');
  });
});
