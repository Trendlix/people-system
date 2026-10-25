import { LINKEDIN_CALLBACK_PATH, LINKEDIN_LIMITS, linkedinRedirectUri, type LinkedInSettingsInput, type LinkedInSettingsView } from '@trendlix/shared';

// Recruitment Settings' "LinkedIn Sign-in" (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; asked, "Sign in with LinkedIn" with "Fill the form from the CV"; packages/shared
// linkedin-signin.ts): a Super Admin's. Where it stands in words, the redirect URL to give LinkedIn (the careers pages'
// public address, lib/careers-base.ts, and /linkedin/callback), and the form read into what the API takes: the client secret only when one was pasted (an empty box keeps
// the one set), never kept to show again. Pure code, tested in linkedin-settings.test.ts; the API checks everything again.

/**
 * The redirect URL LinkedIn is given: the careers pages' address (lib/careers-base.ts: CAREERS_BASE_URL, else this site's
 * own and /careers) and /linkedin/callback; the path alone when neither can be read (never a written-in address).
 */
export const redirectUrlFor = (careersBase: string | null | undefined): string => (careersBase ? linkedinRedirectUri(careersBase) : LINKEDIN_CALLBACK_PATH);

/** Where the sign-in stands, in words, with its tone. */
export function linkedinStatus(v: LinkedInSettingsView): { tone: 'ok' | 'warn' | 'neutral'; text: string } {
  if (v.ready) return { tone: 'ok', text: 'On: the careers forms show “Fill in with LinkedIn”.' };
  if (v.secretUnreadable) return { tone: 'warn', text: 'The saved client secret can’t be read any more (the server’s key changed): paste it again. The button is off meanwhile.' };
  if (v.enabled) return { tone: 'warn', text: 'Switched on, but the client ID or the secret is missing: the careers forms don’t show the button yet.' };
  if (!v.clientId && !v.secretSet) return { tone: 'neutral', text: 'Not set up yet: the careers forms don’t show “Fill in with LinkedIn”.' };
  return { tone: 'neutral', text: 'Off: the careers forms don’t show “Fill in with LinkedIn”.' };
}

const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** The form as the API takes it (PUT /recruitment/settings/linkedin): the switch, the ID (empty: none), a new secret only when pasted. */
export function linkedinSettingsOf(fd: FormData): LinkedInSettingsInput {
  const secret = text(fd, 'clientSecret');
  return {
    enabled: fd.get('enabled') !== null,
    clientId: text(fd, 'clientId') || null,
    ...(secret && { clientSecret: secret.slice(0, LINKEDIN_LIMITS.clientSecret + 1) }),
  };
}

/** What was typed, kept to show again after a refusal: never the secret. */
export function typedLinkedInValues(fd: FormData): Record<string, string> {
  return { clientId: text(fd, 'clientId'), ...(fd.get('enabled') !== null && { enabled: 'on' }) };
}
