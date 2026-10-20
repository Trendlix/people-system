import {
  attendanceDayView,
  attendanceFigures,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_FLAGS,
  CHECK_IN_PLACE_LABELS,
  checkInFlags,
  checkInPlace,
  countsAsRemote,
  dayFromPunches,
  decidesHomeStage,
  HOME_OPEN_ALREADY,
  HOME_RADIUS_DEFAULT,
  homeDecisionStepKind,
  homeLabelOf,
  homeRadiusProblems,
  homeRequestProblems,
  homeStage,
  homeStageName,
  homeStatusAfterApproval,
  homeStatusLabel,
  isOpenHome,
  keepsHomePoint,
  matchesAttendanceFilter,
  punchFlags,
  punchMessages,
  removesHome,
  seesHome,
  seesHomeLocations,
  waitsForHome,
  withdrawsHome,
  zonedMoment,
  type KeptDay,
  type Role,
} from '@trendlix/shared';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO", everyone may ask; packages/shared
// home-locations.ts and check-in.ts): the place order (office, home, remote, unknown), the flag "Not at home or the
// office", home counted as remote, and the request's rules: what is asked, where it stands, who sees and decides it.

// an office and a home at invented points in Cairo, and points around them
const OFFICE = { latitude: 30.0596, longitude: 31.3462, radiusMetres: 150, name: 'Head office' };
const HOME = { latitude: 30.0444, longitude: 31.2357, radiusMetres: 100 };
const AT_HOME = { latitude: 30.0449, longitude: 31.2359, accuracy: 12.4 }; // about 55 m from home
const NEAR_HOME = { latitude: 30.0456, longitude: 31.2357, accuracy: 9 }; // about 133 m from home
const AT_OFFICE = { latitude: 30.0601, longitude: 31.3465, accuracy: 18 };
const CAFE = { latitude: 29.9792, longitude: 31.1342, accuracy: 30 }; // Giza, far from both
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();

const user = (...roles: Role[]) => ({ roles });
const HR = user('hr');
const CEO = user('ceo');
const SUPER = user('super_admin');
const HR_SUPER = user('hr', 'super_admin');
const FINANCE = user('finance');
const MANAGER = user('manager');
const ADMIN = user('admin');
const EMPLOYEE = user('employee');
const ordinary = { own: false, confidential: false };
const cLevel = { own: false, confidential: true };

describe('where a check-in was, with an approved home', () => {
  it('is the office first, then home within its radius, then remote, then unknown', () => {
    expect(checkInPlace(AT_OFFICE, [OFFICE], HOME)).toEqual({ place: 'office', accuracyMetres: 18, location: 'Head office' });
    expect(checkInPlace(AT_HOME, [OFFICE], HOME)).toEqual({ place: 'home', accuracyMetres: 12 });
    expect(checkInPlace(CAFE, [OFFICE], HOME)).toEqual({ place: 'remote', accuracyMetres: 30 });
    expect(checkInPlace(null, [OFFICE], HOME)).toEqual({ place: 'unknown', accuracyMetres: null });
    // the home's radius: 133 m away is outside 100 m, inside 150 m (as HR may set it)
    expect(checkInPlace(NEAR_HOME, [OFFICE], HOME).place).toBe('remote');
    expect(checkInPlace(NEAR_HOME, [OFFICE], { ...HOME, radiusMetres: 150 }).place).toBe('home');
  });

  it('is the office when the home is within an office location too', () => {
    expect(checkInPlace(AT_OFFICE, [OFFICE], { latitude: OFFICE.latitude, longitude: OFFICE.longitude, radiusMetres: 100 }).place).toBe('office');
  });

  it('is home even with no office location set, anywhere else unknown as before', () => {
    expect(checkInPlace(AT_HOME, [], HOME).place).toBe('home');
    expect(checkInPlace(CAFE, [], HOME).place).toBe('unknown');
  });

  it('is as before for a person without a home', () => {
    expect(checkInPlace(AT_HOME, [OFFICE])).toEqual({ place: 'remote', accuracyMetres: 12 });
    expect(checkInPlace(AT_HOME, [OFFICE], null).place).toBe('remote');
    expect(checkInPlace(AT_HOME, [OFFICE], { latitude: null, longitude: null, radiusMetres: 100 }).place).toBe('remote');
  });

  it('is labelled Home, and counts as remote', () => {
    expect(CHECK_IN_PLACE_LABELS.home).toBe('Home');
    expect([countsAsRemote('home'), countsAsRemote('remote'), countsAsRemote('office'), countsAsRemote('unknown'), countsAsRemote(null)]).toEqual([true, true, false, false, false]);
  });
});

