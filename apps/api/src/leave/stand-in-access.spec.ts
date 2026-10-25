import type { SessionUser } from '../auth/session-user.js';
import { decidedOnBehalfOf, decidesStage, seesRequest, standingInFor, standInRefusal, waitingWhere, type Caller } from './access.js';
import type { StandInView } from './stand-ins.js';

// Stand-ins (owner, 25 October 2026: "To a stand-in"): while an approver is on approved leave with a stand-in, what
// waits at their step is the stand-in's to see and decide instead, then back; never the stand-in's own, never a C-level
// person's to a stand-in who doesn't see C-level people; HR's step never moves.

const user = (roles: SessionUser['roles']): SessionUser => ({ id: 'user', email: 'x@test.local', roles }) as SessionUser;
const cLevel = new Set(['cto']);
const caller = (roles: SessionUser['roles'], employeeId: string | null, standIn?: StandInView, sees = false): Caller => ({
  user: user(roles),
  employeeId,
  confidential: { sees, all: cLevel, hidden: sees ? new Set() : new Set([...cLevel].filter((id) => id !== employeeId)) },
  standIn,
});

// Mona (a manager) is on leave until 14/11; Sara stands in for her
const monaAway: StandInView = { for: new Map(), away: { employeeId: 'sara', seesConfidential: false, until: '2026-11-14', name: 'Sara Ali' } };
const saraStands: StandInView = { for: new Map([['mona', { fullNameEn: 'Mona Adel', until: '2026-11-14', viaHr: false }]]), away: null };
const hrStands: StandInView = { for: new Map([['mona', { fullNameEn: 'Mona Adel', until: '2026-11-14', viaHr: true }]]), away: null };
const ben = { employeeId: 'ben', managerId: 'mona', currentManagerId: 'mona' };

describe('stand-ins', () => {
  it('the stand-in sees and decides the manager stage instead; the approver away doesn’t, told why', () => {
    const sara = caller(['employee'], 'sara', saraStands);
    const mona = caller(['manager'], 'mona', monaAway);
    expect(seesRequest(ben, sara)).toBe(true);
    expect(decidesStage('manager', ben, sara)).toBe(true);
    expect(decidesStage('hr', ben, sara)).toBe(false);
    expect(standingInFor(ben, sara)).toEqual({ id: 'mona', fullNameEn: 'Mona Adel' });
    expect(decidedOnBehalfOf('manager', ben, sara)).toBe('mona');
    expect(decidedOnBehalfOf('hr', ben, sara)).toBeNull();
    expect(decidesStage('manager', ben, mona)).toBe(false);
    expect(standInRefusal({ ...ben, status: 'with_manager' }, mona)).toBe('You are on leave until 14/11/2026, so Sara Ali decides this request meanwhile, standing in for you.');
    expect(standInRefusal({ ...ben, status: 'with_hr' }, mona)).toBeNull();
    // the approver still sees it, as the one it was sent to
    expect(seesRequest(ben, mona)).toBe(true);
  });

  it('back to the approver when the leave is over: no stand-in in force', () => {
    expect(decidesStage('manager', ben, caller(['manager'], 'mona'))).toBe(true);
    expect(decidesStage('manager', ben, caller(['employee'], 'sara'))).toBe(false);
    expect(seesRequest(ben, caller(['employee'], 'sara'))).toBe(false);
  });

  it('never the stand-in’s own request: it stays with the approver', () => {
    const saras = { employeeId: 'sara', managerId: 'mona', currentManagerId: 'mona' };
    expect(decidesStage('manager', saras, caller(['employee'], 'sara', saraStands))).toBe(false);
    expect(decidesStage('manager', saras, caller(['manager'], 'mona', monaAway))).toBe(true);
    expect(standInRefusal({ ...saras, status: 'with_manager' }, caller(['manager'], 'mona', monaAway))).toBeNull();
  });

  it('never a C-level person’s to a stand-in who doesn’t see C-level people: it stays with the approver', () => {
    const ctos = { employeeId: 'cto', managerId: 'mona', currentManagerId: 'mona' };
    expect(seesRequest(ctos, caller(['employee'], 'sara', saraStands))).toBe(false);
    expect(decidesStage('manager', ctos, caller(['employee'], 'sara', saraStands))).toBe(false);
    expect(decidesStage('manager', ctos, caller(['manager'], 'mona', monaAway))).toBe(true);
    // a CEO standing in sees them
    const ceoAway: StandInView = { for: new Map(), away: { employeeId: 'ceo', seesConfidential: true, until: '2026-11-14', name: 'The CEO' } };
    expect(decidesStage('manager', ctos, caller(['manager'], 'mona', ceoAway))).toBe(false);
    expect(decidesStage('manager', ctos, caller(['ceo'], 'ceo', saraStands, true))).toBe(true);
  });

  it('HR standing in: anyone holding HR decides the manager stage, never a C-level person’s, never their own', () => {
    expect(decidesStage('manager', ben, caller(['hr'], 'hana', hrStands))).toBe(true);
    expect(decidesStage('manager', { ...ben, employeeId: 'hana' }, caller(['hr'], 'hana', hrStands))).toBe(false);
    expect(decidesStage('manager', { ...ben, employeeId: 'cto' }, caller(['hr', 'super_admin'], 'hana', hrStands, true))).toBe(false);
  });

  it('waiting: the stand-in’s include the approver’s; the approver’s keep only what doesn’t move', () => {
    const sara = waitingWhere(caller(['employee'], 'sara', saraStands));
    expect(sara).toEqual({
      OR: [
        { status: 'with_manager', managerId: 'sara' },
        { managerId: { in: ['mona'] }, employeeId: { notIn: ['cto'] }, status: 'with_manager' },
      ],
      employeeId: { not: 'sara' },
    });
    const mona = waitingWhere(caller(['manager'], 'mona', monaAway));
    expect(mona).toEqual({ OR: [{ status: 'with_manager', managerId: 'mona', OR: [{ employeeId: 'sara' }, { employeeId: { in: ['cto'] } }] }], employeeId: { not: 'mona' } });
    expect(waitingWhere(caller(['manager'], 'mona'))).toEqual({ OR: [{ status: 'with_manager', managerId: 'mona' }], employeeId: { not: 'mona' } });
  });
});
