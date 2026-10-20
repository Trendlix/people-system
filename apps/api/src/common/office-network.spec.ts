import {
  checkInLocationProblems,
  checkInLocationsSet,
  checkInPlace,
  clientIpPayload,
  currentNetworkOf,
  formatIp,
  ipInRange,
  isPrivateIp,
  lockedToOfficeNetwork,
  matchOfficeNetwork,
  networkLockInForce,
  normalizedIp,
  officeNetworksFrom,
  parseIp,
  parseNetwork,
  punchNetwork,
  webKeyUsable,
  type NetworkLockSetting,
} from '@trendlix/shared';

// Check-ins locked to the office network (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip,
// whatever is right"; packages/shared office-network.ts): the office's public IP, IPv4 addresses and ranges and IPv6
// ranges, an IPv4-mapped IPv6 address read as its IPv4 one; who is locked (Office staff, unless HR lets them check in from
// anywhere; never while the switch is off or the server has no key); and several check-in locations (owner, 20 October
// 2026: "Own page, several locations"): within any of them is the office. Every address is invented (documentation
// ranges and made-up public ones).

describe('IP addresses', () => {
  it('reads IPv4 and IPv6, and an IPv4-mapped IPv6 address as its IPv4 one', () => {
    expect(parseIp('41.33.10.2')).toEqual({ family: 4, value: 0x29210a02n });
    expect(parseIp(' 2001:db8::1 ')).toEqual({ family: 6, value: (0x20010db8n << 96n) | 1n });
    expect(parseIp('::ffff:41.33.10.2')).toEqual({ family: 4, value: 0x29210a02n });
    expect(parseIp('::FFFF:2921:0A02')).toEqual({ family: 4, value: 0x29210a02n });
    expect(normalizedIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(normalizedIp('::ffff:197.45.1.9')).toBe('197.45.1.9');
    expect(normalizedIp('::')).toBe('::');
    expect(formatIp(parseIp('2001:db8:0:0:1:0:0:1')!)).toBe('2001:db8::1:0:0:1'); // the first of two equal runs
    expect(formatIp(parseIp('2001:db8:1:2:3:4:5:6')!)).toBe('2001:db8:1:2:3:4:5:6');
  });

  it('refuses what isn’t an address', () => {
    for (const bad of ['', 'unknown', '256.1.1.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', '2001:db8::1::2', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', 'fe80::1%eth0', ':1::', '<script>', '1.2.3.4:443']) {
      expect(parseIp(bad)).toBeNull();
    }
    expect(parseIp(null)).toBeNull();
  });

  it('tells private addresses, which only the inside of a network sees', () => {
    for (const p of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd12:3456::1', 'fe80::1']) {
      expect(isPrivateIp(parseIp(p)!)).toBe(true);
    }
    for (const p of ['41.33.10.2', '172.32.0.1', '2001:db8::1', '197.45.1.9']) expect(isPrivateIp(parseIp(p)!)).toBe(false);
  });
});

describe('office networks', () => {
  it('takes an IPv4 address, an IPv4 range and an IPv6 range, its host bits cleared', () => {
    expect(parseNetwork('41.33.10.2').network).toEqual({ family: 4, base: 0x29210a02n, prefix: 32 });
    expect(parseNetwork('41.33.10.7/24').network).toEqual({ family: 4, base: 0x29210a00n, prefix: 24 });
    expect(parseNetwork('2001:db8:1234:5678:9abc::1/64').network?.prefix).toBe(64);
    // an IPv4-mapped range is the IPv4 range
    expect(parseNetwork('::ffff:41.33.10.0/120').network).toEqual({ family: 4, base: 0x29210a00n, prefix: 24 });
  });

  it('refuses a lone IPv6 address (its /64 offered), too wide a range, a private one, and what isn’t one', () => {
    expect(parseNetwork('2001:db8:1234:5678:9abc:def0:1:2').problem).toBe(
      '"2001:db8:1234:5678:9abc:def0:1:2" is one IPv6 address, which changes every few hours: enter its network instead, 2001:db8:1234:5678::/64.',
    );
    expect(parseNetwork('41.0.0.0/8').problem).toContain('too wide a range');
    expect(parseNetwork('2001:db8::/16').problem).toContain('too wide a range');
    expect(parseNetwork('41.33.10.0/33').problem).toContain("isn't an IP range");
    expect(parseNetwork('192.168.1.0/24').problem).toContain('is a private address');
    expect(parseNetwork('office wifi').problem).toContain("isn't an IP address or range");
    expect(parseNetwork('41.33.10.0/x').problem).toContain("isn't an IP address or range");
    expect(parseNetwork(' ').problem).toContain("Enter each network's address");
  });

  it('has an address in a range or not, IPv4 never in an IPv6 range', () => {
    expect(ipInRange('41.33.10.200', '41.33.10.0/24')).toBe(true);
    expect(ipInRange('41.33.11.1', '41.33.10.0/24')).toBe(false);
    expect(ipInRange('41.33.10.2', '41.33.10.2')).toBe(true);
    expect(ipInRange('41.33.10.3', '41.33.10.2')).toBe(false);
    expect(ipInRange('::ffff:41.33.10.9', '41.33.10.0/24')).toBe(true);
    expect(ipInRange('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd', '2001:db8:1234:5678::/64')).toBe(true);
    expect(ipInRange('2001:db8:1234:5679::1', '2001:db8:1234:5678::/64')).toBe(false);
    expect(ipInRange('41.33.10.2', '2001:db8:1234:5678::/64')).toBe(false);
    expect(ipInRange('not an address', '41.33.10.0/24')).toBe(false);
    expect(ipInRange('41.33.10.2', 'not a range')).toBe(false);
  });

  it('adds the network one is on now: the IPv4 address itself, or the /64 of an IPv6 one', () => {
    expect(currentNetworkOf('41.33.10.2')).toBe('41.33.10.2');
    expect(currentNetworkOf('::ffff:41.33.10.2')).toBe('41.33.10.2');
    expect(currentNetworkOf('2001:db8:1234:5678:9abc:def0:1:2')).toBe('2001:db8:1234:5678::/64');
    expect(currentNetworkOf('192.168.1.10')).toBeNull();
    expect(currentNetworkOf(undefined)).toBeNull();
  });

  it('keeps the list named, valid, each once and 20 at most, in the form it is kept', () => {
    expect(officeNetworksFrom([{ label: '  Main   line ', range: '41.33.10.7/24' }, { label: 'Fibre', range: '2001:DB8:1234:5678::/64' }])).toEqual({
      networks: [
        { label: 'Main line', range: '41.33.10.0/24' },
        { label: 'Fibre', range: '2001:db8:1234:5678::/64' },
      ],
      problems: [],
    });
    expect(officeNetworksFrom([{ label: '', range: '41.33.10.2' }]).problems).toEqual(['Name each network, e.g. Main office line for 41.33.10.2.']);
    expect(officeNetworksFrom([{ label: 'x'.repeat(61), range: '41.33.10.2' }]).problems).toEqual(["Keep each network's name to 60 characters or fewer."]);
    expect(officeNetworksFrom([{ label: 'A', range: '41.33.10.2' }, { label: 'B', range: '::ffff:41.33.10.2' }]).problems).toEqual(['"41.33.10.2" is there twice: keep it once.']);
    expect(officeNetworksFrom(Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, range: `41.33.10.${i + 1}` }))).problems).toEqual(['Enter at most 20 office networks.']);
    expect(officeNetworksFrom([{ label: 'A', range: 42 }]).problems[0]).toContain("Enter each network's address");
  });

  it('finds the network an address is on', () => {
    const networks = [
      { label: 'Main line', range: '41.33.10.0/24' },
      { label: 'Fibre', range: '2001:db8:1234:5678::/64' },
    ];
    expect(matchOfficeNetwork('41.33.10.9', networks)?.label).toBe('Main line');
    expect(matchOfficeNetwork('2001:db8:1234:5678::77', networks)?.label).toBe('Fibre');
    expect(matchOfficeNetwork('197.45.1.9', networks)).toBeNull();
    expect(matchOfficeNetwork(null, networks)).toBeNull();
  });
});

