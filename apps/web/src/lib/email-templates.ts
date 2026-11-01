import type { EmailTemplateText, EmailTemplateView, Role } from '@trendlix/shared';
import { hasRole } from './roles';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): the words of each email the system
// sends, which HR writes with {{fields}}. HR, the CEO and a Super Admin see the page; HR and a Super Admin change it, as
// the API's roles. Pure code, so the page, its client parts and the tests take it as it is.

/** The Email Templates page. */
export const EMAIL_TEMPLATES_PATH = '/organization/email-templates';

type Viewer = { roles: readonly Role[] };

/** Who sees the page: HR, the CEO and a Super Admin. */
export const seesEmailTemplates = (user: Viewer): boolean => hasRole(user, 'hr', 'ceo', 'super_admin');

/** Who changes the words, resets them and sends a test: HR and a Super Admin. */
export const editsEmailTemplates = (user: Viewer): boolean => hasRole(user, 'hr', 'super_admin');

/** The words an email goes with now: HR's when they wrote them, else the standard ones. */
export const wordsOf = (t: Pick<EmailTemplateView, 'start' | 'custom'>): EmailTemplateText => (t.custom ? { subject: t.custom.subject, body: t.custom.body } : t.start);

/** Whether the words on screen differ from the ones it goes with now (the Save button's cue). */
export const changed = (t: Pick<EmailTemplateView, 'start' | 'custom'>, on: EmailTemplateText): boolean => {
  const now = wordsOf(t);
  return on.subject.trim() !== now.subject.trim() || on.body.replace(/\r\n?/g, '\n').trim() !== now.body.trim();
};

/**
 * A field put into a text where the cursor is (or over what is selected): the text, and where the cursor goes after it.
 */
export function insertField(text: string, field: string, start: number | null, end: number | null): { text: string; cursor: number } {
  const token = `{{${field}}}`;
  const from = start ?? text.length;
  const to = end ?? from;
  return { text: text.slice(0, from) + token + text.slice(to), cursor: from + token.length };
}

/** A filled text's paragraphs (split at empty lines), each as its lines, for the preview. */
export const paragraphsOf = (text: string): string[][] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split('\n'));
