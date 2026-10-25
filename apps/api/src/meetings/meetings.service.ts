import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  accountIsTheirs,
  companyAppReady,
  companyConnectsBy,
  DEVELOPER_NO_FILES,
  GOOGLE_FREEBUSY_SCOPE,
  isEmail,
  isMeetingProvider,
  maskedEmail,
  MEETING_COMPANY_NAMES,
  MEETING_CONNECT_MINUTES,
  MEETING_PAGES,
  MEETING_PROVIDER_LABELS,
  MEETING_PROVIDERS,
  meetingAppProblems,
  meetingChoiceKey,
  meetingChoicesFor,
  meetingRedirectUri,
  MEETINGS_OWN_ACCOUNT,
  MEETINGS_SCHEDULERS_ONLY,
  MEETINGS_SUPER_ADMIN_ONLY,
  normalEmail,
  parseMeetingChoice,
  personalAppReady,
  zonedMoment,
  type MeetingAppView,
  type MeetingChoices,
  type MeetingConnectProblem,
  type MeetingConnectResult,
  type MeetingConnectStart,
  type MeetingConnectionView,
  type MeetingOwner,
  type MeetingProvider,
  type MeetingSettingsView,
  type MeetingTestView,
  type MyMeetingsView,
} from '@trendlix/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, todayInCairo } from '../common/date-only.js';
import type { MeetingApp, MeetingConnection } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { managesRecruitment } from '../recruitment/recruitment-access.js';
import { MeetingHttp } from './meeting-http.js';
import {
  authorizeUrl,
  codeTokenRequest,
  createRequest,
  deleteRequest,
  doneAnswer,
  emailOfIdToken,
  getRequest,
  goneAnswer,
  googleRevokeRequest,
  grantsGoogleCalendar,
  grantsScope,
  hostKept,
  madeOf,
  MeetingProviderError,
  microsoftCalendarRequest,
  pkcePair,
  problemOf,
  targetOf,
  teamsNotAllowed,
  tokenGrantOf,
  updateRequest,
  zoomEmailOf,
  zoomMeRequest,
  zoomRevokeRequest,
  type HttpAnswer,
  type HttpRequest,
  type MeetingDetails,
  type MeetingTarget,
  type TokenGrant,
} from './meeting-providers.js';
import { hostsByApp, MEETING_CONNECTION_ENTITY, MeetingTokensService, ownerOf } from './meeting-tokens.service.js';
import type { MeetingAppDto } from './meetings.dto.js';

// Online interview meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft Teams, Zoom", and who
// hosts them, "make it both"; packages/shared meetings.ts):
// - Organization → Meetings, a Super Admin's in their own session (never a developer's): each provider's app (the
//   secrets sealed, never returned: "Set · Replace"), the company's connection (Google: signing in to the hosting
//   account; Microsoft and Zoom: naming the host mailbox or user, checked with the app's own token), the default for new
//   online interviews, and "Create a test meeting" (made and deleted, said in plain words).
// - Your Meetings, each HR person's (and a Super Admin's) own: connecting their Google, Microsoft or Zoom account, once
//   the company's app for it is set up; disconnecting anytime. Also by a Super Admin viewing as them (owner, 25 October
//   2026: "i need to be able to set it up on behalf of the employee, by acting as them"): seen while viewing, changed
//   only with Act as them on (the guard refuses every change before), and then the account signed in to must be one of
//   the person's emails (work, sign-in or personal: accountIsTheirs), so the Super Admin's own isn't linked by mistake.
// - The sign-in: the state sealed (who started it, for whom, in which session, the Super Admin acting as them if any,
//   the return address, the PKCE verifier, ten minutes), so the return is the same person's, in the same session, in
//   time, for the provider it went to.
// - For interviews (interviews.service.ts): a meeting made with the scheduler's choice, moved with the interview,
//   deleted when it is cancelled; the provider's refusals in plain words, never failing the interview.
// Every change is written to the audit log: connections made and removed, the apps' credentials (only as "changed"), the
// default, the tests; never a token or a secret.

export const MEETING_SETTINGS_ENTITY = 'meeting_settings';

/** A meeting the system made, as the interview keeps it. */
export interface MadeMeeting {
  provider: MeetingProvider;
  owner: MeetingOwner;
  connectionId: string;
  meetingId: string;
  host: string;
  joinUrl: string;
}

/** An interview's meeting, to move or delete it. */
export interface MeetingRef {
  provider: MeetingProvider;
  connectionId: string | null;
  meetingId: string;
  host: string | null;
}

export type MeetingResult<T> = { ok: true; value: T } | { ok: false; problem: string };

