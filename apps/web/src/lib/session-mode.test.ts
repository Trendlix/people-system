import { describe, expect, it } from 'vitest';
import { modeCards, modeFrom, modeSwitch, mustChoose, ownRolesText, roleBadgeLabels } from './session-mode';

// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him").

const web = { kind: 'web' as const };

describe('the choice page', () => {
  it('opens alone for a website session not chosen yet, never for anyone else', () => {
    expect(mustChoose({ mode: null, session: web })).toBe(true);
    expect(mustChoose({ mode: 'self', session: web })).toBe(false);
    expect(mustChoose({ mode: 'developer', session: web })).toBe(false);
    // someone who doesn't choose: no mode at all
    expect(mustChoose({ session: web })).toBe(false);
    expect(mustChoose({ mode: undefined })).toBe(false);
    // a Super Admin viewing as them never gets it
    expect(mustChoose({ mode: null, viewAs: { by: { id: 'x', email: 'x' }, act: false } })).toBe(false);
  });

  it('two cards, As yourself with their name and roles; the last choice pre-selected, else the one in use, else As yourself', () => {
    const { cards, selected } = modeCards({ name: 'Hana Adel', roles: ['employee'], last: 'developer', mode: null });
    expect(cards.map((c) => c.mode)).toEqual(['self', 'developer']);
    expect(cards[0]).toEqual({ mode: 'self', title: 'As yourself', who: 'Hana Adel · Employee', text: 'Your profile, requests, attendance and payslips.' });
    expect(cards[1]).toMatchObject({ title: 'As a developer', who: null, text: 'The whole system, read only; names are pseudonyms and personal data is hidden.' });
    expect(selected).toBe('developer');
    expect(modeCards({ name: null, roles: ['employee'], last: null, mode: 'developer' }).selected).toBe('developer');
    expect(modeCards({ name: null, roles: ['employee'], last: null, mode: null }).selected).toBe('self');
    // no profile: the roles alone
    expect(modeCards({ name: null, roles: ['employee'], last: null, mode: null }).cards[0].who).toBe('Employee');
    expect(ownRolesText(['employee', 'manager'])).toBe('Employee · Direct manager');
  });

  it('reads only the two modes from a form', () => {
    expect(modeFrom('self')).toBe('self');
    expect(modeFrom('developer')).toBe('developer');
    expect(modeFrom('admin')).toBeNull();
    expect(modeFrom(null)).toBeNull();
  });
});

describe('the top bar’s switch', () => {
  it('shows the mode in use and turns to the other in one click', () => {
    expect(modeSwitch({ mode: 'developer', session: web })).toEqual({ mode: 'developer', text: 'Using as: Developer', to: 'self', hint: 'Switch to using it as yourself' });
    expect(modeSwitch({ mode: 'self', session: web })).toEqual({ mode: 'self', text: 'Using as: Yourself', to: 'developer', hint: 'Switch to using it as a developer' });
  });

  it('not for someone who doesn’t choose, before choosing, in the app, or while viewed as', () => {
    expect(modeSwitch({ session: web })).toBeNull();
    expect(modeSwitch({ mode: null, session: web })).toBeNull();
    expect(modeSwitch({ mode: 'self', session: { kind: 'app' } })).toBeNull();
    expect(modeSwitch({ mode: 'developer', session: web, viewAs: { by: { id: 'x', email: 'x' }, act: false } })).toBeNull();
  });
});

describe('the Users page’s roles', () => {
  it('a developer who holds another role as one badge, "Developer + Employee"; anyone else as before', () => {
    expect(roleBadgeLabels(['employee', 'developer'])).toEqual([{ key: 'developer', label: 'Developer + Employee' }]);
    expect(roleBadgeLabels(['developer'])).toEqual([{ key: 'developer', label: 'Developer' }]);
    expect(roleBadgeLabels(['employee', 'hr'])).toEqual([
      { key: 'employee', label: 'Employee' },
      { key: 'hr', label: 'HR' },
    ]);
  });
});
