import {
  EMPLOYEE_LEVEL_SEES_RAISES,
  RAISE_REQUEST_ROLES,
  RAISE_REQUESTS_ASKED_BY_HR,
  RAISE_REQUESTS_SEEN_BY_HR,
  raiseRequestAccess,
  seesRaiseRequests,
  type Role,
} from '@trendlix/shared';

// Raise requests kept from the employee level (owner, 20 October 2026: "raises not to be visible to employee level for
// now", then "Hide from managers too"): one switch in packages/shared raises.ts, and the helpers the API and the pages
// both decide with. The rules from before the switch stay covered for when it comes back.

const roleSets: Role[][] = [
  ['employee'],
  ['manager'],
  ['employee', 'manager'],
  ['admin'],
  ['hr'],
  ['hr', 'manager'],
  ['finance'],
  ['finance', 'manager'],
  ['ceo'],
  ['super_admin'],
  ['super_admin', 'manager'],
  ['super_admin', 'hr'],
  [],
];
const relations = [
  { self: false, manager: false },
  { self: true, manager: false },
  { self: false, manager: true },
];

/** Who asked and who saw before 20 October 2026, as RaiseRequestsService worked it out. */
function before(roles: Role[], self: boolean, manager: boolean) {
  const hr = roles.includes('hr');
  const full = roles.some((r) => r === 'hr' || r === 'finance' || r === 'ceo');
  return {
    requester: self ? 'self' : hr ? 'hr' : manager ? 'manager' : null,
    viewer: full ? 'full' : self ? 'self' : manager ? 'manager' : null,
  };
}

const atEmployeeLevel = (roles: Role[]) => !roles.some((r) => (RAISE_REQUEST_ROLES as readonly Role[]).includes(r));

describe('the switch', () => {
  it('is off for now: the employee level sees no raise requests', () => {
    expect(EMPLOYEE_LEVEL_SEES_RAISES).toBe(false);
    expect(RAISE_REQUEST_ROLES).toEqual(['hr', 'finance', 'ceo', 'super_admin']);
  });

  it('decides by default, as the API and the pages call the helpers', () => {
    for (const roles of roleSets) {
      expect(seesRaiseRequests({ roles })).toBe(seesRaiseRequests({ roles }, EMPLOYEE_LEVEL_SEES_RAISES));
      for (const r of relations) expect(raiseRequestAccess({ roles, ...r })).toEqual(raiseRequestAccess({ roles, ...r }, EMPLOYEE_LEVEL_SEES_RAISES));
    }
  });

  it('says why to whoever is refused', () => {
    expect(RAISE_REQUESTS_ASKED_BY_HR).toMatch(/made by HR only for now/);
    expect(RAISE_REQUESTS_SEEN_BY_HR).toMatch(/seen only by HR, Finance and the CEO/);
  });
});

describe('who sees raise requests', () => {
  it('while off: HR, Finance, the CEO and a Super Admin; never an employee, a direct manager or an Admin', () => {
    for (const roles of [['hr'], ['finance'], ['ceo'], ['super_admin'], ['hr', 'manager'], ['super_admin', 'manager']] as Role[][]) {
      expect(seesRaiseRequests({ roles }, false)).toBe(true);
    }
    for (const roles of [['employee'], ['manager'], ['employee', 'manager'], ['admin'], []] as Role[][]) {
      expect(seesRaiseRequests({ roles }, false)).toBe(false);
    }
  });

  it('while on, as before: everyone (the API then decides whose)', () => {
    for (const roles of roleSets) expect(seesRaiseRequests({ roles }, true)).toBe(true);
  });
});

describe('what someone may do with a person’s raise requests', () => {
  it('while off, the employee level neither asks nor sees: not for themself, not as a direct manager', () => {
    const none = { requester: null, viewer: null };
    expect(raiseRequestAccess({ roles: ['employee'], self: true, manager: false }, false)).toEqual(none);
    expect(raiseRequestAccess({ roles: ['manager'], self: false, manager: true }, false)).toEqual(none);
    expect(raiseRequestAccess({ roles: ['employee', 'manager'], self: true, manager: false }, false)).toEqual(none);
    expect(raiseRequestAccess({ roles: ['admin'], self: true, manager: false }, false)).toEqual(none);
  });

  it('while off, HR asks for anyone and sees all of it; Finance and the CEO see all of it; as before', () => {
    expect(raiseRequestAccess({ roles: ['hr'], self: false, manager: false }, false)).toEqual({ requester: 'hr', viewer: 'full' });
    expect(raiseRequestAccess({ roles: ['hr', 'manager'], self: false, manager: true }, false)).toEqual({ requester: 'hr', viewer: 'full' });
    expect(raiseRequestAccess({ roles: ['finance'], self: false, manager: false }, false)).toEqual({ requester: null, viewer: 'full' });
    expect(raiseRequestAccess({ roles: ['ceo'], self: false, manager: false }, false)).toEqual({ requester: null, viewer: 'full' });
  });

  it('while off, HR, Finance, the CEO and a Super Admin get exactly what they got before', () => {
    for (const roles of roleSets.filter((r) => !atEmployeeLevel(r))) {
      for (const { self, manager } of relations) expect(raiseRequestAccess({ roles, self, manager }, false)).toEqual(before(roles, self, manager));
    }
  });

  it('while on, everyone as before 20 October 2026: the employee for themself, HR for anyone, the direct manager for a report', () => {
    for (const roles of roleSets) {
      for (const { self, manager } of relations) expect(raiseRequestAccess({ roles, self, manager }, true)).toEqual(before(roles, self, manager));
    }
    expect(raiseRequestAccess({ roles: ['employee'], self: true, manager: false }, true)).toEqual({ requester: 'self', viewer: 'self' });
    expect(raiseRequestAccess({ roles: ['manager'], self: false, manager: true }, true)).toEqual({ requester: 'manager', viewer: 'manager' });
    // HR asking for themself asks as the employee, and sees all of it
    expect(raiseRequestAccess({ roles: ['hr'], self: true, manager: false }, true)).toEqual({ requester: 'self', viewer: 'full' });
    expect(raiseRequestAccess({ roles: ['employee'], self: false, manager: false }, true)).toEqual({ requester: null, viewer: null });
  });
});
