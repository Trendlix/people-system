import { assetsAccessOf, seesConfidential, type ClearanceOwner, type Role } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';

// Who does what in offboarding (owner, 22 October 2026: the full module; the brief: "HR, the CEO and Super Admin" handle
// the cases; each clearance item has the role that clears it). Pure, tested in offboarding.spec.ts.

/** Those who handle the cases: open, complete, the exit interview, rehire eligibility, the reports. */
export const OFFBOARDING_MANAGERS: readonly Role[] = ['hr', 'ceo', 'super_admin'];

/** Whether the caller handles the cases (a C-level person's only if they see C-level people: checked apart). */
export const managesOffboarding = (user: Pick<SessionUser, 'roles'>): boolean => user.roles.some((r) => OFFBOARDING_MANAGERS.includes(r));

/** What the caller is, for the items they clear. */
export interface OffboardingCaller {
  user: SessionUser;
  /** HR, the CEO or a Super Admin. */
  manages: boolean;
  /** The CEO or a Super Admin: they see C-level people's cases. */
  seesConfidential: boolean;
  /** Their own employee profile's id, if any: the direct manager of the employments they manage. */
  selfId: string | null;
  admin: boolean;
  finance: boolean;
  hr: boolean;
  /** An Assets custodian or manager. */
  assets: boolean;
}

export function offboardingCaller(user: SessionUser, selfId: string | null, assetsAccess: string | null | undefined): OffboardingCaller {
  const access = assetsAccessOf({ roles: user.roles, assetsAccess });
  return {
    user,
    manages: managesOffboarding(user),
    seesConfidential: seesConfidential(user),
    selfId,
    admin: actsAs(user.roles, ['admin']),
    finance: user.roles.includes('finance'),
    hr: user.roles.includes('hr'),
    assets: access === 'custodian' || access === 'manager',
  };
}

/** Whether the caller clears items of this owner on a case whose employment is managed by `managerId`. */
export function holdsOwner(caller: OffboardingCaller, owner: ClearanceOwner, managerId: string | null): boolean {
  switch (owner) {
    case 'hr':
      return caller.manages;
    case 'manager':
      return !!managerId && managerId === caller.selfId;
    case 'admin':
      return caller.admin;
    case 'finance':
      return caller.finance;
    case 'assets':
      return caller.assets;
  }
}

/** Whether the caller may mark an item: an open case's item cleared by a person, theirs to clear, or anyone's for HR, the CEO and a Super Admin. */
export function marksItem(caller: OffboardingCaller, item: { kind: string; owner: ClearanceOwner }, managerId: string | null, caseOpen: boolean): boolean {
  if (!caseOpen || item.kind !== 'manual') return false;
  return caller.manages || holdsOwner(caller, item.owner, managerId);
}
