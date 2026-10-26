import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cairoClock,
  DEVELOPER_NO_FILES,
  isEmail,
  MEETING_CONNECT_MINUTES,
  normalEmail,
  OFFICE_ADDRESS_DEFAULTS,
  ZOHO_PEOPLE_DEFAULT_TIME_ZONE,
  ZOHO_PEOPLE_HR_ONLY,
  ZOHO_PEOPLE_NOT_CONNECTED,
  ZOHO_PEOPLE_OWN_ACCOUNT,
  ZOHO_PEOPLE_PAGE,
  ZOHO_PEOPLE_SUPER_ADMIN_ONLY,
  zohoDataCentre,
  zohoDataCentreOfAccounts,
  zohoPeopleRedirectUri,
  type MeetingConnectProblem,
  type ZohoPeopleConnectionView,
  type ZohoPeopleConnectResult,
  type ZohoPeopleTestView,
} from '@trendlix/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { calendarCodeRequest, calendarGrantOf, CalendarProviderError, calendarRefreshRequest, zohoEmailOf, zohoHosts, zohoRevokeRequest, zohoUserInfoRequest, type CalendarGrant } from '../calendars/calendar-providers.js';
import { CalendarsService } from '../calendars/calendars.service.js';
import { todayInCairo } from '../common/date-only.js';
import type { ZohoPeopleConnection } from '../generated/prisma/client.js';
import { emailOfIdToken, pkcePair, type HttpRequest } from '../meetings/meeting-providers.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  datePatternsFrom,
  isTimeZone,
  isZohoDatePattern,
  zohoAttendanceRequest,
  zohoDayOf,
  zohoOrganizationOf,
  zohoOrganizationRequest,
  zohoPeopleAuthorizeUrl,
  ZohoPeopleError,
  zohoPeopleHost,
  zohoProblemOf,
  ZOHO_TIME_MODES,
  type ZohoDayRead,
  type ZohoTimeMode,
  type ZohoWho,
} from './zoho-people-api.js';
import { ZohoPeopleHttp } from './zoho-people-http.js';
import { openZohoPeopleSecret, sameZohoPeopleKey, sealZohoPeopleSecret, zohoPeopleKeyIdOf, zohoPeopleKeyOf, type ZohoPeopleSecretPurpose } from './zoho-people-secret.js';

// Zoho People's connection (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho people through
// api?"; asked, "Yes, daily + backfill": "a Super Admin connects Zoho once"). A Super Admin's, in their own session,
// never a developer's: the Zoho app is the one Organization → Calendars keeps (CalendarApp 'zoho': one Server-based
// Application at api-console.zoho.com serves both, Zoho asking each sign-in's scopes, each with its own redirect URI), the
// sign-in asks Zoho People's scopes (ZOHO_PEOPLE_SCOPES) at the app's data centre and comes back naming the account's,
// where its tokens are made and refreshed; the refresh token is sealed with its own key (zoho-people-secret.ts) and never
// returned. Zoho People's organization's time zone and date format are read as it connects and on each test, so its
// times are read on its own clock (Cairo's when it doesn't say). The test reads today's attendance for the connected
// account and a colleague, in counts. Disconnecting revokes the sign-in at Zoho. Every change is audited (never a token).
// The day's read for the runs: one employee's day, its token refreshed once when refused, the date format and the method
// found once and kept; and how the date format is named, when Zoho sends colleagues' times without their hour (owner, 26
// October 2026: "Zoho sent “26-Oct-2026”"), the way that brings them whole found once and kept, else each day's first
// check-in and last check-out read.

export const ZOHO_PEOPLE_CONNECTION_ENTITY = 'zoho_people_connection';

/** A token is renewed this long before it expires (Zoho allows 10 new ones in 10 minutes: kept until then). */
const MARGIN_MS = 60_000;
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;
const SIGN_IN_TIMEOUT_MS = 15_000;