describe('the flag "Not at home or the office"', () => {
  it('flags a remote check-in by someone with an approved home, whatever the arrangement', () => {
    expect(CHECK_IN_FLAGS).toContain('not_home_or_office');
    expect(CHECK_IN_FLAG_LABELS.not_home_or_office).toBe('Not at home or the office');
    expect(checkInFlags('anywhere', 'remote', false, true)).toEqual(['not_home_or_office']);
    expect(checkInFlags('anywhere', 'home', false, true)).toEqual([]);
    expect(checkInFlags('anywhere', 'office', false, true)).toEqual([]);
    expect(checkInFlags('anywhere', 'unknown', false, true)).toEqual([]);
  });

  it('comes alongside the other flags', () => {
    expect(checkInFlags('office', 'remote', false, true)).toEqual(['outside_office', 'not_home_or_office']);
    expect(checkInFlags('office', 'remote', true, true)).toEqual(['outside_office', 'fake_gps', 'not_home_or_office']);
    expect(checkInFlags('office', 'unknown', false, true)).toEqual(['location_unknown']);
  });

  it('flags home on an office day as outside the office: home counts as remote', () => {
    expect(checkInFlags('office', 'home')).toEqual(['outside_office']);
    expect(checkInFlags('office', 'home', false, true)).toEqual(['outside_office']);
  });

  it('never flags someone without a home, nor a check-out', () => {
    expect(checkInFlags('anywhere', 'remote')).toEqual([]);
    expect(checkInFlags('anywhere', 'remote', false, false)).toEqual([]);
    expect(punchFlags('in', 'anywhere', 'remote', false, true)).toEqual(['not_home_or_office']);
    expect(punchFlags('out', 'anywhere', 'remote', false, true)).toEqual([]);
    expect(punchFlags('out', 'anywhere', 'remote', true, true)).toEqual(['fake_gps']);
  });

  it('keeps the flag on the day its check-in makes', () => {
    const day = '2026-10-13';
    const d = dayFromPunches(
      day,
      [
        { kind: 'in', at: at(day, '09:00'), place: 'remote', flags: ['not_home_or_office'] },
        { kind: 'out', at: at(day, '18:00'), place: 'remote', flags: [] },
      ],
      MORNING,
    );
    expect(d).toMatchObject({ place: 'remote', flags: ['not_home_or_office'], hoursCounted: 9 });
  });

  it('says so once the punch is kept, and a check-in at home is "at home"', () => {
    const now = at('2026-10-13', '09:05');
    expect(punchMessages({ kind: 'in', at: now, place: 'home', flags: [] }, [])).toEqual(['Checked in at 9:05 AM, at home.']);
    expect(punchMessages({ kind: 'in', at: now, place: 'remote', flags: ['not_home_or_office'] }, [])).toEqual([
      'Checked in at 9:05 AM, remote.',
      'Not at home or the office: you checked in away from the office and from your approved home. It is kept, and your manager and HR see it flagged.',
    ]);
  });
});

describe('a day at home', () => {
  const kept = (place: KeptDay['place'], flags: string[] = []): KeptDay => ({
    date: '2026-10-13',
    status: 'worked',
    checkIn: '2026-10-13T06:00:00.000Z',
    checkOut: '2026-10-13T15:00:00.000Z',
    place,
    zohoStatus: null,
    permissionHours: 0,
    hoursCounted: 9,
    source: 'system',
    flags,
  });

  it('counts as a remote day, listed under "Only with remote days"; the flag under "Only with flagged check-ins"', () => {
    const f = attendanceFigures([attendanceDayView(kept('home'), 9), attendanceDayView(kept('remote', ['not_home_or_office']), 9), attendanceDayView(kept('office'), 9)]);
    expect(f).toMatchObject({ remoteDays: 2, officeDays: 1, flaggedDays: 1 });
    expect(matchesAttendanceFilter(f, 'remote')).toBe(true);
    expect(matchesAttendanceFilter(f, 'flagged')).toBe(true);
    expect(attendanceDayView(kept('remote', ['not_home_or_office', 'not_a_flag']), 9).flags).toEqual(['not_home_or_office']);
  });
});