describe('who is locked to the office network (owner, 20 October 2026: "Office staff, plus exceptions")', () => {
  const ON: NetworkLockSetting = { lock: true, networks: [{ label: 'Main line', range: '41.33.10.0/24' }], serverKey: true };
  const office = { workArrangement: 'office', checkInAnywhere: false };

  it('is in force only switched on, with a network, and the key on the server', () => {
    expect(networkLockInForce(ON)).toBe(true);
    expect(networkLockInForce({ ...ON, lock: false })).toBe(false);
    expect(networkLockInForce({ ...ON, networks: [] })).toBe(false);
    expect(networkLockInForce({ ...ON, serverKey: false })).toBe(false);
  });

  it('locks Office staff; not one HR exempted, nor Hybrid, Outdoor, Indoor and outdoor or Work from home', () => {
    expect(lockedToOfficeNetwork(ON, office)).toBe(true);
    expect(lockedToOfficeNetwork(ON, { workArrangement: 'office' })).toBe(true);
    expect(lockedToOfficeNetwork(ON, { ...office, checkInAnywhere: true })).toBe(false);
    for (const workArrangement of ['hybrid', 'outdoor', 'indoor_outdoor', 'wfh']) expect(lockedToOfficeNetwork(ON, { workArrangement })).toBe(false);
    // the switch off, or no key: no one
    expect(lockedToOfficeNetwork({ ...ON, lock: false }, office)).toBe(false);
    expect(lockedToOfficeNetwork({ ...ON, serverKey: false }, office)).toBe(false);
  });

  it('refuses a locked person off the network or without a signed address, and names the network one is on', () => {
    expect(punchNetwork(ON, office, '41.33.10.9')).toEqual({ network: 'Main line', refused: false });
    expect(punchNetwork(ON, office, '197.45.1.9')).toEqual({ network: null, refused: true });
    expect(punchNetwork(ON, office, null)).toEqual({ network: null, refused: true });
    // not locked: never refused, the network still named (kept at the office)
    expect(punchNetwork(ON, { workArrangement: 'hybrid' }, '41.33.10.9')).toEqual({ network: 'Main line', refused: false });
    expect(punchNetwork(ON, { workArrangement: 'wfh' }, null)).toEqual({ network: null, refused: false });
    expect(punchNetwork({ ...ON, lock: false }, office, '41.33.10.9')).toEqual({ network: 'Main line', refused: false });
    // the key missing on the server: no address is trusted, and no one is refused
    expect(punchNetwork({ ...ON, serverKey: false }, office, '41.33.10.9')).toEqual({ network: null, refused: false });
  });

  it('signs the address, the time and the token’s hash, and takes a key of 32 characters or more', () => {
    expect(clientIpPayload('41.33.10.2', '1792500000000', 'ab12')).toBe('people-client-ip-v1\n41.33.10.2\n1792500000000\nab12');
    expect(webKeyUsable('k'.repeat(32))).toBe(true);
    expect(webKeyUsable(` ${'k'.repeat(31)} `)).toBe(false);
    expect(webKeyUsable(undefined)).toBe(false);
  });
});