/** The sign-in's state, sealed: user, redirect URI, verifier, expiry (ms), a nonce. */
interface SignInState {
  u: string;
  r: string;
  v: string;
  e: number;
  n: string;
}

/** What a day is read with: Zoho's clock and the office addresses (for office or remote). */
export interface ZohoReadContext {
  timeZone: string;
  officeAddresses: readonly string[];
}

@Injectable()
export class ZohoPeopleService {
  private readonly logger = new Logger('ZohoPeople');
  private readonly key: Buffer;
  private kept: { token: string; until: number } | null = null;
  private refreshing: Promise<string> | null = null;
  /** The date format and the method Zoho took last (found once, then kept). */
  private pattern: string | null = null;
  private method: 'GET' | 'POST' = 'GET';
  /** How the date format is named (zoho-people-api.ts ZOHO_TIME_MODES): the way that brought the times whole, kept. */
  private timeMode: ZohoTimeMode = 'named';
  /** No way of asking brought the times whole: each day's first check-in and last check-out are read instead. */
  private timesWithoutHour = false;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly http: ZohoPeopleHttp,
    private readonly calendars: CalendarsService,
  ) {
    this.key = zohoPeopleKeyOf(config.getOrThrow<string>('JWT_SECRET'));
  }

  // ---------- who ----------

  /** A Super Admin in their own session; anyone else refused (a developer too, also refused before by the interceptor). */
  assertSuperAdmin(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(ZOHO_PEOPLE_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(ZOHO_PEOPLE_OWN_ACCOUNT);
  }

  /** HR or a Super Admin (the guard asks the same); never a developer. */
  assertFetcher(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!actsAs(user.roles, ['hr', 'super_admin'])) throw new ForbiddenException(ZOHO_PEOPLE_HR_ONLY);
  }

  /** Whether the caller manages the connection: a Super Admin in their own session. */
  manages(user: SessionUser): boolean {
    return !user.developer && isSuperAdmin(user) && !user.viewAs;
  }

  // ---------- sealing ----------

  private seal(plain: string, purpose: ZohoPeopleSecretPurpose): { enc: string; keyId: string } {
    return { enc: sealZohoPeopleSecret(plain, this.key, purpose), keyId: zohoPeopleKeyIdOf(this.key) };
  }

  private open(enc: string | null | undefined, keyId: string | null | undefined, purpose: ZohoPeopleSecretPurpose): string | null {
    if (!enc || !sameZohoPeopleKey(keyId, this.key)) return null;
    return openZohoPeopleSecret(enc, this.key, purpose);
  }

  // ---------- the connection ----------

  connection(): Promise<ZohoPeopleConnection | null> {
    return this.prisma.zohoPeopleConnection.findUnique({ where: { id: 1 } });
  }

  /** The connection as the page shows it: never its token. */
  async connectionView(c: ZohoPeopleConnection | null): Promise<ZohoPeopleConnectionView | null> {
    if (!c) return null;
    const names = c.connectedById ? await this.names([c.connectedById]) : new Map<string, { id: string; name: string }>();
    return {
      accountEmail: c.accountEmail,
      status: c.status === 'needs_reconnecting' ? 'needs_reconnecting' : 'connected',
      problem: c.problem,
      dataCentre: zohoDataCentreOfAccounts(c.accountsServer),
      timeZone: c.timeZone,
      dateFormat: c.dateFormat,
      connectedAt: c.connectedAt.toISOString(),
      connectedBy: c.connectedById ? (names.get(c.connectedById) ?? null) : null,
      lastTest: c.lastTestAt ? { at: c.lastTestAt.toISOString(), ok: !!c.lastTestOk, message: c.lastTestMessage ?? '' } : null,
    };
  }

  private async names(ids: string[]): Promise<Map<string, { id: string; name: string }>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    return userNames(this.prisma, users);
  }

  /** The zone Zoho's times are read in: its organization's, else Cairo's. */
  timeZoneOf(c: Pick<ZohoPeopleConnection, 'timeZone'> | null): string {
    return c?.timeZone && isTimeZone(c.timeZone) ? c.timeZone : ZOHO_PEOPLE_DEFAULT_TIME_ZONE;
  }

  /** What a day is read with now: Zoho's clock, and the office addresses HR keeps (Check-in Setup). */
  async readContext(c?: ZohoPeopleConnection | null): Promise<ZohoReadContext> {
    const [connection, settings] = await Promise.all([c === undefined ? this.connection() : Promise.resolve(c), this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { officeAddresses: true } })]);
    return { timeZone: this.timeZoneOf(connection), officeAddresses: settings?.officeAddresses ?? [...OFFICE_ADDRESS_DEFAULTS] };
  }

  // ---------- signing in ----------

  /** POST /zoho-people/oauth/start: Zoho's sign-in page, returning to the website's /zoho-people/oauth. */
  async start(originParam: string, user: SessionUser): Promise<{ url: string }> {
    this.assertSuperAdmin(user);
    const origin = (originParam ?? '').trim().replace(/\/+$/, '');
    if (!ORIGIN.test(origin) || (origin.startsWith('http:') && !LOCAL.test(origin))) throw new BadRequestException(['The website’s address could not be read. Reload the page and try again.']);
    const app = await this.calendars.sharedZohoApp();
    if (!app.credentials || !app.dataCentre) throw new BadRequestException(['The company’s Zoho app isn’t set up: save its client ID, secret and data centre first.']);
    const redirectUri = zohoPeopleRedirectUri(origin);
    const { verifier, challenge } = pkcePair();
    const state: SignInState = { u: user.id, r: redirectUri, v: verifier, e: Date.now() + MEETING_CONNECT_MINUTES * 60_000, n: randomBytes(8).toString('base64url') };
    const sealed = sealZohoPeopleSecret(JSON.stringify(state), this.key, 'oauth_state');
    const accounts = zohoDataCentre(app.dataCentre).accounts;
    return { url: zohoPeopleAuthorizeUrl({ clientId: app.credentials.clientId }, { redirectUri, state: sealed, challenge, accounts }) };
  }

  private openState(sealed: string | null | undefined): SignInState | null {
    const plain = openZohoPeopleSecret(sealed, this.key, 'oauth_state');
    if (!plain) return null;
    try {
      const raw = JSON.parse(plain) as Record<string, unknown>;
      return typeof raw.u === 'string' && typeof raw.r === 'string' && typeof raw.v === 'string' && typeof raw.e === 'number' ? (raw as unknown as SignInState) : null;
    } catch {
      return null;
    }
  }

  /**
   * POST /zoho-people/oauth/finish: Zoho's return (the website passes its code, state or error on, and the accounts
   * server): checked, the code traded for tokens at the account's own data centre, the account read, Zoho People's time
   * zone and date format read, the connection saved (its refresh token sealed). Always answered with how it went.
   */
  async finish(dto: { code?: string | null; state?: string | null; error?: string | null; accountsServer?: string | null }, user: SessionUser): Promise<ZohoPeopleConnectResult> {
    const result = (problem: MeetingConnectProblem | null, said: string | null = null): ZohoPeopleConnectResult => ({ back: ZOHO_PEOPLE_PAGE, ok: !problem, problem, said });
    const failed = async (problem: MeetingConnectProblem, said: string | null = null) => {
      await this.audit.record({ userId: user.id, action: 'connect_failed', entityType: ZOHO_PEOPLE_CONNECTION_ENTITY, entityId: null, diff: { problem, ...(said && { said }) } });
      return result(problem, said);
    };
    const state = this.openState(dto.state);
    if (!state || state.e < Date.now()) return result('expired');
    if (state.u !== user.id) return result('other_user');
    if (!this.manages(user)) return result('not_allowed');
    const error = typeof dto.error === 'string' && dto.error ? dto.error.slice(0, 60) : null;
    if (error) return failed(error === 'access_denied' ? 'denied' : 'refused', /^[a-z0-9_.-]+$/i.test(error) ? error : null);
    if (!dto.code) return failed('refused', 'no_code');
    const app = await this.calendars.sharedZohoApp();
    if (!app.credentials || !app.dataCentre) return failed('no_app');
    const named = (dto.accountsServer ?? '').trim();
    if (named && !zohoDataCentreOfAccounts(named)) return failed('refused', 'unknown_data_centre');
    const accounts = named ? zohoHosts(named).accounts : zohoDataCentre(app.dataCentre).accounts;

    let grant: CalendarGrant;
    try {
      grant = calendarGrantOf('zoho', await this.http.send(calendarCodeRequest('zoho', app.credentials, { code: dto.code, redirectUri: state.r, verifier: state.v, accounts }), SIGN_IN_TIMEOUT_MS), 'connect');
    } catch (err) {
      if (!(err instanceof CalendarProviderError)) throw err;
      return failed(err.kind === 'unreachable' || err.kind === 'busy' ? 'unreachable' : 'refused', err.code);
    }
    if (!grant.refreshToken) return failed('refused', 'no_refresh_token');
    let email = emailOfIdToken(grant.idToken);
    if (!email) email = zohoEmailOf(await this.http.send(zohoUserInfoRequest(accounts, grant.accessToken), SIGN_IN_TIMEOUT_MS));
    if (!email) return failed('no_account');
    // Zoho People's own clock and date format (an admin's read; left as they were when it doesn't say)
    const org = zohoOrganizationOf(await this.http.call(zohoOrganizationRequest(zohoPeopleHost(accounts), grant.accessToken)));

    const before = await this.connection();
    const sealed = this.seal(grant.refreshToken, 'refresh_token');
    const data = {
      accountEmail: email,
      refreshTokenEnc: sealed.enc,
      tokenKeyId: sealed.keyId,
      accountsServer: accounts,
      status: 'connected',
      problem: null,
      timeZone: org.timeZone ?? before?.timeZone ?? null,
      dateFormat: org.dateFormat ?? before?.dateFormat ?? null,
      connectedById: user.id,
      connectedAt: new Date(),
    };
    await this.prisma.zohoPeopleConnection.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    // the old sign-in revoked at Zoho (best effort), so it doesn't stay behind
    const oldToken = before ? this.open(before.refreshTokenEnc, before.tokenKeyId, 'refresh_token') : null;
    if (oldToken && oldToken !== grant.refreshToken) await this.http.send(zohoRevokeRequest(app.credentials, before!.accountsServer, oldToken));
    this.kept = { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS };
    this.pattern = null;
    await this.audit.record({
      userId: user.id,
      action: 'connect',
      entityType: ZOHO_PEOPLE_CONNECTION_ENTITY,
      entityId: null,
      diff: {
        accountEmail: before && before.accountEmail !== email ? { from: before.accountEmail, to: email } : email,
        dataCentre: zohoDataCentreOfAccounts(accounts),
        timeZone: data.timeZone,
        dateFormat: data.dateFormat,
      },
    });
    return result(null);
  }

  /** POST /zoho-people/disconnect: the connection removed, its sign-in revoked at Zoho (best effort). */
  async disconnect(user: SessionUser): Promise<void> {
    this.assertSuperAdmin(user);
    const c = await this.connection();
    if (!c) return;
    const token = this.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token');
    const app = await this.calendars.sharedZohoApp();
    if (token && app.credentials) await this.http.send(zohoRevokeRequest(app.credentials, c.accountsServer, token));
    await this.prisma.zohoPeopleConnection.delete({ where: { id: 1 } });
    this.kept = null;
    await this.audit.record({ userId: user.id, action: 'disconnect', entityType: ZOHO_PEOPLE_CONNECTION_ENTITY, entityId: null, diff: { accountEmail: c.accountEmail } });
  }

  // ---------- tokens ----------

  /**
   * An access token: kept until a minute before it expires (Zoho allows 10 new ones in 10 minutes), else made again from
   * the refresh token, one refresh at a time. A refresh refused for good marks the connection needs_reconnecting.
   */
  private async token(fresh = false): Promise<string> {
    if (fresh) this.kept = null;
    if (this.kept && this.kept.until > Date.now()) return this.kept.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshed().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshed(): Promise<string> {
    const c = await this.connection();
    if (!c) throw new ZohoPeopleError('token', ZOHO_PEOPLE_NOT_CONNECTED, 'not_connected');
    if (c.status === 'needs_reconnecting') throw new ZohoPeopleError('token', c.problem ?? 'Zoho People’s connection needs connecting again.', 'needs_reconnecting');
    const app = await this.calendars.sharedZohoApp();
    if (!app.credentials) throw new ZohoPeopleError('token', 'The company’s Zoho app isn’t set up any more: a Super Admin saves it on Organization → Zoho People.', 'no_app');
    const refreshToken = this.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token');
    if (!refreshToken) {
      const problem = 'The saved sign-in can’t be read any more (the server’s key changed): a Super Admin connects Zoho People again.';
      await this.needsReconnecting(problem);
      throw new ZohoPeopleError('token', problem, 'unreadable');
    }
    let grant: CalendarGrant;
    try {
      grant = calendarGrantOf('zoho', await this.http.send(calendarRefreshRequest('zoho', app.credentials, refreshToken, c.accountsServer)));
    } catch (err) {
      if (!(err instanceof CalendarProviderError)) throw err;
      this.logger.warn(`Zoho People's token couldn't be refreshed: ${err.code ?? err.kind}.`);
      if (err.kind === 'reconnect' || err.kind === 'app') {
        const problem = err.kind === 'app' ? `${err.message} Then a Super Admin connects Zoho People again.` : 'Zoho says the connection was revoked or has expired: a Super Admin connects Zoho People again.';
        await this.needsReconnecting(problem);
        throw new ZohoPeopleError('token', problem, err.code);
      }
      throw new ZohoPeopleError(err.kind === 'unreachable' ? 'unreachable' : 'busy', err.message, err.code);
    }
    this.kept = { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS };
    return grant.accessToken;
  }

  /** Marks the connection needs_reconnecting with why, once, written to the audit log (no one did it: Zoho refused). */
  async needsReconnecting(problem: string): Promise<void> {
    this.kept = null;
    const { count } = await this.prisma.zohoPeopleConnection.updateMany({ where: { id: 1, status: 'connected' }, data: { status: 'needs_reconnecting', problem } });
    if (count) await this.audit.record({ userId: null, action: 'needs_reconnecting', entityType: ZOHO_PEOPLE_CONNECTION_ENTITY, entityId: null, diff: { problem } });
  }

  // ---------- reading a day ----------

  /**
   * One employee's day from Zoho People, in its turn (ZohoPeopleHttp: one call a second): its answer read (zohoDayOf),
   * asked the way kept (timeMode). Its times sent without their hour (owner, 26 October 2026: "Zoho sent “26-Oct-2026”"
   * for a colleague's check-in, while the connected account's own came whole): asked again the other ways, the first that
   * brings them whole kept for every day after; when none does (said once, then not asked again), the day's first
   * check-in and last check-out when Zoho sent those whole, else unreadable. Throws ZohoPeopleError for anything else Zoho
   * refuses (a lock, someone not found, not permitted …): the run decides.
   */
  async day(who: ZohoWho, date: string, ctx: ZohoReadContext): Promise<ZohoDayRead> {
    const first = await this.read(who, date, ctx, this.timeMode);
    if (first.kind !== 'unreadable' || !first.dateOnly) return first;
    if (!this.timesWithoutHour) {
      for (const mode of ZOHO_TIME_MODES) {
        if (mode === this.timeMode) continue;
        let again: ZohoDayRead;
        try {
          again = await this.read(who, date, ctx, mode);
        } catch (err) {
          // this way refused (its date or format, or anything the way kept didn't meet): the next one
          if (err instanceof ZohoPeopleError && (err.kind === 'date_format' || err.kind === 'method' || err.kind === 'refused' || err.kind === 'not_found' || err.kind === 'not_permitted')) continue;
          throw err;
        }
        if (again.kind === 'unreadable' && again.dateOnly) continue;
        this.logger.log(`Zoho People sends the times whole when the date format is ${mode}: kept for every day after.`);
        this.timeMode = mode;
        return again;
      }
      this.timesWithoutHour = true;
      this.logger.warn('Zoho People sends check-in times without their hour however asked: each day’s first check-in and last check-out are read instead.');
    }
    return first.firstLast ? { kind: 'day', day: first.firstLast } : first;
  }

  /**
   * One employee's day asked one way (`mode`). The token refused: refreshed and asked once more, then the connection
   * needs connecting again. Named: the date's format refused, the next one tried (the organization's first), and the one
   * Zoho takes kept; the other ways ask in the one kept (unnamed: the organization's own), a refusal of it thrown. The
   * method refused: the other.
   */
  private async read(who: ZohoWho, date: string, ctx: ZohoReadContext, mode: ZohoTimeMode): Promise<ZohoDayRead> {
    const c = await this.connection();
    if (!c) throw new ZohoPeopleError('token', ZOHO_PEOPLE_NOT_CONNECTED, 'not_connected');
    const people = zohoPeopleHost(c.accountsServer);
    const own = isZohoDatePattern(c.dateFormat) ? c.dateFormat : null;
    const patterns =
      mode === 'unnamed'
        ? [own ?? this.pattern ?? datePatternsFrom(null)[0]]
        : mode === 'timed'
          ? [this.pattern ?? own ?? datePatternsFrom(null)[0]]
          : this.pattern
            ? [this.pattern, ...datePatternsFrom(c.dateFormat).filter((p) => p !== this.pattern)]
            : datePatternsFrom(c.dateFormat);
    let p = 0;
    let refreshedOnce = false;
    let switchedMethod = false;
    for (;;) {
      const pattern = patterns[p];
      const build = (token: string): HttpRequest => zohoAttendanceRequest(people, token, who, date, pattern, this.method, mode);
      const answer = await this.http.call(build(await this.token(false)));
      const problem = zohoProblemOf(answer);
      if (!problem) {
        if (mode === 'named' && this.pattern !== pattern) {
          this.pattern = pattern;
          if (c.dateFormat !== pattern) await this.prisma.zohoPeopleConnection.updateMany({ where: { id: 1 }, data: { dateFormat: pattern } });
        }
        return zohoDayOf(answer!.body, date, { pattern, timeZone: ctx.timeZone, officeAddresses: ctx.officeAddresses });
      }
      if (problem.kind === 'token' && !refreshedOnce) {
        refreshedOnce = true;
        await this.token(true);
        continue;
      }
      if (problem.kind === 'token') {
        const said = 'Zoho People refused the connection’s sign-in: a Super Admin connects Zoho People again.';
        await this.needsReconnecting(said);
        throw new ZohoPeopleError('token', said, problem.code);
      }
      if (problem.kind === 'scope') {
        await this.needsReconnecting(problem.message);
        throw problem;
      }
      if (problem.kind === 'date_format' && p + 1 < patterns.length) {
        p++;
        continue;
      }
      if (problem.kind === 'date_format' && mode !== 'named') throw problem;
      if (problem.kind === 'date_format') throw new ZohoPeopleError('refused', 'Zoho People refused every date format tried: test the connection on Organization → Zoho People.', problem.code);
      if (problem.kind === 'method' && !switchedMethod) {
        switchedMethod = true;
        this.method = this.method === 'GET' ? 'POST' : 'GET';
        continue;
      }
      throw problem;
    }
  }

  // ---------- the test ----------

  /**
   * POST /zoho-people/test: today's attendance read for the connected account (and `email`, a colleague, when given),
   * said in counts; Zoho People's time zone and date format read again. Kept on the connection as its last test, audited.
   */
  async test(email: string | null | undefined, user: SessionUser): Promise<ZohoPeopleTestView> {
    this.assertSuperAdmin(user);
    let c = await this.connection();
    if (!c) throw new BadRequestException([ZOHO_PEOPLE_NOT_CONNECTED]);
    const colleague = email ? normalEmail(email) : null;
    if (colleague !== null && !isEmail(colleague)) throw new BadRequestException(['Write the colleague’s work email in full, e.g. sara@trendlix.com.']);
    // Zoho asked to wait (a fetch is waiting out its lock): said at once, rather than the test waiting with it
    const waitMs = this.http.nextCallAt - this.http.clock.now();
    if (waitMs > 5_000) throw new ConflictException([`Zoho People asked to wait (its limit of calls): test again after ${cairoClock(Date.now() + waitMs)}.`]);
    const parts: string[] = [];
    let ok = true;
    // the organization's clock and date format, read again (an admin's: left as they were when Zoho doesn't say)
    try {
      const org = zohoOrganizationOf(await this.http.call(zohoOrganizationRequest(zohoPeopleHost(c.accountsServer), await this.token(false))));
      if (org.timeZone || org.dateFormat) {
        c = await this.prisma.zohoPeopleConnection.update({ where: { id: 1 }, data: { ...(org.timeZone && { timeZone: org.timeZone }), ...(org.dateFormat && { dateFormat: org.dateFormat }) } });
      }
    } catch (err) {
      if (!(err instanceof ZohoPeopleError)) throw err;
    }
    const ctx = await this.readContext(c);
    const today = todayInCairo();
    for (const who of new Set([normalEmail(c.accountEmail), ...(colleague ? [colleague] : [])])) {
      try {
        const read = await this.day({ emailId: who }, today, ctx);
        parts.push(`${who}: ${this.readText(read)}`);
      } catch (err) {
        if (!(err instanceof ZohoPeopleError)) throw err;
        ok = false;
        parts.push(`${who}: ${err.message}`);
      }
    }
    const zone = c.timeZone && isTimeZone(c.timeZone) ? c.timeZone : null;
    const clock = zone ? `Zoho People’s time zone is ${zone}${zone === ZOHO_PEOPLE_DEFAULT_TIME_ZONE ? '' : ': its times are read on that clock'}` : `Zoho People didn’t say its time zone: its times are read as ${ZOHO_PEOPLE_DEFAULT_TIME_ZONE}’s`;
    const format = c.dateFormat && isZohoDatePattern(c.dateFormat) ? `, its date format ${c.dateFormat}` : '';
    const message = `${ok ? 'Zoho People answered today’s attendance' : 'Zoho People didn’t answer for everyone'}: ${parts.join('; ')}. ${clock}${format}.`;
    const at = new Date();
    await this.prisma.zohoPeopleConnection.updateMany({ where: { id: 1 }, data: { lastTestAt: at, lastTestOk: ok, lastTestMessage: message } });
    await this.audit.record({ userId: user.id, action: 'test_zoho_people', entityType: ZOHO_PEOPLE_CONNECTION_ENTITY, entityId: null, diff: { ok, read: parts.length, timeZone: c.timeZone, dateFormat: c.dateFormat } });
    return { at: at.toISOString(), ok, message };
  }

  /** A test's day in counts: "3 check-ins and check-outs, the first check-in at 9:02 AM (Present)", never a place. */
  private readText(read: ZohoDayRead): string {
    if (read.kind === 'empty') return 'nothing yet today';
    if (read.kind === 'unreadable') return read.message;
    const d = read.day;
    const counted = d.punches
      ? `${d.punches} ${d.punches === 1 ? 'check-in or check-out' : 'check-ins and check-outs'}${d.day.checkIn ? `, the first check-in at ${cairoClock(d.day.checkIn)}` : ''}`
      : 'no check-in yet';
    return `${counted}${d.day.zohoStatus ? ` (${d.day.zohoStatus})` : ''}`;
  }
}
