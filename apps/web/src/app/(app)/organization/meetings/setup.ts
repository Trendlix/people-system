import {
  GOOGLE_SCOPES,
  isEmail,
  MEETING_PROVIDER_LABELS,
  meetingAppProblems,
  meetingChoiceKey,
  MEETINGS_GOOGLE_PROJECT,
  MICROSOFT_APPLICATION_PERMISSIONS,
  MICROSOFT_DELEGATED_PERMISSIONS,
  parseMeetingChoice,
  ZOOM_COMPANY_SCOPES,
  ZOOM_PERSONAL_SCOPES,
  type MeetingAppInput,
  type MeetingChoiceKey,
  type MeetingProvider,
  type MeetingSettingsView,
} from '@trendlix/shared';
import type { FormState } from '../../../../lib/types';

// Organization → Meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft Teams, Zoom", and
// "make it both"): what the page's forms send, the default's choices, and the short, exact steps for each provider's
// console with the redirect URI to copy. Pure code (relative imports), tested in setup.test.ts; the API checks every
// request again (packages/shared meetings.ts).

/** What an app form's action answers: a save's message or a refusal's reasons; `saved` closes the secret boxes opened. */
export interface MeetingAppState extends FormState {
  saved?: number;
}

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** A secret as pasted: never trimmed inside, but a box left empty (or only spaces) keeps the saved one. */
const secret = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : '';
};

/** PUT /meetings/apps/:provider's body from the form, with what is wrong with it (the shared checks the API makes). */
export function meetingAppBody(provider: MeetingProvider, fd: FormData): { body: MeetingAppInput; errors: string[] } {
  const body: MeetingAppInput = { clientId: text(fd, 'clientId') || null };
  const clientSecret = secret(fd, 'clientSecret');
  if (clientSecret) body.clientSecret = clientSecret;
  if (provider === 'microsoft') body.tenantId = text(fd, 'tenantId') || null;
  if (provider === 'zoom') {
    body.accountId = text(fd, 'accountId') || null;
    body.userClientId = text(fd, 'userClientId') || null;
    const userSecret = secret(fd, 'userClientSecret');
    if (userSecret) body.userClientSecret = userSecret;
  }
  return { body, errors: meetingAppProblems(provider, body) };
}

/** POST /meetings/company/:provider/host's body: the host mailbox or user, in full. */
export function hostBody(fd: FormData): { body: { hostEmail: string } | null; errors: string[] } {
  const hostEmail = text(fd, 'hostEmail').toLowerCase();
  if (!isEmail(hostEmail)) return { body: null, errors: ['Write the host’s address in full, e.g. hr@trendlix.com.'] };
  return { body: { hostEmail }, errors: [] };
}

/** What the host is called: Microsoft's a mailbox, Zoom's a user of the company's Zoom account. */
export const hostLabel = (provider: Exclude<MeetingProvider, 'google'>): string => (provider === 'microsoft' ? 'Host mailbox' : 'Host user');

/** "None": each scheduler's own account, else a pasted link. */
export const NO_DEFAULT = '';

/** The default's choices: none, or a company connection that works. */
export function defaultOptions(view: Pick<MeetingSettingsView, 'company' | 'apps'>): { value: MeetingChoiceKey | typeof NO_DEFAULT; label: string }[] {
  const ready = new Set(view.apps.filter((a) => a.companyReady).map((a) => a.provider));
  const company = view.company.filter((c) => c.status === 'connected' && ready.has(c.provider));
  return [
    { value: NO_DEFAULT, label: 'None: each scheduler’s own, else a pasted link' },
    ...company.map((c) => ({ value: meetingChoiceKey('company', c.provider), label: `Company ${MEETING_PROVIDER_LABELS[c.provider]} (${c.accountEmail})` })),
  ];
}

