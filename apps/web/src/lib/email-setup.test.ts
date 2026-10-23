import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { EMAIL_SETTINGS_PATH, isEmailNotSetUp, seesEmailSettings, setsUpEmail } from './email-setup';

// The company's email set up in the system (owner, 23 October 2026: "why dont we add SMTP setup in the organization
// setup"): who sees Email Settings, who is offered "Set up email", and when the API's words say email isn't set up.

const as = (...roles: Role[]) => ({ roles });
const viewing = { by: { id: 'u1', email: 'owner@trendlix.com' }, act: false };

describe('Email Settings', () => {
  it('is a Super Admin’s page, at Organization → Email Settings', () => {
    expect(EMAIL_SETTINGS_PATH).toBe('/organization/email');
    expect(seesEmailSettings(as('employee', 'super_admin'))).toBe(true);
    for (const r of ['admin', 'hr', 'ceo', 'finance', 'manager', 'employee'] as const) expect(seesEmailSettings(as(r))).toBe(false);
  });

  it('is never a developer’s, though they are answered with a Super Admin’s sight', () => {
    expect(seesEmailSettings({ roles: ['employee', 'hr', 'finance', 'ceo', 'admin', 'super_admin'], developer: true })).toBe(false);
    expect(setsUpEmail({ roles: ['super_admin'], developer: true })).toBe(false);
  });

  it('offers "Set up email" to a Super Admin in their own session only', () => {
    expect(setsUpEmail(as('super_admin'))).toBe(true);
    expect(setsUpEmail({ roles: ['super_admin'], viewAs: null })).toBe(true);
    // viewing as another Super Admin, view only or acting: the page asks to switch back
    expect(setsUpEmail({ roles: ['super_admin'], viewAs: viewing })).toBe(false);
    expect(setsUpEmail({ roles: ['super_admin'], viewAs: { ...viewing, act: true } })).toBe(false);
    expect(setsUpEmail(as('admin'))).toBe(false);
    expect(setsUpEmail(as('hr'))).toBe(false);
  });
});

describe('isEmailNotSetUp', () => {
  it('finds the API’s "not set up" words, with either apostrophe, in a text or a list', () => {
    expect(isEmailNotSetUp("Email isn't set up on the server yet: copy each person's link from their profile instead.")).toBe(true);
    expect(isEmailNotSetUp('Email isn’t set up on the server: tell the candidate yourself.')).toBe(true);
    expect(isEmailNotSetUp(['Something else.', "Email isn't set up on the server yet: copy the link and send it yourself."])).toBe(true);
  });

  it('is false for other refusals and for nothing', () => {
    expect(isEmailNotSetUp('The email provider refused it: tell the candidate yourself.')).toBe(false);
    expect(isEmailNotSetUp(['Only HR, an Admin or a Super Admin send invitations.'])).toBe(false);
    expect(isEmailNotSetUp([])).toBe(false);
    expect(isEmailNotSetUp(null)).toBe(false);
    expect(isEmailNotSetUp(undefined)).toBe(false);
  });
});
