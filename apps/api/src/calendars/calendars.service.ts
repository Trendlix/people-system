import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CALENDAR_CHECK_MS,
  CALENDAR_COMPANY_NAMES,
  CALENDAR_PAGES,
  CALENDAR_PROVIDER_LABELS,
  CALENDAR_PROVIDERS,
  calendarAppProblems,
  calendarRedirectUri,
  CALENDARS_EMPLOYEES_ONLY,
  CALENDARS_OWN_ACCOUNT,
  CALENDARS_SUPER_ADMIN_ONLY,
  DEVELOPER_NO_FILES,
  GOOGLE_FREEBUSY_SCOPE,
  isCalendarProvider,
  isEmail,
  isZohoDataCentre,
  MEETING_CONNECT_MINUTES,
  normalEmail,
  zohoAppReady,
  zohoDataCentre,
  zohoDataCentreOfAccounts,
  type CalendarAppView,
  type CalendarCheck,
  type CalendarConnectionView,
  type CalendarConnectResult,
  type CalendarConnectStart,
  type CalendarProvider,
  type CalendarSettingsView,
  type CalendarTestView,
  type MeetingConnectProblem,
  type MeetingOwner,
  type MyCalendarsView,
} from '@trendlix/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { CalendarApp, CalendarConnection, MeetingConnection } from '../generated/prisma/client.js';
import { emailOfIdToken, googleRevokeRequest, grantsScope, MeetingProviderError, pkcePair, type AppCredentials, type HttpAnswer, type HttpRequest } from '../meetings/meeting-providers.js';
import { hostsByApp, MeetingTokensService } from '../meetings/meeting-tokens.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CALENDAR_SIGN_IN_TIMEOUT_MS, CalendarHttp } from './calendar-http.js';
import {
  calendarAuthorizeUrl,
  calendarCodeRequest,
  calendarGrantOf,
  CalendarProviderError,
  calendarRefreshRequest,
  googleBusyOf,
  googleFreeBusyRequest,
  graphBusyOf,
  graphScheduleRequest,
  zohoBusyOf,
  zohoEmailOf,
  zohoFreeBusyRequest,
  zohoHosts,
  zohoRevokeRequest,
  zohoUserInfoRequest,
  type BusyTime,
  type CalendarGrant,
} from './calendar-providers.js';
import { calendarKeyIdOf, calendarKeyOf, openCalendarSecret, sameCalendarKey, sealCalendarSecret, type CalendarSecretPurpose } from './calendar-secret.js';
import type { CalendarAppDto } from './calendars.dto.js';

// Calendars read for interviewers' busy times (owner, 25 October 2026: "is it better for each interviewer to add his
// available interviews timeslots?"; asked, "Hours + calendar": "when they connect Google or Outlook, calendar busy
// times"; then "its zoho mails": the company's mail and calendars are Zoho's, so Zoho Calendar is the main source;
// packages/shared calendars.ts):
// - Organization → Calendars, a Super Admin's in their own session (never a developer's): the Zoho app (a Server-based
//   Application at api-console.zoho.com: its client ID, its secret sealed and never returned, the data centre), the
//   company's Zoho connection (a Super Admin signs in once; colleagues' free/busy is then read by their work email, as
//   far as the organization's free/busy sharing allows), a test, and disconnecting.
// - Each person's own (their Interview Hours page, anyone with an employee profile, in their own session): connecting
//   their own Zoho, Google or Microsoft calendar, for busy times only, the fallback when the company's can't read
//   theirs; Google's and Microsoft's sign in with the meetings' apps (Organization → Meetings). Hosting meetings stays
//   with Your Meetings, whose own Google (once its free/busy scope is allowed) and Microsoft connections share their
//   busy times too.
// - busyTimes, for "Find a time" and the warnings: every source that reads a person's calendar, asked together, live,
//   5 seconds at most; what didn't answer is "Couldn't check …" and the times are offered all the same, marked.
// Only busy and free is ever read: never an event's title, place or attendees. Every change is audited: the app (its
// values only as "changed"), connections made, refused, removed or needing connecting again, the tests; never a token or
// a secret. No notification: a connection needing connecting again says so on its page.

export const CALENDAR_SETTINGS_ENTITY = 'calendar_settings';
export const CALENDAR_CONNECTION_ENTITY = 'calendar_connection';

/** Someone whose busy times are read: their employee profile, their account (if any), and their work email. */
export interface BusyPerson {
  employeeId: string;
  userId: string | null;
  workEmail: string | null;
}

/** Someone's busy times as read: whether (checked, failed, none to read), from which calendars, and the blocks. */
export interface PersonBusy {
  calendar: CalendarCheck;
  sources: string[];
  /** Their own Google meetings connection doesn't share busy times yet: "Reconnect to share your busy times". */
  reconnect: boolean;
  blocks: { start: number; end: number; tentative: boolean }[];
}