describe('what is asked', () => {
  it('needs the point, on the map, and a label of up to 200 characters if any', () => {
    expect(homeRequestProblems({ latitude: 30.0444, longitude: 31.2357 })).toEqual([]);
    expect(homeRequestProblems({ latitude: 30.0444, longitude: 31.2357, label: 'Home, Nasr City' })).toEqual([]);
    expect(homeRequestProblems({ latitude: null, longitude: 31.2357 })).toEqual(['Put your home on the map, or use your current location while at home.']);
    expect(homeRequestProblems({ latitude: undefined, longitude: undefined })).toHaveLength(1);
    expect(homeRequestProblems({ latitude: 95, longitude: 31 })).toEqual(['That point isn’t on the map: put your home on the map again.']);
    expect(homeRequestProblems({ latitude: 30, longitude: 31, label: 'x'.repeat(201) })).toEqual(['Keep the label to 200 characters or fewer.']);
    expect(homeRequestProblems({ latitude: 30, longitude: 31, label: ` ${'x'.repeat(200)} ` })).toEqual([]);
  });

  it('keeps a label tidied, and none for spaces', () => {
    expect(homeLabelOf('  Home,   Nasr City ')).toBe('Home, Nasr City');
    expect(homeLabelOf('   ')).toBeNull();
    expect(homeLabelOf(null)).toBeNull();
  });

  it('starts the radius at 100 m, which HR sets in whole metres from 20 to 5,000', () => {
    expect(HOME_RADIUS_DEFAULT).toBe(100);
    expect(homeRadiusProblems(100)).toEqual([]);
    expect(homeRadiusProblems(20)).toEqual([]);
    expect(homeRadiusProblems(5000)).toEqual([]);
    expect(homeRadiusProblems(19)).toEqual(['Enter the radius in whole metres from 20 to 5,000, e.g. 100.']);
    expect(homeRadiusProblems(5001)).toHaveLength(1);
    expect(homeRadiusProblems(120.5)).toHaveLength(1);
    expect(HOME_OPEN_ALREADY).toContain('withdraw it first');
  });
});

describe('where a request stands', () => {
  it('goes HR, then the CEO, then approved', () => {
    expect([homeStage('with_hr'), homeStage('with_ceo'), homeStage('approved'), homeStage('rejected')]).toEqual(['hr', 'ceo', null, null]);
    expect([homeStatusAfterApproval('hr'), homeStatusAfterApproval('ceo')]).toEqual(['with_ceo', 'approved']);
    expect([homeDecisionStepKind('hr'), homeDecisionStepKind('ceo')]).toEqual(['hr_decision', 'ceo_decision']);
    expect(['with_hr', 'with_ceo', 'approved', 'withdrawn'].map(isOpenHome)).toEqual([true, true, false, false]);
  });

  it('keeps its point only while it is being decided or in force', () => {
    expect(['with_hr', 'with_ceo', 'approved'].every(keepsHomePoint)).toBe(true);
    expect(['rejected', 'withdrawn', 'replaced', 'removed'].some(keepsHomePoint)).toBe(false);
  });

  it('shows a C-level person’s at HR’s step as with the CEO', () => {
    expect(homeStatusLabel('with_hr')).toBe('With HR');
    expect(homeStatusLabel('with_hr', true)).toBe('With the CEO');
    expect(homeStatusLabel('with_ceo', true)).toBe('With the CEO');
    expect(homeStatusLabel('replaced')).toBe('Replaced');
    expect([homeStageName('hr'), homeStageName('hr', true), homeStageName('ceo')]).toEqual(['HR', 'the CEO', 'the CEO']);
  });
});

