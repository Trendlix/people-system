import {
  calendarAppProblems,
  GOOGLE_BUSY_SCOPES,
  isEmail,
  MICROSOFT_APPLICATION_PERMISSIONS,
  MICROSOFT_BUSY_PERMISSIONS,
  normalEmail,
  ZOHO_CALENDAR_SCOPES,
  ZOHO_DATA_CENTRES,
  type CalendarAppView,
} from '@trendlix/shared';
import type { FormState } from '../../../../lib/types';

// Organization → Calendars (owner, 25 October 2026: "its zoho mails": the company's calendars are Zoho Calendar's, so
// it is the main source of the interviewers' busy times; Google and Microsoft stay beside it): what the page's forms
// send, and the short, exact steps for Zoho's API console and the Zoho Mail Admin Console, with the redirect URI to
// copy; and what Google's and Microsoft's apps (Organization → Meetings) need for busy times. Pure code (relative
// imports), tested in setup.test.ts; the API checks every request again (packages/shared calendars.ts).

/** What the app form's action answers: a save's message or a refusal's reasons; `saved` closes the secret box opened. */
export interface CalendarAppState extends FormState {
  saved?: number;
}

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** PUT /calendars/apps/zoho's body from the form: an empty secret box keeps the saved secret. */
export function zohoAppBody(fd: FormData): { body: { clientId: string | null; clientSecret?: string; dataCentre: string | null }; errors: string[] } {
  const body: { clientId: string | null; clientSecret?: string; dataCentre: string | null } = { clientId: text(fd, 'clientId') || null, dataCentre: text(fd, 'dataCentre') || null };
  const secret = text(fd, 'clientSecret');
  if (secret) body.clientSecret = secret;
  return { body, errors: calendarAppProblems(body) };
}

/** POST /calendars/company/zoho/test's body: a colleague's work email to check, or none (the connected account's own). */
export function testBody(fd: FormData): { body: { email: string | null } | null; errors: string[] } {
  const email = normalEmail(text(fd, 'email'));
  if (!email) return { body: { email: null }, errors: [] };
  if (!isEmail(email)) return { body: null, errors: ['Write the colleague’s work email in full, e.g. name@trendlix.com.'] };
  return { body: { email }, errors: [] };
}

/** The data centre's choices, the saved one (or none yet) chosen. */
export const dataCentreOptions = (): { value: string; label: string }[] => ZOHO_DATA_CENTRES.map((d) => ({ value: d.key, label: d.label }));

/** The company's Zoho account, in words: what it does, and what is missing. */
export function zohoStatus(app: Pick<CalendarAppView, 'ready'>, connected: boolean): string {
  if (!app.ready) return 'The Zoho app isn’t set up yet: follow the steps, then save its credentials below.';
  if (!connected) return 'The Zoho app is set up: connect the company’s Zoho account below.';
  return 'Connected: everyone’s busy times are read from Zoho Calendar by their work email. Nobody needs to connect anything.';
}

/** One step of a console's setup: its words, and the exact values to type or tick there. */
export interface SetupStep {
  text: string;
  values?: readonly string[];
}

/** The short, exact steps for Zoho; `redirectUri`: the one this website returns to; `homepage`: the website itself. */
export function zohoSteps(redirectUri: string, homepage: string): SetupStep[] {
  return [
    { text: 'On api-console.zoho.com (signed in as a Zoho admin of the company): Add Client → Server-based Applications.' },
    { text: 'Client Name: People System. Homepage URL:', values: [homepage] },
    { text: 'Authorized Redirect URIs:', values: [redirectUri] },
    { text: 'Create, then copy the Client ID and the Client Secret from its Client Secret tab, and paste them below with the data centre the company’s Zoho account is in (its address: zoho.com, zoho.eu, …).' },
    { text: 'If some people’s accounts are in another data centre: the client’s Settings tab → Multi-DC, turn it on for those data centres (the same client ID works in each).' },
    { text: 'The system asks only for these scopes (free/busy, and who signed in):', values: ZOHO_CALENDAR_SCOPES },
    { text: 'In the Zoho Mail Admin Console: Other App Settings → Calendar → Free/Busy Sharing: “Allow users to share their free/busy status only with organization users”, so one connection reads everyone’s busy times by their work email.' },
    { text: 'Save, then Connect the company’s Zoho account: signed in as an account of the company’s Zoho organization, e.g. hr@trendlix.com.' },
  ];
}

/** What Google's and Microsoft's apps (Organization → Meetings) need for busy times, as a secondary source. */
export function otherSteps(googleUri: string, microsoftUri: string): SetupStep[] {
  return [
    { text: 'Google: anyone’s own Google calendar connects through the Google app on Organization → Meetings. Add this to its Authorized redirect URIs:', values: [googleUri] },
    { text: 'And this scope to its OAuth consent screen (free/busy only):', values: GOOGLE_BUSY_SCOPES },
    { text: 'Microsoft: anyone’s own Outlook calendar connects through the Microsoft app on Organization → Meetings. Add this Web redirect URI to the app registration:', values: [microsoftUri] },
    { text: 'And these Delegated permissions (Calendars.ReadBasic reads free/busy only):', values: MICROSOFT_BUSY_PERMISSIONS },
    {
      text: 'The company’s Microsoft 365 busy times need nothing more: once the company’s Teams host is set on Organization → Meetings, its Application permission reads everyone’s busy times by their work email:',
      values: MICROSOFT_APPLICATION_PERMISSIONS,
    },
  ];
}