/** PUT /meetings/default's body: a company choice, or none. */
export function defaultBody(fd: FormData): { body: { choice: MeetingChoiceKey | null } | null; errors: string[] } {
  const v = text(fd, 'choice');
  if (!v) return { body: { choice: null }, errors: [] };
  const parsed = parseMeetingChoice(v);
  if (!parsed || parsed.owner !== 'company') return { body: null, errors: ['Choose one of the company’s connections, or none.'] };
  return { body: { choice: meetingChoiceKey('company', parsed.provider) }, errors: [] };
}

/** One step of a console's setup: its words, and the exact values to type or tick there. */
export interface SetupStep {
  text: string;
  values?: readonly string[];
}

/** The short, exact steps of each provider's console; `redirectUri`: the one this website returns to. */
export function setupSteps(provider: MeetingProvider, redirectUri: string): SetupStep[] {
  if (provider === 'google') {
    return [
      { text: `In Google Cloud console, open the project ${MEETINGS_GOOGLE_PROJECT}. APIs & Services → Library: turn on the Google Calendar API.` },
      {
        text: 'OAuth consent screen: user type Internal (Google Workspace). The calendar scope is a sensitive one: an Internal app needs no Google verification, while an External app left in Testing loses its connections after 7 days. Add these scopes:',
        values: GOOGLE_SCOPES,
      },
      { text: 'Credentials → Create credentials → OAuth client ID → Web application. Under Authorized redirect URIs, add:', values: [redirectUri] },
      { text: 'Paste the client ID and the client secret below and save. Then Connect a Google account, signed in as the account that hosts the company’s interviews, e.g. hr@trendlix.com.' },
      { text: 'Each HR person connects their own on Your Meetings, through the same client.' },
    ];
  }
  if (provider === 'microsoft') {
    return [
      { text: 'In the Microsoft Entra admin center: App registrations → New registration. Accounts in this organizational directory only. Redirect URI: platform Web,', values: [redirectUri] },
      { text: 'Certificates & secrets → New client secret: paste its Value below (not its Secret ID). It expires: set a reminder to replace it.' },
      { text: 'API permissions → Add a permission → Microsoft Graph → Application permissions, for the company’s host mailbox:', values: MICROSOFT_APPLICATION_PERMISSIONS },
      { text: 'And Delegated permissions, for each HR person’s own:', values: MICROSOFT_DELEGATED_PERMISSIONS },
      { text: 'Grant admin consent for the company. Paste the Directory (tenant) ID and the Application (client) ID below.' },
      {
        text: 'Recommended: limit the application permission to the host mailbox, in Exchange Online PowerShell (or with RBAC for Applications):',
        values: ['New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId <a mail-enabled security group holding the host mailbox> -AccessRight RestrictAccess -Description "People System meetings"'],
      },
      { text: 'Then name the host mailbox below. It needs a Teams licence. No Teams application access policy is needed: each meeting is a calendar event with a Teams link.' },
    ];
  }
  return [
    { text: 'On marketplace.zoom.us: Develop → Build App → Server-to-Server OAuth app, for the company’s meetings. Under Scopes, add:', values: ZOOM_COMPANY_SCOPES },
    { text: 'Activate it, and paste its Account ID, Client ID and Client secret below. Then name the host: a user of the company’s Zoom account, e.g. hr@trendlix.com.' },
    { text: 'For each HR person’s own: Build App → General App, user-managed. Its OAuth Redirect URL, and its OAuth Allow List:', values: [redirectUri] },
    { text: 'Under Scopes, add:', values: ZOOM_PERSONAL_SCOPES },
    { text: 'Paste the General app’s Client ID and Client secret below. Left unpublished, it is open only to users of the company’s Zoom account.' },
  ];
}

/** What to know about who gets into a meeting made with each provider. */
export function meetingNote(provider: MeetingProvider): string {
  if (provider === 'google') {
    return 'Google lets only the organizer admit people who ask to join: a candidate from outside the company asks. With the company’s account hosting, join from that account or set the meeting’s access to Open; an HR person’s own meetings are hosted by them.';
  }
  if (provider === 'microsoft') return 'A candidate waits in the Teams lobby until an interviewer admits them.';
  return 'Meetings are made with join before host on and the waiting room off, the passcode in the link: anyone with the link joins.';
}