/** The sign-in's state, sealed: provider, owner, user, redirect URI, verifier, expiry (ms). */
interface SignInState {
  p: CalendarProvider;
  o: MeetingOwner;
  u: string;
  r: string;
  v: string;
  e: number;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;
/** A token is renewed this long before it expires (Zoho allows 10 new ones in 10 minutes: they are kept until then). */
const MARGIN_MS = 60_000;
const DAY_MS = 86_400_000;

const ownerOf = (c: Pick<CalendarConnection, 'userId'>): MeetingOwner => (c.userId ? 'personal' : 'company');

/** One source of someone's busy times: its label, and the read. */
interface Source {
  label: string;
  read: () => Promise<BusyTime[]>;
}

@Injectable()
export class CalendarsService {
  private readonly logger = new Logger('Calendars');
  private readonly key: Buffer;
  private readonly kept = new Map<string, { token: string; until: number }>();
  private readonly running = new Map<string, Promise<string>>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly http: CalendarHttp,
    private readonly meetingTokens: MeetingTokensService,
  ) {
    this.key = calendarKeyOf(config.getOrThrow<string>('JWT_SECRET'));
  }

  // ---------- sealing ----------

  private seal(plain: string, purpose: CalendarSecretPurpose): { enc: string; keyId: string } {
    return { enc: sealCalendarSecret(plain, this.key, purpose), keyId: calendarKeyIdOf(this.key) };
  }

  private open(enc: string | null | undefined, keyId: string | null | undefined, purpose: CalendarSecretPurpose): string | null {
    if (!enc || !sameCalendarKey(keyId, this.key)) return null;
    return openCalendarSecret(enc, this.key, purpose);
  }

  // ---------- who ----------