describe('who sees and decides a home location', () => {
  it('is seen by its employee, HR, the CEO and the Super Admin; never managers, Finance or an Admin', () => {
    expect([HR, CEO, SUPER, HR_SUPER].every(seesHomeLocations)).toBe(true);
    expect([FINANCE, MANAGER, ADMIN, EMPLOYEE].some(seesHomeLocations)).toBe(false);
    expect(seesHome(EMPLOYEE, { own: true, confidential: false })).toBe(true);
    expect(seesHome(MANAGER, ordinary)).toBe(false);
    expect(seesHome(FINANCE, ordinary)).toBe(false);
    expect(seesHome(HR, ordinary)).toBe(true);
  });

  it('keeps a C-level person’s from HR: the CEO and the Super Admin see it, and the person themself', () => {
    expect(seesHome(HR, cLevel)).toBe(false);
    expect(seesHome(CEO, cLevel)).toBe(true);
    expect(seesHome(SUPER, cLevel)).toBe(true);
    expect(seesHome(HR_SUPER, cLevel)).toBe(true);
    expect(seesHome(EMPLOYEE, { own: true, confidential: true })).toBe(true);
  });

  it('is decided by HR, then the CEO; nobody their own', () => {
    expect(decidesHomeStage(HR, 'hr', ordinary)).toBe(true);
    expect(decidesHomeStage(CEO, 'hr', ordinary)).toBe(false);
    expect(decidesHomeStage(SUPER, 'hr', ordinary)).toBe(false);
    expect(decidesHomeStage(CEO, 'ceo', ordinary)).toBe(true);
    expect(decidesHomeStage(HR, 'ceo', ordinary)).toBe(false);
    expect(decidesHomeStage(HR, 'hr', { own: true, confidential: false })).toBe(false);
    expect(decidesHomeStage(CEO, 'ceo', { own: true, confidential: false })).toBe(false);
  });

  it('has both steps of a C-level person’s taken by the CEO (HR’s by HR with Super Admin too)', () => {
    expect(decidesHomeStage(CEO, 'hr', cLevel)).toBe(true);
    expect(decidesHomeStage(CEO, 'ceo', cLevel)).toBe(true);
    expect(decidesHomeStage(HR, 'hr', cLevel)).toBe(false);
    expect(decidesHomeStage(HR_SUPER, 'hr', cLevel)).toBe(true);
    expect(decidesHomeStage(HR_SUPER, 'ceo', cLevel)).toBe(false);
  });

  it('has a CEO’s own CEO step taken by a Super Admin', () => {
    const ceosOwn = { own: false, confidential: true, byCeo: true };
    expect(decidesHomeStage(SUPER, 'ceo', ceosOwn)).toBe(true);
    expect(decidesHomeStage(SUPER, 'ceo', cLevel)).toBe(false);
    expect(decidesHomeStage(CEO, 'ceo', { ...ceosOwn, own: true })).toBe(false);
  });

  it('waits for whoever decides its stage now', () => {
    expect(waitsForHome(HR, { ...ordinary, status: 'with_hr' })).toBe(true);
    expect(waitsForHome(HR, { ...ordinary, status: 'with_ceo' })).toBe(false);
    expect(waitsForHome(CEO, { ...ordinary, status: 'with_ceo' })).toBe(true);
    expect(waitsForHome(CEO, { ...ordinary, status: 'approved' })).toBe(false);
    expect(waitsForHome(CEO, { ...cLevel, status: 'with_hr' })).toBe(true);
    expect(waitsForHome(MANAGER, { ...ordinary, status: 'with_hr' })).toBe(false);
  });

  it('is withdrawn by its employee while being decided, and removed once approved by them or by those who see it', () => {
    expect(withdrawsHome({ own: true, status: 'with_hr' })).toBe(true);
    expect(withdrawsHome({ own: true, status: 'with_ceo' })).toBe(true);
    expect(withdrawsHome({ own: true, status: 'approved' })).toBe(false);
    expect(withdrawsHome({ own: false, status: 'with_hr' })).toBe(false);
    expect(removesHome(EMPLOYEE, { own: true, confidential: false, status: 'approved' })).toBe(true);
    expect(removesHome(HR, { ...ordinary, status: 'approved' })).toBe(true);
    expect(removesHome(CEO, { ...cLevel, status: 'approved' })).toBe(true);
    expect(removesHome(HR, { ...cLevel, status: 'approved' })).toBe(false);
    expect(removesHome(MANAGER, { ...ordinary, status: 'approved' })).toBe(false);
    expect(removesHome(HR, { ...ordinary, status: 'with_hr' })).toBe(false);
  });
});