describe('several check-in locations (owner, 20 October 2026: "Own page, several locations")', () => {
  const HEAD = { name: 'Head office', latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
  const STUDIO = { name: 'Studio', latitude: 30.0444, longitude: 31.2357, radiusMetres: 100 };
  const NEAR_STUDIO = { latitude: 30.0446, longitude: 31.2359, accuracy: 12 };

  it('is at the office within any location’s radius, naming the nearest it is within', () => {
    expect(checkInPlace(NEAR_STUDIO, [HEAD, STUDIO])).toEqual({ place: 'office', accuracyMetres: 12, location: 'Studio' });
    expect(checkInPlace({ latitude: 30.0601, longitude: 31.3465 }, [HEAD, STUDIO])).toEqual({ place: 'office', accuracyMetres: null, location: 'Head office' });
    // two overlapping: the nearer
    const annex = { name: 'Annex', latitude: 30.047, longitude: 31.238, radiusMetres: 500 };
    expect(checkInPlace(NEAR_STUDIO, [annex, STUDIO]).location).toBe('Studio');
  });

  it('is remote outside them all, and unknown without a reading or a location with its point', () => {
    expect(checkInPlace({ latitude: 30.1, longitude: 31.5, accuracy: 20 }, [HEAD, STUDIO])).toEqual({ place: 'remote', accuracyMetres: 20 });
    expect(checkInPlace(null, [HEAD, STUDIO])).toEqual({ place: 'unknown', accuracyMetres: null });
    expect(checkInPlace(NEAR_STUDIO, [])).toEqual({ place: 'unknown', accuracyMetres: 12 });
    expect(checkInPlace(NEAR_STUDIO, [{ latitude: null, longitude: null, radiusMetres: 150 }])).toEqual({ place: 'unknown', accuracyMetres: 12 });
    expect(checkInLocationsSet([HEAD])).toBe(true);
    expect(checkInLocationsSet([])).toBe(false);
  });

  it('checks a location: a name, both coordinates, the radius from 20 to 5,000', () => {
    expect(checkInLocationProblems(HEAD)).toEqual([]);
    expect(checkInLocationProblems({ ...HEAD, name: ' ' })).toEqual(['Name the location, e.g. Head office.']);
    expect(checkInLocationProblems({ ...HEAD, name: 'x'.repeat(81) })).toEqual(["Keep the location's name to 80 characters or fewer."]);
    expect(checkInLocationProblems({ ...HEAD, longitude: null })).toEqual(["Enter the location's latitude and longitude, e.g. 30.0596 and 31.3462, or use your current location."]);
    expect(checkInLocationProblems({ ...HEAD, latitude: 95 })).toEqual(["Enter the location's latitude from -90 to 90, e.g. 30.0596."]);
    expect(checkInLocationProblems({ ...HEAD, radiusMetres: 10 })).toEqual(["Enter the location's radius in whole metres from 20 to 5,000, e.g. 150."]);
  });
});
