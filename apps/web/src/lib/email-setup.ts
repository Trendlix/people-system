import { isSuperAdmin } from './roles';
import type { ViewAs } from './view-as';
import type { Role } from '@trendlix/shared';

// The company's email set up in the system (owner, 23 October 2026: "why dont we add SMTP setup in the organization
// setup"): Organization → Email Settings, a Super Admin's only. Where HR sends something by email and email isn't set
// up (the Access tab's links, Send invitations, job offers, interview invitations), the "not set up" message stays as it
// was, and a Super Admin gets a "Set up email" link to the page beside it. Pure code (no server-only), so client
// components and tests can use it too.

/** The Email Settings page. */
export const EMAIL_SETTINGS_PATH = '/organization/email';

type Viewer = { roles: readonly Role[]; developer?: boolean; viewAs?: ViewAs | null };

/**
 * Who sees the Email Settings tab and page: a Super Admin, never a developer (answered with a Super Admin's sight, but
 * the settings hold a mailbox and its server). While a Super Admin views as another Super Admin the tab shows, as they
 * would see it; the page then asks to switch back.
 */
export function seesEmailSettings(user: Viewer): boolean {
  return isSuperAdmin(user) && !user.developer;
}

/** Who is offered "Set up email": a Super Admin in their own session (the page refuses anyone viewing as someone). */
export function setsUpEmail(user: Viewer): boolean {
  return seesEmailSettings(user) && !user.viewAs;
}

/** Whether the API's words (a refusal, an interview's email problem) say email isn't set up: "Email isn't set up …". */
export function isEmailNotSetUp(said: string | readonly string[] | null | undefined): boolean {
  if (!said) return false;
  return (typeof said === 'string' ? [said] : said).some((m) => /isn.t set up/i.test(m));
}