  /** A Super Admin in their own session; anyone else refused (a developer too, also refused before by the interceptor). */
  private assertSuperAdmin(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(CALENDARS_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(CALENDARS_OWN_ACCOUNT);
  }

  /** Someone who interviews (an account with an employee profile), in their own session; never a developer. */
  private assertPerson(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (user.viewAs) throw new ForbiddenException(CALENDARS_OWN_ACCOUNT);
    if (!user.employeeId) throw new ForbiddenException(CALENDARS_EMPLOYEES_ONLY);
  }

  private provider(value: string): CalendarProvider {
    if (!isCalendarProvider(value)) throw new NotFoundException('There is no such calendar.');
    return value;
  }

  // ---------- the apps ----------

  private zohoApp(): Promise<CalendarApp | null> {
    return this.prisma.calendarApp.findUnique({ where: { provider: 'zoho' } });
  }

  /** The Zoho app's credentials, its secret opened: only to call Zoho. Null when not set up or not readable. */
  private zohoCredentials(app: CalendarApp | null): AppCredentials | null {
    const secret = this.open(app?.clientSecretEnc, app?.clientSecretKeyId, 'client_secret');
    return app?.clientId && secret && isZohoDataCentre(app.dataCentre) ? { clientId: app.clientId, clientSecret: secret } : null;
  }

  /** A provider's app for one's calendar: Zoho's own; Google's and Microsoft's the meetings' (as for each HR person's own). */
  private async credentials(provider: CalendarProvider): Promise<AppCredentials | null> {
    if (provider === 'zoho') return this.zohoCredentials(await this.zohoApp());
    return this.meetingTokens.credentials(await this.meetingTokens.app(provider), 'personal');
  }

  private noApp(provider: CalendarProvider): string {
    return provider === 'zoho'
      ? 'The company’s Zoho Calendar app isn’t set up: a Super Admin sets it up on Organization → Calendars.'
      : `The company’s ${CALENDAR_COMPANY_NAMES[provider]} app isn’t set up: a Super Admin sets it up on Organization → Meetings.`;
  }

  // ---------- the views ----------

  private async names(ids: (string | null)[]): Promise<Map<string, { id: string; name: string }>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, email: true } });
    return userNames(this.prisma, users);
  }

  private appView(row: CalendarApp | null, names: Map<string, { id: string; name: string }>): CalendarAppView {
    const secretSet = !!row?.clientSecretEnc;
    const readable = secretSet && this.open(row?.clientSecretEnc, row?.clientSecretKeyId, 'client_secret') !== null;
    const dataCentre = isZohoDataCentre(row?.dataCentre) ? row.dataCentre : null;
    const view = { clientId: row?.clientId ?? null, clientSecretSet: readable, dataCentre };
    return {
      provider: 'zoho',
      ...view,
      clientSecretUnreadable: secretSet && !readable,
      ready: zohoAppReady(view),
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedById ? (names.get(row.updatedById) ?? null) : null,
    };
  }

  private connectionView(c: CalendarConnection, names: Map<string, { id: string; name: string }>): CalendarConnectionView {
    return {
      id: c.id,
      provider: c.provider as CalendarProvider,
      owner: ownerOf(c),
      accountEmail: c.accountEmail,
      status: c.status as CalendarConnectionView['status'],
      problem: c.problem,
      connectedAt: c.connectedAt.toISOString(),
      connectedBy: c.connectedById ? (names.get(c.connectedById) ?? null) : null,
      lastTest: c.lastTestAt ? { at: c.lastTestAt.toISOString(), ok: !!c.lastTestOk, message: c.lastTestMessage ?? '' } : null,
    };
  }

  /** GET /calendars/settings: the Zoho app (never its secret) and the company's Zoho connection. */
  async settings(user: SessionUser): Promise<CalendarSettingsView> {
    this.assertSuperAdmin(user);
    return this.settingsView();
  }

  private async settingsView(): Promise<CalendarSettingsView> {
    const [app, company] = await Promise.all([this.zohoApp(), this.prisma.calendarConnection.findFirst({ where: { provider: 'zoho', userId: null } })]);
    const names = await this.names([app?.updatedById ?? null, company?.connectedById ?? null]);
    return { zoho: this.appView(app, names), company: company ? this.connectionView(company, names) : null };
  }

  /** GET /calendars/mine: one's own connections, and what reads one's busy times without one. */
  async mine(user: SessionUser): Promise<MyCalendarsView> {
    this.assertPerson(user);
    return this.mineView(user);
  }

  private async mineView(user: SessionUser): Promise<MyCalendarsView> {
    const [mine, zoho, companyZoho, companyMicrosoft, meetings, employee] = await Promise.all([
      this.prisma.calendarConnection.findMany({ where: { userId: user.id } }),
      this.zohoApp(),
      this.prisma.calendarConnection.findFirst({ where: { provider: 'zoho', userId: null, status: 'connected' }, select: { id: true } }),
      this.prisma.meetingConnection.findFirst({ where: { provider: 'microsoft', userId: null, status: 'connected' } }),
      this.prisma.meetingConnection.findMany({ where: { userId: user.id, provider: { in: ['google', 'microsoft'] } }, select: { provider: true, busyTimes: true } }),
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { workEmail: true } }) : null,
    ]);
    const names = await this.names(mine.map((c) => c.connectedById));
    const zohoReady = !!this.zohoCredentials(zoho);
    const meetingApps = new Map(await Promise.all((['google', 'microsoft'] as const).map(async (p) => [p, !!this.meetingTokens.credentials(await this.meetingTokens.app(p), 'personal')] as const)));
    const workEmail = employee?.workEmail ? normalEmail(employee.workEmail) : null;
    const microsoftApp = companyMicrosoft && hostsByApp(companyMicrosoft) ? !!this.meetingTokens.credentials(await this.meetingTokens.app('microsoft'), 'company') : false;
    return {
      providers: CALENDAR_PROVIDERS.map((provider) => {
        const c = mine.find((x) => x.provider === provider);
        return { provider, available: provider === 'zoho' ? zohoReady : !!meetingApps.get(provider), connection: c ? this.connectionView(c, names) : null };
      }),
      companyZoho: !!companyZoho && zohoReady && !!workEmail,
      companyMicrosoft: microsoftApp && !!workEmail,
      workEmail,
      meetings: meetings.map((m) => ({ provider: m.provider as 'google' | 'microsoft', busyTimes: m.busyTimes })),
    };
  }

  /** PUT /calendars/apps/zoho: the Zoho app; an empty secret keeps the saved one. Audited, the values as "changed". */
  async saveApp(dto: CalendarAppDto, user: SessionUser): Promise<CalendarSettingsView> {
    this.assertSuperAdmin(user);
    const tidy = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const input = { clientId: tidy(dto.clientId), clientSecret: dto.clientSecret ? dto.clientSecret : null, dataCentre: tidy(dto.dataCentre) };
    const problems = calendarAppProblems(input);
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.zohoApp();
    const next = { clientId: input.clientId, dataCentre: input.dataCentre };
    // every value only as "changed" (the brief: "audited"; the meetings' precedent): never a value
    const diff: Record<string, string> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) if ((before?.[k] ?? null) !== next[k]) diff[k] = 'changed';
    const sealed: Record<string, string> = {};
    if (input.clientSecret && input.clientSecret !== this.open(before?.clientSecretEnc, before?.clientSecretKeyId, 'client_secret')) {
      const s = this.seal(input.clientSecret, 'client_secret');
      Object.assign(sealed, { clientSecretEnc: s.enc, clientSecretKeyId: s.keyId });
      diff.clientSecret = 'changed';
    }
    if (!Object.keys(diff).length) return this.settingsView();
    const data = { ...next, ...sealed, updatedById: user.id, updatedAt: new Date() };
    await this.prisma.calendarApp.upsert({ where: { provider: 'zoho' }, create: { provider: 'zoho', ...data }, update: data });
    // the tokens made with the app before: made again with the new one
    for (const k of this.kept.keys()) this.kept.delete(k);
    await this.audit.record({ userId: user.id, action: 'update', entityType: CALENDAR_SETTINGS_ENTITY, entityId: null, diff: { provider: 'zoho', ...diff } });
    return this.settingsView();
  }

  // ---------- connections ----------

  /** POST /calendars/company/zoho/disconnect: the company's Zoho connection removed (its sign-in revoked too). */
  async disconnectCompany(user: SessionUser): Promise<CalendarSettingsView> {
    this.assertSuperAdmin(user);
    const c = await this.prisma.calendarConnection.findFirst({ where: { provider: 'zoho', userId: null } });
    if (c) await this.disconnect(c, user);
    return this.settingsView();
  }

  /** POST /calendars/mine/:provider/disconnect. */
  async disconnectMine(providerParam: string, user: SessionUser): Promise<MyCalendarsView> {
    this.assertPerson(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.calendarConnection.findFirst({ where: { provider, userId: user.id } });
    if (c) await this.disconnect(c, user);
    return this.mineView(user);
  }

  /** A connection removed: its sign-in revoked at the provider (best effort), its tokens forgotten. */
  private async disconnect(c: CalendarConnection, user: SessionUser): Promise<void> {
    const provider = c.provider as CalendarProvider;
    const refreshToken = this.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token');
    if (refreshToken) {
      if (provider === 'google') await this.http.send(googleRevokeRequest(refreshToken));
      if (provider === 'zoho') {
        const app = this.zohoCredentials(await this.zohoApp());
        if (app) await this.http.send(zohoRevokeRequest(app, c.accountsServer, refreshToken));
      }
    }
    await this.prisma.calendarConnection.delete({ where: { id: c.id } });
    this.kept.delete(c.id);
    await this.audit.record({ userId: user.id, action: 'disconnect', entityType: CALENDAR_CONNECTION_ENTITY, entityId: c.id, diff: { provider, owner: ownerOf(c), accountEmail: c.accountEmail } });
  }

  /**
   * POST /calendars/company/zoho/test: the company's Zoho connection reads the free/busy of its own account (and of
   * `email`, a colleague, when given) for the next 7 days. Said in counts only, never what the busy times are; kept on
   * the connection as its last test, and audited.
   */
  async testCompany(email: string | null | undefined, user: SessionUser): Promise<CalendarTestView> {
    this.assertSuperAdmin(user);
    const c = await this.prisma.calendarConnection.findFirst({ where: { provider: 'zoho', userId: null } });
    if (!c) throw new BadRequestException(['The company’s Zoho Calendar isn’t connected yet: connect it first.']);
    const colleague = email ? normalEmail(email) : null;
    if (colleague !== null && !isEmail(colleague)) throw new BadRequestException(['Write the colleague’s work email in full, e.g. sara@trendlix.com.']);
    const emails = [...new Set([c.accountEmail, ...(colleague ? [colleague] : [])])];
    return this.test(c, emails, user);
  }

  /** POST /calendars/mine/:provider/test: one's own calendar's busy times for the next 7 days, in counts. */
  async testMine(providerParam: string, user: SessionUser): Promise<CalendarTestView> {
    this.assertPerson(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.calendarConnection.findFirst({ where: { provider, userId: user.id } });
    if (!c) throw new BadRequestException([`Your ${CALENDAR_PROVIDER_LABELS[provider]} isn’t connected: connect it first.`]);
    return this.test(c, [c.accountEmail], user);
  }

  private async test(c: CalendarConnection, emails: readonly string[], user: SessionUser): Promise<CalendarTestView> {
    const provider = c.provider as CalendarProvider;
    const who = CALENDAR_COMPANY_NAMES[provider];
    const from = new Date();
    const to = new Date(from.getTime() + 7 * DAY_MS);
    const parts: string[] = [];
    let ok = true;
    for (const email of emails) {
      try {
        const busy = await this.readOwn(c, email, from, to);
        parts.push(`${busy.length} busy ${busy.length === 1 ? 'time' : 'times'} in the next 7 days for ${email}`);
      } catch (err) {
        if (!(err instanceof CalendarProviderError || err instanceof MeetingProviderError)) throw err;
        ok = false;
        parts.push(`${email}: ${err.message}`);
      }
    }
    const message = ok ? `${who} answered: ${parts.join('; ')}.` : `${who} didn’t answer for everyone: ${parts.join('; ')}`;
    const at = new Date();
    await this.prisma.calendarConnection.updateMany({ where: { id: c.id }, data: { lastTestAt: at, lastTestOk: ok, lastTestMessage: message } });
    await this.audit.record({ userId: user.id, action: 'test_calendar', entityType: CALENDAR_CONNECTION_ENTITY, entityId: c.id, diff: { provider, owner: ownerOf(c), ok, read: emails.length } });
    return { at: at.toISOString(), ok, message };
  }

  // ---------- signing in ----------

  /**
   * POST /calendars/oauth/start: the provider's sign-in page for the company's Zoho account (a Super Admin) or one's own
   * calendar (anyone with an employee profile), returning to the website's /calendars/oauth/<provider>.
   */
  async start(dto: { provider: string; owner: string; origin: string }, user: SessionUser): Promise<CalendarConnectStart> {
    const provider = this.provider(dto.provider);
    const owner: MeetingOwner = dto.owner === 'company' ? 'company' : 'personal';
    if (owner === 'company') this.assertSuperAdmin(user);
    else this.assertPerson(user);
    if (owner === 'company' && provider !== 'zoho') throw new BadRequestException(['The company’s calendar is Zoho’s: Google and Microsoft calendars are each person’s own.']);
    const origin = (dto.origin ?? '').trim().replace(/\/+$/, '');
    if (!ORIGIN.test(origin) || (origin.startsWith('http:') && !LOCAL.test(origin))) throw new BadRequestException(['The website’s address could not be read. Reload the page and try again.']);
    const creds = await this.credentials(provider);
    if (!creds) throw new BadRequestException([this.noApp(provider)]);
    const tenantId = provider === 'microsoft' ? ((await this.meetingTokens.app('microsoft'))?.tenantId ?? null) : null;
    const accounts = provider === 'zoho' ? zohoDataCentre((await this.zohoApp())?.dataCentre).accounts : null;
    const redirectUri = calendarRedirectUri(origin, provider);
    const { verifier, challenge } = pkcePair();
    const state: SignInState & { n: string } = { p: provider, o: owner, u: user.id, r: redirectUri, v: verifier, e: Date.now() + MEETING_CONNECT_MINUTES * 60_000, n: randomBytes(8).toString('base64url') };
    const sealed = sealCalendarSecret(JSON.stringify(state), this.key, 'oauth_state');
    return { url: calendarAuthorizeUrl(provider, { clientId: creds.clientId, tenantId }, { redirectUri, state: sealed, challenge, accounts }) };
  }

  private openState(sealed: string | null | undefined): SignInState | null {
    const plain = openCalendarSecret(sealed, this.key, 'oauth_state');
    if (!plain) return null;
    try {
      const raw = JSON.parse(plain) as Record<string, unknown>;
      return isCalendarProvider(raw.p) && (raw.o === 'company' || raw.o === 'personal') && typeof raw.u === 'string' && typeof raw.r === 'string' && typeof raw.v === 'string' && typeof raw.e === 'number'
        ? (raw as unknown as SignInState)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * POST /calendars/oauth/finish: the provider's return (the website passes its code, state or error on, and Zoho's
   * accounts server): checked, the code traded for tokens at the account's own data centre, the account read, the
   * connection saved (its refresh token sealed). Always answered with where to return the person and how it went.
   */
  async finish(dto: { provider: string; code?: string | null; state?: string | null; error?: string | null; accountsServer?: string | null }, user: SessionUser): Promise<CalendarConnectResult> {
    const provider = this.provider(dto.provider);
    const state = this.openState(dto.state);
    const owner: MeetingOwner = state?.o ?? 'personal';
    const result = (problem: MeetingConnectProblem | null, said: string | null = null): CalendarConnectResult => ({ provider, back: CALENDAR_PAGES[owner], ok: !problem, problem, said });
    const failed = async (problem: MeetingConnectProblem, said: string | null = null) => {
      await this.audit.record({ userId: user.id, action: 'connect_failed', entityType: CALENDAR_CONNECTION_ENTITY, entityId: null, diff: { provider, owner, problem, ...(said && { said }) } });
      return result(problem, said);
    };
    if (!state || state.p !== provider || state.e < Date.now()) return result('expired');
    if (state.u !== user.id) return result('other_user');
    if (user.developer || user.viewAs || (owner === 'company' ? !isSuperAdmin(user) || provider !== 'zoho' : !user.employeeId)) return result('not_allowed');
    const error = typeof dto.error === 'string' && dto.error ? dto.error.slice(0, 60) : null;
    if (error) return failed(error === 'access_denied' ? 'denied' : 'refused', /^[a-z0-9_.-]+$/i.test(error) ? error : null);
    if (!dto.code) return failed('refused', 'no_code');
    const creds = await this.credentials(provider);
    if (!creds) return failed('no_app');
    // Zoho: the account's own data centre, as the return named it (one of Zoho's, else refused); the app's without one
    let accounts: string | null = null;
    if (provider === 'zoho') {
      const named = (dto.accountsServer ?? '').trim();
      if (named && !zohoDataCentreOfAccounts(named)) return failed('refused', 'unknown_data_centre');
      accounts = named ? zohoHosts(named).accounts : zohoDataCentre((await this.zohoApp())?.dataCentre).accounts;
    }
    const tenantId = provider === 'microsoft' ? ((await this.meetingTokens.app('microsoft'))?.tenantId ?? null) : null;

    let grant: CalendarGrant;
    try {
      grant = calendarGrantOf(provider, await this.http.send(calendarCodeRequest(provider, { ...creds, tenantId }, { code: dto.code, redirectUri: state.r, verifier: state.v, accounts }), CALENDAR_SIGN_IN_TIMEOUT_MS), 'connect');
    } catch (err) {
      if (!(err instanceof CalendarProviderError)) throw err;
      return failed(err.kind === 'unreachable' || err.kind === 'busy' ? 'unreachable' : 'refused', err.code);
    }
    if (!grant.refreshToken) return failed('refused', 'no_refresh_token');
    if (provider === 'google' && !grantsScope(grant.scope, GOOGLE_FREEBUSY_SCOPE)) return failed('denied', 'freebusy_not_allowed');
    let email = emailOfIdToken(grant.idToken);
    if (!email && provider === 'zoho') email = zohoEmailOf(await this.http.send(zohoUserInfoRequest(accounts, grant.accessToken), CALENDAR_SIGN_IN_TIMEOUT_MS));
    if (!email) return failed('no_account');

    const sealed = this.seal(grant.refreshToken, 'refresh_token');
    const userId = owner === 'company' ? null : user.id;
    const before = await this.prisma.calendarConnection.findFirst({ where: { provider, userId } });
    const data = { accountEmail: email, refreshTokenEnc: sealed.enc, tokenKeyId: sealed.keyId, accountsServer: accounts, status: 'connected', problem: null, connectedById: user.id, connectedAt: new Date() };
    const saved = before ? await this.prisma.calendarConnection.update({ where: { id: before.id }, data }) : await this.prisma.calendarConnection.create({ data: { provider, userId, ...data } });
    this.kept.set(saved.id, { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS });
    await this.audit.record({
      userId: user.id,
      action: 'connect',
      entityType: CALENDAR_CONNECTION_ENTITY,
      entityId: saved.id,
      diff: { provider, owner, accountEmail: before && before.accountEmail !== email ? { from: before.accountEmail, to: email } : email, ...(accounts && { dataCentre: zohoDataCentreOfAccounts(accounts) }) },
    });
    return result(null);
  }

  // ---------- tokens ----------

  /**
   * An access token for a calendar connection: kept until a minute before it expires (Zoho allows 10 new ones in 10
   * minutes), else made again from its refresh token, one refresh at a time a connection. A refresh refused for good
   * marks it needs_reconnecting with why. Throws the provider's problem in words.
   */
  private async tokenFor(c: CalendarConnection, options: { fresh?: boolean } = {}): Promise<string> {
    if (options.fresh) this.kept.delete(c.id);
    const kept = this.kept.get(c.id);
    if (kept && kept.until > Date.now()) return kept.token;
    const running = this.running.get(c.id);
    if (running) return running;
    const job = this.refreshed(c).finally(() => this.running.delete(c.id));
    this.running.set(c.id, job);
    return job;
  }

  private async refreshed(c: CalendarConnection): Promise<string> {
    const provider = c.provider as CalendarProvider;
    if (c.status === 'needs_reconnecting') throw new CalendarProviderError('reconnect', c.problem ?? `The ${CALENDAR_PROVIDER_LABELS[provider]} connection needs connecting again.`, 'needs_reconnecting');
    const app = await this.credentials(provider);
    if (!app) throw new CalendarProviderError('app', this.noApp(provider), 'no_app');
    const refreshToken = this.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token');
    if (!refreshToken) {
      const problem = 'The saved sign-in can’t be read any more (the server’s key changed): connect the account again.';
      await this.needsReconnecting(c, problem);
      throw new CalendarProviderError('reconnect', problem, 'unreadable');
    }
    const tenantId = provider === 'microsoft' ? ((await this.meetingTokens.app('microsoft'))?.tenantId ?? null) : null;
    let grant: CalendarGrant;
    try {
      grant = calendarGrantOf(provider, await this.http.send(calendarRefreshRequest(provider, { ...app, tenantId }, refreshToken, c.accountsServer)));
    } catch (err) {
      if (err instanceof CalendarProviderError && err.kind === 'reconnect') await this.needsReconnecting(c, err.message);
      if (err instanceof CalendarProviderError) this.logger.warn(`A ${provider} calendar's token couldn't be refreshed: ${err.code ?? err.kind}.`);
      throw err;
    }
    if (grant.refreshToken && grant.refreshToken !== refreshToken) {
      const sealed = this.seal(grant.refreshToken, 'refresh_token');
      await this.prisma.calendarConnection.updateMany({ where: { id: c.id }, data: { refreshTokenEnc: sealed.enc, tokenKeyId: sealed.keyId } });
    }
    this.kept.set(c.id, { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS });
    return grant.accessToken;
  }

  /** Marks a connection needs_reconnecting with why, once, written to the audit log (no one did it: the provider refused). */
  private async needsReconnecting(c: CalendarConnection, problem: string): Promise<void> {
    this.kept.delete(c.id);
    const { count } = await this.prisma.calendarConnection.updateMany({ where: { id: c.id, status: 'connected' }, data: { status: 'needs_reconnecting', problem } });
    if (!count) return;
    await this.audit.record({ userId: null, action: 'needs_reconnecting', entityType: CALENDAR_CONNECTION_ENTITY, entityId: c.id, diff: { provider: c.provider, owner: ownerOf(c), problem } });
  }

  /** A request with the connection's token; a refused token (401) refreshed and tried once more. */
  private async call(token: (fresh: boolean) => Promise<string>, build: (token: string) => HttpRequest): Promise<HttpAnswer | null> {
    let answer = await this.http.send(build(await token(false)));
    if (answer?.status === 401 || isZohoTokenRefused(answer)) answer = await this.http.send(build(await token(true)));
    return answer;
  }

  /**
   * Someone's busy times from one of their own calendar connections (`email`: whose, for Zoho, which reads anyone in the
   * organization by email; the company's connection reads colleagues). A token refused twice: its sign-in is gone.
   */
  private async readOwn(c: CalendarConnection, email: string, from: Date, to: Date): Promise<BusyTime[]> {
    const provider = c.provider as CalendarProvider;
    const token = (fresh: boolean) => this.tokenFor(c, { fresh });
    const refusedTwice = async (answer: HttpAnswer | null) => {
      const reconnect = new CalendarProviderError('reconnect', `${CALENDAR_COMPANY_NAMES[provider]} refused the connection’s sign-in: connect the account again.`, 'token_refused');
      if (answer?.status === 401 || isZohoTokenRefused(answer)) await this.needsReconnecting(c, reconnect.message);
      return reconnect;
    };
    if (provider === 'zoho') {
      const answer = await this.call(token, (t) => zohoFreeBusyRequest(c.accountsServer, t, email, from, to));
      if (answer?.status === 401 || isZohoTokenRefused(answer)) throw await refusedTwice(answer);
      return zohoBusyOf(answer, from, to);
    }
    if (provider === 'google') {
      const answer = await this.call(token, (t) => googleFreeBusyRequest(t, from, to));
      if (answer?.status === 401) throw await refusedTwice(answer);
      return googleBusyOf(answer, from, to);
    }
    const answer = await this.call(token, (t) => graphScheduleRequest(t, null, [email], from, to));
    if (answer?.status === 401) throw await refusedTwice(answer);
    return scheduleOf(graphBusyOf(answer, from, to), email);
  }

  /** Someone's busy times from their own meetings connection (Your Meetings) that shares them: Google's or Microsoft's. */
  private async readMeeting(c: MeetingConnection, from: Date, to: Date): Promise<BusyTime[]> {
    const token = (fresh: boolean) => this.meetingTokens.tokenFor(c, { fresh });
    if (c.provider === 'google') return googleBusyOf(await this.call(token, (t) => googleFreeBusyRequest(t, from, to)), from, to);
    return scheduleOf(graphBusyOf(await this.call(token, (t) => graphScheduleRequest(t, null, [c.accountEmail], from, to)), from, to), c.accountEmail);
  }

  // ---------- busy times, for "Find a time" and the warnings ----------

  /**
   * The busy times of each person between `from` and `to`, by employee id (owner, 25 October 2026: "Hours + calendar";
   * the brief: "Live, with a 5-second limit; on failure: Couldn't check Ahmed's calendar and the slot is still offered,
   * marked"). Every source that reads their calendar is asked together: their own calendar connections, their own
   * meetings connections that share busy times, the company's Zoho by their work email, and the company's Microsoft 365
   * (the meetings' app permission, getSchedule through its host mailbox) by their work email. Their blocks are joined;
   * `calendar` says checked, failed (a source refused, or didn't answer within 5 seconds) or none (nothing reads their
   * calendar). Never throws.
   */
  async busyTimes(people: readonly BusyPerson[], from: Date, to: Date): Promise<Map<string, PersonBusy>> {
    const out = new Map<string, PersonBusy>();
    if (!people.length) return out;
    const userIds = people.map((p) => p.userId).filter((x): x is string => !!x);
    const setup = await this.busySetup(userIds).catch((err: unknown) => {
      this.logger.warn(`Calendars couldn't be read: ${(err as Error).name}.`);
      return null;
    });
    if (!setup) {
      for (const p of people) out.set(p.employeeId, { calendar: 'failed', sources: [], reconnect: false, blocks: [] });
      return out;
    }
    const { own, meetings, companyZoho, zohoReady, companyMicrosoft } = setup;

    // the company's Microsoft 365: everyone's in one request (at most 20 mailboxes each), shared by their reads
    const msEmails = companyMicrosoft ? [...new Set(people.map((p) => (p.workEmail ? normalEmail(p.workEmail) : null)).filter((e): e is string => !!e))] : [];
    let msBatch: Promise<Map<string, BusyTime[] | CalendarProviderError>> | null = null;
    const msRead = () =>
      (msBatch ??= (async () => {
        const all = new Map<string, BusyTime[] | CalendarProviderError>();
        for (let i = 0; i < msEmails.length; i += 20) {
          const chunk = msEmails.slice(i, i + 20);
          const token = (fresh: boolean) => this.meetingTokens.tokenFor(companyMicrosoft!, { fresh });
          const answer = await this.call(token, (t) => graphScheduleRequest(t, companyMicrosoft!.accountEmail, chunk, from, to));
          for (const [k, v] of graphBusyOf(answer, from, to)) all.set(k, v);
        }
        return all;
      })());

    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), CALENDAR_CHECK_MS);
    });
    try {
      await Promise.all(
        people.map(async (p) => {
          const email = p.workEmail ? normalEmail(p.workEmail) : null;
          const mine = p.userId ? own.filter((c) => c.userId === p.userId && c.status === 'connected') : [];
          const theirMeetings = p.userId ? meetings.filter((m) => m.userId === p.userId) : [];
          const sources: Source[] = [];
          const read = new Set<string>();
          for (const c of mine) {
            read.add(`${c.provider}:${normalEmail(c.accountEmail)}`);
            sources.push({ label: CALENDAR_PROVIDER_LABELS[c.provider as CalendarProvider], read: () => this.readOwn(c, c.accountEmail, from, to) });
          }
          for (const m of theirMeetings) {
            if (!m.busyTimes || m.status !== 'connected' || read.has(`${m.provider}:${normalEmail(m.accountEmail)}`)) continue;
            read.add(`${m.provider}:${normalEmail(m.accountEmail)}`);
            sources.push({ label: CALENDAR_PROVIDER_LABELS[m.provider as CalendarProvider], read: () => this.readMeeting(m, from, to) });
          }
          if (email && companyZoho && zohoReady && !read.has(`zoho:${email}`)) {
            read.add(`zoho:${email}`);
            sources.push({ label: CALENDAR_PROVIDER_LABELS.zoho, read: () => this.readOwn(companyZoho, email, from, to) });
          }
          if (email && companyMicrosoft && !read.has(`microsoft:${email}`)) {
            sources.push({ label: CALENDAR_PROVIDER_LABELS.microsoft, read: async () => scheduleOf(await msRead(), email) });
          }
          const googleMeeting = theirMeetings.find((m) => m.provider === 'google');
          const reconnect = !!googleMeeting && !googleMeeting.busyTimes && !mine.some((c) => c.provider === 'google');
          if (!sources.length) {
            out.set(p.employeeId, { calendar: 'none', sources: [], reconnect, blocks: [] });
            return;
          }
          const results = await Promise.all(
            sources.map((s) =>
              Promise.race([
                s.read().then(
                  (blocks) => ({ ok: true as const, label: s.label, blocks }),
                  (err: unknown) => {
                    const e = err as { code?: string | null; kind?: string; name?: string };
                    this.logger.warn(`A ${s.label} busy-times read failed: ${e.code ?? e.kind ?? e.name ?? 'error'}.`);
                    return { ok: false as const, label: s.label };
                  },
                ),
                late.then(() => ({ ok: false as const, label: s.label })),
              ]),
            ),
          );
          const answered = results.filter((r): r is { ok: true; label: string; blocks: BusyTime[] } => r.ok);
          out.set(p.employeeId, {
            calendar: answered.length === results.length ? 'checked' : 'failed',
            sources: [...new Set(answered.map((r) => r.label))],
            reconnect,
            blocks: answered.flatMap((r) => r.blocks).map((b) => ({ start: b.start, end: b.end, tentative: b.tentative })),
          });
        }),
      );
    } finally {
      clearTimeout(timer);
    }
    for (const p of people) if (!out.has(p.employeeId)) out.set(p.employeeId, { calendar: 'failed', sources: [], reconnect: false, blocks: [] });
    return out;
  }

  /** What reads the calendars of these accounts: their own connections, their meetings ones, the company's. */
  private async busySetup(userIds: readonly string[]) {
    const [own, meetings, companyZoho, zohoApp, companyMs] = await Promise.all([
      userIds.length ? this.prisma.calendarConnection.findMany({ where: { userId: { in: [...userIds] } } }) : Promise.resolve([] as CalendarConnection[]),
      userIds.length ? this.prisma.meetingConnection.findMany({ where: { userId: { in: [...userIds] }, provider: { in: ['google', 'microsoft'] } } }) : Promise.resolve([] as MeetingConnection[]),
      this.prisma.calendarConnection.findFirst({ where: { provider: 'zoho', userId: null, status: 'connected' } }),
      this.zohoApp(),
      this.prisma.meetingConnection.findFirst({ where: { provider: 'microsoft', userId: null, status: 'connected' } }),
    ]);
    const msApp = companyMs && hostsByApp(companyMs) ? this.meetingTokens.credentials(await this.meetingTokens.app('microsoft'), 'company') : null;
    return { own, meetings, companyZoho, zohoReady: !!this.zohoCredentials(zohoApp), companyMicrosoft: msApp ? companyMs : null };
  }
}

/** Zoho's API refusing the access token, which it answers with an error code (INVALID_OAUTHTOKEN) as well as 401. */
function isZohoTokenRefused(answer: HttpAnswer | null): boolean {
  const b = answer?.body as { error?: unknown } | null | undefined;
  return Array.isArray(b?.error) && b.error.some((e) => !!e && typeof e === 'object' && (e as { error_code?: unknown }).error_code === 'INVALID_OAUTHTOKEN');
}

/** A mailbox's schedule from getSchedule's answer, or its error thrown; a mailbox it didn't answer for: refused. */
function scheduleOf(all: Map<string, BusyTime[] | CalendarProviderError>, email: string): BusyTime[] {
  const v = all.get(normalEmail(email));
  if (!v) throw new CalendarProviderError('refused', 'Microsoft didn’t answer for that mailbox.', 'no_schedule');
  if (v instanceof CalendarProviderError) throw v;
  return v;
}

