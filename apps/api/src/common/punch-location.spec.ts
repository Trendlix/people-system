import {
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_FLAG_SHORT_LABELS,
  CHECK_IN_FLAGS,
  LOCATION_NEEDED_TEXT,
  locationRefusal,
  needsLocation,
  NO_LOCATION_MESSAGE,
  punchPoint,
  seesPunchPoints,
  SPOT_KEPT_TEXT,
  type Role,
} from '@trendlix/shared';

// Where each press was (owner, 20 October 2026: "simplify this, i want to view if it is remote or office, and location
// link"; asked, "Yes, keep the spot", seen by "HR, CEO, Super Admin"; packages/shared punch-location.ts): who gets the
// spot, the point a press is shown at (its own, else an old office press's location), and refusing a press without a
// location ("Company switch + exceptions", "Allow as Office"; inside the app always).

const as = (...roles: Role[]) => ({ roles });
const OTHER = { self: false, confidential: false };
const CLEVEL = { self: false, confidential: true };

describe('who sees where a press was', () => {
  it('is HR, the CEO and the Super Admin, and the employee their own', () => {
    for (const roles of [['hr'], ['ceo'], ['super_admin'], ['hr', 'manager'], ['finance', 'hr']] as Role[][]) expect(seesPunchPoints(as(...roles), OTHER)).toBe(true);
    for (const roles of [['employee'], ['manager'], ['finance'], ['admin'], ['finance', 'manager']] as Role[][]) expect(seesPunchPoints(as(...roles), OTHER)).toBe(false);
    // their own, whatever their roles
    expect(seesPunchPoints(as('employee'), { self: true, confidential: false })).toBe(true);
    expect(seesPunchPoints(as('manager'), { self: true, confidential: true })).toBe(true);
  });

  it('never shows HR a C-level person’s: the CEO and the Super Admin see it', () => {
    expect(seesPunchPoints(as('hr'), CLEVEL)).toBe(false);
    expect(seesPunchPoints(as('ceo'), CLEVEL)).toBe(true);
    expect(seesPunchPoints(as('super_admin'), CLEVEL)).toBe(true);
    expect(seesPunchPoints(as('hr', 'super_admin'), CLEVEL)).toBe(true);
    expect(seesPunchPoints(as('finance'), CLEVEL)).toBe(false);
  });
});

describe('the point a press is shown at', () => {
  const HEAD = { name: 'Head office', latitude: 30.0596, longitude: 31.3462 };
  const press = { latitude: null, longitude: null, accuracyMetres: 12, place: 'office', locationName: 'Head office' };

  it('is its own point, kept since 20 October 2026, with the reading’s accuracy', () => {
    expect(punchPoint({ ...press, latitude: 30.0601, longitude: 31.3465 }, [HEAD])).toEqual({ latitude: 30.0601, longitude: 31.3465, accuracyMetres: 12, pointFrom: 'press' });
    // a remote or unknown press with its own point too
    expect(punchPoint({ ...press, place: 'remote', locationName: null, latitude: 30.0444, longitude: 31.2357, accuracyMetres: null }, [])).toMatchObject({ pointFrom: 'press', accuracyMetres: null });
  });

  it('falls back to the location an old office press was matched to, by its name; else none', () => {
    expect(punchPoint(press, [HEAD])).toEqual({ latitude: 30.0596, longitude: 31.3462, accuracyMetres: 12, pointFrom: 'location' });
    expect(punchPoint({ ...press, locationName: ' head OFFICE ' }, [HEAD])?.pointFrom).toBe('location');
    // a location since removed, an office press on a network (no location's name), a remote one: no point
    expect(punchPoint(press, [{ ...HEAD, name: 'Studio' }])).toBeNull();
    expect(punchPoint({ ...press, locationName: null }, [HEAD])).toBeNull();
    expect(punchPoint({ ...press, place: 'remote' }, [HEAD])).toBeNull();
    expect(punchPoint({ ...press, place: 'unknown', locationName: null }, [HEAD])).toBeNull();
    // a location without its point set
    expect(punchPoint(press, [{ name: 'Head office', latitude: null, longitude: null }])).toBeNull();
  });
});

describe('refusing a press without a location', () => {
  const OFF = { refuseWithoutLocation: false };
  const ON = { refuseWithoutLocation: true };
  const nobody = {};
  const exempt = { checkInWithoutLocation: true };
  const web = { session: 'web' as const, reading: false, officeNetwork: false };

  it('takes every press with a reading, on the website and in the app', () => {
    expect(locationRefusal({ ...web, reading: true, rule: ON, person: nobody })).toBeNull();
    expect(locationRefusal({ ...web, session: 'app', reading: true, rule: ON, person: nobody })).toBeNull();
  });

  it('takes a website press without one while the switch is off', () => {
    expect(locationRefusal({ ...web, rule: OFF, person: nobody })).toBeNull();
    expect(needsLocation(OFF, nobody)).toBe(false);
  });

  it('refuses it with the switch on, unless HR exempted the person', () => {
    expect(locationRefusal({ ...web, rule: ON, person: nobody })).toBe('no_location');
    expect(locationRefusal({ ...web, rule: ON, person: { checkInWithoutLocation: false } })).toBe('no_location');
    expect(locationRefusal({ ...web, rule: ON, person: exempt })).toBeNull();
    expect(needsLocation(ON, nobody)).toBe(true);
    expect(needsLocation(ON, exempt)).toBe(false);
  });

  it('takes it from an office network the website signed (Allow as Office); not without one', () => {
    expect(locationRefusal({ ...web, rule: ON, person: nobody, officeNetwork: true })).toBeNull();
    expect(locationRefusal({ ...web, rule: ON, person: nobody, officeNetwork: false })).toBe('no_location');
  });

  it('always refuses it in the app: neither the switch, the exemption nor the office network waive it', () => {
    for (const rule of [OFF, ON]) {
      for (const person of [nobody, exempt]) {
        for (const officeNetwork of [false, true]) expect(locationRefusal({ session: 'app', reading: false, rule, person, officeNetwork })).toBe('app');
      }
    }
  });

  it('says how to allow the location in the browser, and that the spot is kept', () => {
    expect(NO_LOCATION_MESSAGE).toContain('Allow this site to use it in your browser');
    expect(NO_LOCATION_MESSAGE).toContain('attendance correction');
    expect(LOCATION_NEEDED_TEXT).toBe('Check-ins need your location: allow it when the browser asks.');
    expect(SPOT_KEPT_TEXT).toBe('Each check-in keeps the spot where you pressed, read only then; HR can see it.');
  });
});

describe('the flags in a word or two', () => {
  it('has a short label for every flag, the full words kept apart', () => {
    for (const f of CHECK_IN_FLAGS) {
      expect(CHECK_IN_FLAG_SHORT_LABELS[f]).toBeTruthy();
      expect(CHECK_IN_FLAG_SHORT_LABELS[f].length).toBeLessThanOrEqual(CHECK_IN_FLAG_LABELS[f].length);
    }
    expect(CHECK_IN_FLAG_SHORT_LABELS).toEqual({
      outside_office: 'Outside the office',
      location_unknown: 'No location',
      fake_gps: 'Fake GPS suspected',
      not_home_or_office: 'Not at home or the office',
    });
  });
});