/**
 * The sign-in's state, sealed: provider, owner, user, redirect URI, verifier, expiry (ms), the session it was started in
 * (`s`) and the Super Admin acting as the user (`b`, null in one's own session).
 */
interface SignInState {
  p: MeetingProvider;
  o: MeetingOwner;
  u: string;
  r: string;
  v: string;
  e: number;
  s: string;
  b: string | null;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;
/** How long to wait for Google's Meet (or Microsoft's Teams) link when it isn't ready on making the meeting. */
const LINK_TRIES = 3;
const LINK_WAIT_MS = 700;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger('Meetings');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly http: MeetingHttp,
    private readonly tokens: MeetingTokensService,
  ) {}

  // ---------- who ----------

  /** A Super Admin in their own session; anyone else refused (a developer too, also refused before by the interceptor). */
  private assertSuperAdmin(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(MEETINGS_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(MEETINGS_OWN_ACCOUNT);
  }

  /**
   * Someone who schedules interviews (HR, a Super Admin): in their own session, or a Super Admin viewing as them (25
   * October 2026), who changes anything only with Act as them on (the guard refuses it before).
   */
  private assertScheduler(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!managesRecruitment(user)) throw new ForbiddenException(MEETINGS_SCHEDULERS_ONLY);
  }

  /** The person's own emails, the ones an account of theirs may be: sign-in, and their profile's work and personal. */
  private async emailsOf(user: SessionUser): Promise<string[]> {
    const e = user.employeeId ? await this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { workEmail: true, personalEmail: true } }) : null;
    return [user.email, e?.workEmail, e?.personalEmail].filter((x): x is string => !!x).map(normalEmail);
  }

  /** A sign-in revoked at the provider (best effort): Google's and Zoom's; Microsoft has no revocation of one token. */
  private async revoke(provider: MeetingProvider, owner: MeetingOwner, refreshToken: string | null): Promise<void> {
    if (refreshToken && provider === 'google') await this.http.send(googleRevokeRequest(refreshToken));
    if (refreshToken && provider === 'zoom') {
      const app = this.tokens.credentials(await this.tokens.app('zoom'), owner);
      if (app) await this.http.send(zoomRevokeRequest(app, refreshToken));
    }
  }

  private provider(value: string): MeetingProvider {
    if (!isMeetingProvider(value)) throw new NotFoundException('There is no such meeting provider.');
    return value;
  }

  // ---------- the views ----------

  private appView(provider: MeetingProvider, row: (MeetingApp & { updatedBy?: { id: string } | null }) | null, names: Map<string, { id: string; name: string }>): MeetingAppView {
    const secretSet = !!row?.clientSecretEnc;
    const userSecretSet = !!row?.userClientSecretEnc;
    const view = {
      provider,
      clientId: row?.clientId ?? null,
      clientSecretSet: secretSet && this.tokens.readable(row?.clientSecretEnc, row?.clientSecretKeyId, 'client_secret'),
      clientSecretUnreadable: secretSet && !this.tokens.readable(row?.clientSecretEnc, row?.clientSecretKeyId, 'client_secret'),
      tenantId: row?.tenantId ?? null,
      accountId: row?.accountId ?? null,
      userClientId: row?.userClientId ?? null,
      userClientSecretSet: userSecretSet && this.tokens.readable(row?.userClientSecretEnc, row?.userClientSecretKeyId, 'user_client_secret'),
      userClientSecretUnreadable: userSecretSet && !this.tokens.readable(row?.userClientSecretEnc, row?.userClientSecretKeyId, 'user_client_secret'),
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedById ? (names.get(row.updatedById) ?? null) : null,
    };
    return { ...view, companyReady: companyAppReady(provider, view), personalReady: personalAppReady(provider, view) };
  }

  private connectionView(c: MeetingConnection, names: Map<string, { id: string; name: string }>): MeetingConnectionView {
    return {
      id: c.id,
      provider: c.provider as MeetingProvider,
      owner: ownerOf(c),
      accountEmail: c.accountEmail,
      status: c.status as MeetingConnectionView['status'],
      problem: c.problem,
      connectedAt: c.connectedAt.toISOString(),
      connectedBy: c.connectedById ? (names.get(c.connectedById) ?? null) : null,
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      lastTest: c.lastTestAt ? { at: c.lastTestAt.toISOString(), ok: !!c.lastTestOk, message: c.lastTestMessage ?? '' } : null,
      // a person's own shares their busy times with "Find a time" (25 October 2026); the company's never
      busyTimes: !!c.userId && c.busyTimes,
    };
  }

  private async names(ids: (string | null)[]): Promise<Map<string, { id: string; name: string }>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, email: true } });
    return userNames(this.prisma, users);
  }

  private async apps(): Promise<Map<MeetingProvider, MeetingApp>> {
    const rows = await this.prisma.meetingApp.findMany();
    return new Map(rows.map((r) => [r.provider as MeetingProvider, r]));
  }

  /** GET /meetings/settings: the three apps (never a secret), the company's connections and the default. */
  async settings(user: SessionUser): Promise<MeetingSettingsView> {
    this.assertSuperAdmin(user);
    return this.settingsView();
  }

  private async settingsView(): Promise<MeetingSettingsView> {
    const [apps, company] = await Promise.all([this.apps(), this.prisma.meetingConnection.findMany({ where: { userId: null } })]);
    const names = await this.names([...[...apps.values()].map((a) => a.updatedById), ...company.map((c) => c.connectedById)]);
    const order = (p: string) => MEETING_PROVIDERS.indexOf(p as MeetingProvider);
    const def = company.find((c) => c.isDefault);
    return {
      apps: MEETING_PROVIDERS.map((p) => this.appView(p, apps.get(p) ?? null, names)),
      company: company.sort((a, b) => order(a.provider) - order(b.provider)).map((c) => this.connectionView(c, names)),
      defaultChoice: def ? meetingChoiceKey('company', def.provider as MeetingProvider) : null,
    };
  }

  /** GET /meetings/mine: for each provider, whether its app lets HR connect their own, and their connection. */
  async mine(user: SessionUser): Promise<MyMeetingsView> {
    this.assertScheduler(user);
    return this.mineView(user);
  }

  private async mineView(user: SessionUser): Promise<MyMeetingsView> {
    const [apps, mine] = await Promise.all([this.apps(), this.prisma.meetingConnection.findMany({ where: { userId: user.id } })]);
    const names = await this.names(mine.map((c) => c.connectedById));
    return {
      providers: MEETING_PROVIDERS.map((provider) => {
        const c = mine.find((x) => x.provider === provider);
        return { provider, available: this.appView(provider, apps.get(provider) ?? null, names).personalReady, connection: c ? this.connectionView(c, names) : null };
      }),
    };
  }

  /**
   * GET /meetings/choices: what the scheduler may create meetings with, the company's default first, else their own
   * (meetingChoicesFor). A Super Admin acting as someone gets the company's only.
   */
  async choices(user: SessionUser): Promise<MeetingChoices> {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!managesRecruitment(user)) throw new ForbiddenException(MEETINGS_SCHEDULERS_ONLY);
    const [apps, company, mine] = await Promise.all([
      this.apps(),
      this.prisma.meetingConnection.findMany({ where: { userId: null } }),
      user.viewAs ? Promise.resolve([] as MeetingConnection[]) : this.prisma.meetingConnection.findMany({ where: { userId: user.id } }),
    ]);
    const names = new Map<string, { id: string; name: string }>();
    const view = (p: MeetingProvider) => this.appView(p, apps.get(p) ?? null, names);
    const def = company.find((c) => c.isDefault);
    return meetingChoicesFor({
      company: company.map((c) => ({ provider: c.provider as MeetingProvider, owner: 'company' as const, status: c.status as MeetingConnectionView['status'] })),
      mine: mine.map((c) => ({ provider: c.provider as MeetingProvider, owner: 'personal' as const, status: c.status as MeetingConnectionView['status'] })),
      companyReady: (p) => view(p).companyReady,
      personalReady: (p) => view(p).personalReady,
      defaultChoice: def ? meetingChoiceKey('company', def.provider as MeetingProvider) : null,
      viewingAs: !!user.viewAs,
    });
  }

  // ---------- the apps ----------

  /** PUT /meetings/apps/:provider: a provider's app; an empty secret keeps the saved one. Audited, the values as "changed". */
  async saveApp(providerParam: string, dto: MeetingAppDto, user: SessionUser): Promise<MeetingSettingsView> {
    this.assertSuperAdmin(user);
    const provider = this.provider(providerParam);
    const tidy = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const input = {
      clientId: tidy(dto.clientId),
      clientSecret: dto.clientSecret ? dto.clientSecret : null,
      tenantId: tidy(dto.tenantId),
      accountId: tidy(dto.accountId),
      userClientId: tidy(dto.userClientId),
      userClientSecret: dto.userClientSecret ? dto.userClientSecret : null,
    };
    const problems = meetingAppProblems(provider, input);
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.prisma.meetingApp.findUnique({ where: { provider } });
    const next = {
      clientId: input.clientId,
      tenantId: provider === 'microsoft' ? input.tenantId : null,
      accountId: provider === 'zoom' ? input.accountId : null,
      userClientId: provider === 'zoom' ? input.userClientId : null,
    };
    // every credential only as "changed" (the brief: "credentials changed (as 'changed')"): never a value
    const diff: Record<string, string> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) if ((before?.[k] ?? null) !== next[k]) diff[k] = 'changed';
    const sealed: Record<string, string> = {};
    if (input.clientSecret && input.clientSecret !== this.tokens.open(before?.clientSecretEnc, before?.clientSecretKeyId, 'client_secret')) {
      const s = this.tokens.seal(input.clientSecret, 'client_secret');
      Object.assign(sealed, { clientSecretEnc: s.enc, clientSecretKeyId: s.keyId });
      diff.clientSecret = 'changed';
    }
    if (provider === 'zoom' && input.userClientSecret && input.userClientSecret !== this.tokens.open(before?.userClientSecretEnc, before?.userClientSecretKeyId, 'user_client_secret')) {
      const s = this.tokens.seal(input.userClientSecret, 'user_client_secret');
      Object.assign(sealed, { userClientSecretEnc: s.enc, userClientSecretKeyId: s.keyId });
      diff.userClientSecret = 'changed';
    }
    if (!Object.keys(diff).length) return this.settingsView();
    const data = { ...next, ...sealed, updatedById: user.id, updatedAt: new Date() };
    await this.prisma.meetingApp.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    this.tokens.forgetApp(provider);
    await this.audit.record({ userId: user.id, action: 'update', entityType: MEETING_SETTINGS_ENTITY, entityId: null, diff: { provider, ...diff } });
    return this.settingsView();
  }

  // ---------- the company's connection ----------

  /**
   * POST /meetings/company/:provider/host: the company's Microsoft or Zoom host (the mailbox or user meetings are made in),
   * checked with the app's own token (and, for Microsoft, its calendar); saved as the company's connection.
   */
  async setHost(providerParam: string, hostEmail: string, user: SessionUser): Promise<MeetingSettingsView> {
    this.assertSuperAdmin(user);
    const provider = this.provider(providerParam);
    if (companyConnectsBy(provider) !== 'host') throw new BadRequestException(['The company’s Google account is connected by signing in to it: use Connect a Google account.']);
    const host = normalEmail(hostEmail ?? '');
    if (!isEmail(host)) throw new BadRequestException([`Write the host’s ${provider === 'microsoft' ? 'mailbox' : 'Zoom user'} in full, e.g. hr@trendlix.com.`]);
    try {
      const token = await this.tokens.appToken(provider as 'microsoft' | 'zoom');
      if (provider === 'microsoft') {
        const answer = await this.http.send(microsoftCalendarRequest(token, host));
        if (!doneAnswer(answer)) throw problemOf(provider, answer, 'host');
        if (teamsNotAllowed(answer)) throw new MeetingProviderError('app', 'Microsoft says Teams meetings aren’t allowed on that mailbox’s calendar: give it a Teams licence, or choose another.');
      }
    } catch (err) {
      if (err instanceof MeetingProviderError) throw new BadRequestException([err.message]);
      throw err;
    }
    const before = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: null } });
    const data = { accountEmail: host, status: 'connected', problem: null, connectedById: user.id, connectedAt: new Date(), refreshTokenEnc: null, tokenKeyId: null };
    const saved = before
      ? await this.prisma.meetingConnection.update({ where: { id: before.id }, data })
      : await this.prisma.meetingConnection.create({ data: { provider, userId: null, ...data } });
    await this.audit.record({
      userId: user.id,
      action: 'connect',
      entityType: MEETING_CONNECTION_ENTITY,
      entityId: saved.id,
      diff: { provider, owner: 'company', hostEmail: before && before.accountEmail !== host ? { from: before.accountEmail, to: host } : host },
    });
    return this.settingsView();
  }

  /** POST /meetings/company/:provider/disconnect: the company's connection removed (Google's sign-in revoked too). */
  async disconnectCompany(providerParam: string, user: SessionUser): Promise<MeetingSettingsView> {
    this.assertSuperAdmin(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: null } });
    if (c) await this.disconnect(c, user);
    return this.settingsView();
  }

  /** PUT /meetings/default: the company connection new online interviews start with, or none. */
  async setDefault(choice: string | null, user: SessionUser): Promise<MeetingSettingsView> {
    this.assertSuperAdmin(user);
    const parsed = choice ? parseMeetingChoice(choice) : null;
    if (choice && (!parsed || parsed.owner !== 'company')) throw new BadRequestException(['Choose one of the company’s connections, or none.']);
    const target = parsed ? await this.prisma.meetingConnection.findFirst({ where: { provider: parsed.provider, userId: null } }) : null;
    if (parsed && !target) throw new BadRequestException([`The company’s ${MEETING_PROVIDER_LABELS[parsed.provider]} isn’t connected yet: connect it first.`]);
    const before = await this.prisma.meetingConnection.findFirst({ where: { isDefault: true } });
    if ((before?.id ?? null) === (target?.id ?? null)) return this.settingsView();
    await this.prisma.$transaction([
      this.prisma.meetingConnection.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      ...(target ? [this.prisma.meetingConnection.update({ where: { id: target.id }, data: { isDefault: true } })] : []),
    ]);
    await this.audit.record({
      userId: user.id,
      action: 'set_default',
      entityType: MEETING_SETTINGS_ENTITY,
      entityId: null,
      diff: { default: { from: before ? meetingChoiceKey('company', before.provider as MeetingProvider) : null, to: parsed ? meetingChoiceKey('company', parsed.provider) : null } },
    });
    return this.settingsView();
  }

  /** POST /meetings/company/:provider/test: a test meeting made with the company's connection and deleted. */
  async testCompany(providerParam: string, user: SessionUser): Promise<MeetingTestView> {
    this.assertSuperAdmin(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: null } });
    if (!c) throw new BadRequestException([`The company’s ${MEETING_PROVIDER_LABELS[provider]} isn’t connected yet: connect it first.`]);
    return this.test(c, user);
  }

  // ---------- one's own ----------

  /** POST /meetings/mine/:provider/disconnect. */
  async disconnectMine(providerParam: string, user: SessionUser): Promise<MyMeetingsView> {
    this.assertScheduler(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: user.id } });
    if (c) await this.disconnect(c, user);
    return this.mineView(user);
  }

  /** POST /meetings/mine/:provider/test. */
  async testMine(providerParam: string, user: SessionUser): Promise<MeetingTestView> {
    this.assertScheduler(user);
    const provider = this.provider(providerParam);
    const c = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: user.id } });
    if (!c) throw new BadRequestException([`Your ${MEETING_PROVIDER_LABELS[provider]} isn’t connected: connect it first.`]);
    return this.test(c, user);
  }

  /** A connection removed: its sign-in revoked at the provider when it has one (best effort), its tokens forgotten. */
  private async disconnect(c: MeetingConnection, user: SessionUser): Promise<void> {
    const provider = c.provider as MeetingProvider;
    await this.revoke(provider, ownerOf(c), this.tokens.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token'));
    await this.prisma.meetingConnection.delete({ where: { id: c.id } });
    this.tokens.forgetConnection(c.id);
    await this.audit.record({ userId: user.id, action: 'disconnect', entityType: MEETING_CONNECTION_ENTITY, entityId: c.id, diff: { provider, owner: ownerOf(c), accountEmail: c.accountEmail } });
  }

  /**
   * "Create a test meeting": one made tomorrow at noon (Cairo) for 15 minutes and deleted at once, said in plain words;
   * kept on the connection as its last test, and audited.
   */
  private async test(c: MeetingConnection, user: SessionUser): Promise<MeetingTestView> {
    const provider = c.provider as MeetingProvider;
    const label = MEETING_PROVIDER_LABELS[provider];
    const details: MeetingDetails = {
      title: 'People System test meeting',
      description: 'A test from People System’s meeting settings: it is deleted at once.',
      start: new Date(zonedMoment(addDays(todayInCairo(), 1), '12:00')),
      minutes: 15,
      requestId: randomUUID(),
    };
    let ok = false;
    let message: string;
    const made = await this.make(c, details);
    if (!made.ok) {
      message = made.problem;
    } else {
      const removed = await this.remove({ provider, connectionId: c.id, meetingId: made.value.meetingId, host: made.value.host });
      ok = removed.ok;
      message = removed.ok
        ? `A test meeting was created and deleted: ${label} works, hosted by ${c.accountEmail}.`
        : `A test meeting was created, but couldn’t be deleted: ${removed.problem} Delete “People System test meeting” yourself.`;
    }
    const at = new Date();
    await this.prisma.meetingConnection.updateMany({ where: { id: c.id }, data: { lastTestAt: at, lastTestOk: ok, lastTestMessage: message } });
    await this.audit.record({
      userId: user.id,
      action: 'test_meeting',
      entityType: MEETING_CONNECTION_ENTITY,
      entityId: c.id,
      diff: { provider, owner: ownerOf(c), ok, ...(!ok && { reason: message }) },
    });
    return { at: at.toISOString(), ok, message };
  }

  // ---------- signing in ----------

  /**
   * POST /meetings/oauth/start: the provider's sign-in page for the company's Google account (a Super Admin) or one's own
   * (HR, a Super Admin, or a Super Admin acting as them), returning to the website's /meetings/oauth/<provider>
   * (`origin`: the website's own address). `sessionId`: the session it is started in, which alone may finish it.
   */
  async start(dto: { provider: string; owner: string; origin: string }, user: SessionUser, sessionId: string): Promise<MeetingConnectStart> {
    const provider = this.provider(dto.provider);
    const owner: MeetingOwner = dto.owner === 'company' ? 'company' : 'personal';
    if (owner === 'company') this.assertSuperAdmin(user);
    else this.assertScheduler(user);
    if (owner === 'company' && companyConnectsBy(provider) !== 'oauth') throw new BadRequestException([`The company’s ${MEETING_COMPANY_NAMES[provider]} hosts by the app: name the host on Organization → Meetings.`]);
    const origin = (dto.origin ?? '').trim().replace(/\/+$/, '');
    if (!ORIGIN.test(origin) || (origin.startsWith('http:') && !LOCAL.test(origin))) throw new BadRequestException(['The website’s address could not be read. Reload the page and try again.']);
    const app = await this.tokens.app(provider);
    const creds = this.tokens.credentials(app, owner);
    if (!creds) throw new BadRequestException([this.tokens.noApp(provider).message]);
    const redirectUri = meetingRedirectUri(origin, provider);
    const { verifier, challenge } = pkcePair();
    const state: SignInState & { n: string } = {
      p: provider,
      o: owner,
      u: user.id,
      r: redirectUri,
      v: verifier,
      e: Date.now() + MEETING_CONNECT_MINUTES * 60_000,
      s: sessionId,
      b: user.viewAs?.by.id ?? null,
      n: randomBytes(8).toString('base64url'),
    };
    return { url: authorizeUrl(provider, { clientId: creds.clientId, tenantId: creds.tenantId }, { redirectUri, state: this.tokens.sealState(state), challenge }) };
  }

  /**
   * POST /meetings/oauth/finish: the provider's return (the website passes its code, state or error on): checked (the
   * same person, the same session, the same Super Admin acting as them, or none), the code traded for tokens, the account
   * read and, while a Super Admin acts as the person, checked as theirs (accountIsTheirs: else refused and revoked,
   * nothing kept), the connection saved (its refresh token sealed). Always answered with where to return the person and
   * how it went.
   */
  async finish(dto: { provider: string; code?: string | null; state?: string | null; error?: string | null }, user: SessionUser, sessionId: string): Promise<MeetingConnectResult> {
    const provider = this.provider(dto.provider);
    const raw = this.tokens.openState(dto.state);
    const state =
      raw &&
      isMeetingProvider(raw.p) &&
      (raw.o === 'company' || raw.o === 'personal') &&
      typeof raw.u === 'string' &&
      typeof raw.r === 'string' &&
      typeof raw.v === 'string' &&
      typeof raw.e === 'number' &&
      typeof raw.s === 'string' &&
      (raw.b === null || typeof raw.b === 'string')
        ? (raw as unknown as SignInState)
        : null;
    const owner: MeetingOwner = state?.o ?? 'personal';
    const result = (problem: MeetingConnectProblem | null, said: string | null = null, account: string | null = null): MeetingConnectResult => ({
      provider,
      back: MEETING_PAGES[owner],
      ok: !problem,
      problem,
      said,
      ...(account && { account }),
    });
    // `accountEmail`: the account refused, in full in the audit log only (the answer has it masked)
    const failed = async (problem: MeetingConnectProblem, said: string | null = null, accountEmail: string | null = null) => {
      await this.audit.record({ userId: user.id, action: 'connect_failed', entityType: MEETING_CONNECTION_ENTITY, entityId: null, diff: { provider, owner, problem, ...(said && { said }), ...(accountEmail && { accountEmail }) } });
      return result(problem, said, maskedEmail(accountEmail));
    };
    if (!state || state.p !== provider || state.e < Date.now()) return result('expired');
    if (state.u !== user.id || state.b !== (user.viewAs?.by.id ?? null)) return result('other_user');
    if (state.s !== sessionId) return result('expired');
    const acting = !!user.viewAs?.act;
    if (user.developer || (user.viewAs && !acting) || (owner === 'company' ? !!user.viewAs || !isSuperAdmin(user) : !managesRecruitment(user))) return result('not_allowed');
    const error = typeof dto.error === 'string' && dto.error ? dto.error.slice(0, 60) : null;
    if (error) return failed(error === 'access_denied' ? 'denied' : 'refused', /^[a-z0-9_.-]+$/i.test(error) ? error : null);
    if (!dto.code) return failed('refused', 'no_code');
    const creds = this.tokens.credentials(await this.tokens.app(provider), owner);
    if (!creds) return failed('no_app');

    let grant: TokenGrant;
    try {
      grant = tokenGrantOf(provider, await this.http.send(codeTokenRequest(provider, creds, { code: dto.code, redirectUri: state.r, verifier: state.v })));
    } catch (err) {
      if (!(err instanceof MeetingProviderError)) throw err;
      return failed(err.kind === 'unreachable' || err.kind === 'busy' ? 'unreachable' : 'refused', err.code);
    }
    if (!grant.refreshToken) return failed('refused', 'no_refresh_token');
    if (provider === 'google' && !grantsGoogleCalendar(grant.scope)) return failed('denied', 'calendar_not_allowed');
    const email = provider === 'zoom' ? zoomEmailOf(await this.http.send(zoomMeRequest(grant.accessToken))) : emailOfIdToken(grant.idToken);
    if (!email) return failed('no_account');
    // a Super Admin acting as the person: the account must be one of theirs (25 October 2026), else nothing is kept
    if (acting && owner === 'personal' && !accountIsTheirs(email, await this.emailsOf(user))) {
      await this.revoke(provider, owner, grant.refreshToken);
      return failed('other_account', null, email);
    }

    const sealed = this.tokens.seal(grant.refreshToken, 'refresh_token');
    const userId = owner === 'company' ? null : user.id;
    const before = await this.prisma.meetingConnection.findFirst({ where: { provider, userId } });
    // busy times shared with "Find a time" (owner, 25 October 2026: "Hours + calendar"): a person's own Microsoft always
    // (its calendar permission reads them), their Google once the free/busy scope was allowed
    const busyTimes = owner === 'personal' && (provider === 'microsoft' || (provider === 'google' && grantsScope(grant.scope, GOOGLE_FREEBUSY_SCOPE)));
    const data = { accountEmail: email, refreshTokenEnc: sealed.enc, tokenKeyId: sealed.keyId, status: 'connected', problem: null, connectedById: user.id, connectedAt: new Date(), busyTimes };
    const saved = before
      ? await this.prisma.meetingConnection.update({ where: { id: before.id }, data })
      : await this.prisma.meetingConnection.create({ data: { provider, userId, ...data } });
    this.tokens.keep(saved.id, grant);
    await this.audit.record({
      userId: user.id,
      action: 'connect',
      entityType: MEETING_CONNECTION_ENTITY,
      entityId: saved.id,
      diff: { provider, owner, accountEmail: before && before.accountEmail !== email ? { from: before.accountEmail, to: email } : email },
    });
    return result(null);
  }

  // ---------- meetings, for interviews ----------

  /**
   * The connection a choice names for the scheduler, able to make a meeting now; a 400 in words otherwise (a choice not
   * connected, its app not set up, or needing connecting again). A Super Admin acting as someone: the company's only.
   */
  async connectionFor(choice: string, user: SessionUser): Promise<MeetingConnection> {
    const parsed = parseMeetingChoice(choice);
    if (!parsed) throw new BadRequestException(['Choose what creates the meeting, or paste its link.']);
    const { owner, provider } = parsed;
    const label = MEETING_PROVIDER_LABELS[provider];
    if (owner === 'personal' && user.viewAs) throw new BadRequestException(['While viewing as someone, only the company’s connections create meetings.']);
    const c = await this.prisma.meetingConnection.findFirst({ where: { provider, userId: owner === 'company' ? null : user.id } });
    if (!c) throw new BadRequestException([owner === 'company' ? `The company’s ${label} isn’t connected: choose another, or paste a link.` : `Your ${label} isn’t connected: connect it on Your Meetings, or choose another.`]);
    if (c.status !== 'connected') throw new BadRequestException([`${owner === 'company' ? `The company’s ${label}` : `Your ${label}`} needs connecting again: ${c.problem ?? 'connect it again'} Choose another, or paste a link.`]);
    const app = await this.tokens.app(provider);
    if (!this.tokens.credentials(app, owner)) throw new BadRequestException([`${this.tokens.noApp(provider).message} Choose another, or paste a link.`]);
    return c;
  }

  /** A request with the connection's token; a refused token (401) refreshed and tried once more. */
  private async call(c: MeetingConnection, build: (token: string) => HttpRequest): Promise<HttpAnswer | null> {
    let answer = await this.http.send(build(await this.tokens.tokenFor(c)));
    if (answer?.status === 401) answer = await this.http.send(build(await this.tokens.tokenFor(c, { fresh: true })));
    return answer;
  }

  /** A 401 after a fresh token: the sign-in is gone (a person's, or Google's company account), or the app's credentials. */
  private async refusedTwice(c: MeetingConnection, err: MeetingProviderError): Promise<MeetingProviderError> {
    if (err.kind !== 'token') return err;
    if (hostsByApp(c)) return new MeetingProviderError('app', `${MEETING_COMPANY_NAMES[c.provider as MeetingProvider]} refused the app’s token: a Super Admin checks the app on Organization → Meetings.`, err.code);
    const reconnect = new MeetingProviderError('reconnect', `${MEETING_COMPANY_NAMES[c.provider as MeetingProvider]} refused the connection’s sign-in: connect the account again.`, err.code);
    await this.tokens.needsReconnecting(c, reconnect.message);
    return reconnect;
  }

  private target(c: MeetingConnection): MeetingTarget {
    return { provider: c.provider as MeetingProvider, host: hostsByApp(c) ? c.accountEmail : null };
  }

  /**
   * A meeting made with the connection: its id and join link, or why not in plain words. When the provider is still making
   * the link (Google's conference pending, Microsoft's Teams link not there yet), it is read again a few times; still
   * none, the meeting is deleted and the problem said.
   */
  async make(c: MeetingConnection, details: MeetingDetails): Promise<MeetingResult<MadeMeeting>> {
    const provider = c.provider as MeetingProvider;
    const target = this.target(c);
    try {
      const answer = await this.call(c, (token) => createRequest(target, token, details));
      if (answer?.status === 401) throw await this.refusedTwice(c, problemOf(provider, answer, 'create'));
      let made = madeOf(provider, answer);
      for (let i = 0; !made.joinUrl && i < LINK_TRIES; i++) {
        await sleep(LINK_WAIT_MS);
        made = { meetingId: made.meetingId, joinUrl: madeOf(provider, await this.call(c, (token) => getRequest(target, token, made.meetingId)), 'read').joinUrl };
      }
      if (!made.joinUrl) {
        await this.http.send(deleteRequest(target, await this.tokens.tokenFor(c), made.meetingId));
        return { ok: false, problem: `${MEETING_COMPANY_NAMES[provider]} made the meeting but gave no link to join it. Try again in a moment.` };
      }
      await this.prisma.meetingConnection.updateMany({ where: { id: c.id }, data: { lastUsedAt: new Date() } });
      return { ok: true, value: { provider, owner: ownerOf(c), connectionId: c.id, meetingId: made.meetingId, host: hostKept(target), joinUrl: made.joinUrl } };
    } catch (err) {
      if (err instanceof MeetingProviderError) {
        this.logger.warn(`A ${provider} meeting couldn't be made: ${err.code ?? err.kind}.`);
        return { ok: false, problem: err.message };
      }
      throw err;
    }
  }

  /** The connection a made meeting is moved or deleted with: its own, if it is still there. */
  private async connectionOf(ref: MeetingRef): Promise<MeetingConnection | null> {
    return ref.connectionId ? this.prisma.meetingConnection.findUnique({ where: { id: ref.connectionId } }) : null;
  }

  private removedConnection(ref: MeetingRef): string {
    return `The ${MEETING_PROVIDER_LABELS[ref.provider]} connection it was made with was removed, so ${MEETING_COMPANY_NAMES[ref.provider]} wasn’t told: change it there yourself.`;
  }

  /** A made meeting moved to the interview's new time, length and title. "Gone" (deleted there) counts as done. */
  async move(ref: MeetingRef, details: MeetingDetails): Promise<MeetingResult<'updated' | 'gone'>> {
    const c = await this.connectionOf(ref);
    if (!c) return { ok: false, problem: this.removedConnection(ref) };
    const target = targetOf(ref.provider, ref.host);
    try {
      const answer = await this.call(c, (token) => updateRequest(target, token, ref.meetingId, details));
      if (goneAnswer(answer)) return { ok: true, value: 'gone' };
      if (!doneAnswer(answer)) throw await this.refusedTwice(c, problemOf(ref.provider, answer, 'update'));
      return { ok: true, value: 'updated' };
    } catch (err) {
      if (err instanceof MeetingProviderError) {
        this.logger.warn(`A ${ref.provider} meeting couldn't be moved: ${err.code ?? err.kind}.`);
        return { ok: false, problem: err.message };
      }
      throw err;
    }
  }

  /** A made meeting deleted. Gone already counts as done. */
  async remove(ref: MeetingRef): Promise<MeetingResult<'deleted'>> {
    const c = await this.connectionOf(ref);
    if (!c) return { ok: false, problem: this.removedConnection(ref) };
    const target = targetOf(ref.provider, ref.host);
    try {
      const answer = await this.call(c, (token) => deleteRequest(target, token, ref.meetingId));
      if (goneAnswer(answer) || doneAnswer(answer)) return { ok: true, value: 'deleted' };
      throw await this.refusedTwice(c, problemOf(ref.provider, answer, 'delete'));
    } catch (err) {
      if (err instanceof MeetingProviderError) {
        this.logger.warn(`A ${ref.provider} meeting couldn't be deleted: ${err.code ?? err.kind}.`);
        return { ok: false, problem: err.message };
      }
      throw err;
    }
  }
}
