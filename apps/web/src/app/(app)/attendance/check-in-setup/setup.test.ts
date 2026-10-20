import { NO_WEB_KEY_TEXT, SIGNED_IP_PROBLEM_TEXT, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addressesBody,
  coordinateFrom,
  locationBody,
  locationFrom,
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
