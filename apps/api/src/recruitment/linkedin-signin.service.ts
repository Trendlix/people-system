import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEVELOPER_NO_FILES,
  isCareersBase,
  isEmail,
  LINKEDIN_AUTHORIZE_URL,
  LINKEDIN_ISSUERS,
  LINKEDIN_LIMITS,
  LINKEDIN_SCOPES,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_USERINFO_URL,
  linkedinFormOf,
  linkedinRedirectUri,
  linkedinSettingsProblems,
  normalEmail,
  type EmailConfirmedBy,
  type LinkedInDetails,
  type LinkedInFinish,
  type LinkedInProblem,
  type LinkedInSettingsView,
  type LinkedInStart,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { careersSiteIn } from './careers-site.js';
import { HourlyWindow } from './hourly-window.js';
import { LinkedInHttp } from './linkedin-http.js';
import { linkedinKeyIdOf, linkedinKeyOf, openLinkedIn, openLinkedInJson, randomToken, sameLinkedInKey, sameText, sealLinkedIn } from './linkedin-secret.js';
import { userRef } from './recruitment-views.js';

// "Fill in with LinkedIn" on the careers forms (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; told LinkedIn's sign-in shares a name, an email and a photo only, they chose "Sign in with
// LinkedIn (name and email)"; packages/shared linkedin-signin.ts). LinkedIn's OpenID Connect, scopes openid profile email:
// - the setup, a Super Admin's (Recruitment Settings, "LinkedIn Sign-in"): the app's client ID, its secret sealed
//   (linkedin-secret.ts, never returned: only "set"), on or off; each save audited (the secret only as "changed");
// - start: LinkedIn's sign-in address, with a state sealed for ten minutes (the form, its ?src=, the redirect URL, a
//   nonce and the browser's half, which the website keeps in an httpOnly cookie) — the return must bring both halves;
// - finish: the state checked (sealed by this server, in time, the same browser), LinkedIn's code traded for tokens on
//   this server, the ID token's nonce, audience and issuer checked, /v2/userinfo read; the name and the email (and
//   whether LinkedIn verified it) sealed for two hours as the result, which the website keeps in an httpOnly cookie read
//   once, then in the form's hidden field;
// - an application or a general CV sent with that result, its email the one LinkedIn verified, is marked
//   email_confirmed_by = 'linkedin'. No account is made, nothing else is kept (never the photo), and no token is ever
//   in an address, a response to the browser or a log.
// Cancelled, refused, off or late: the person goes back to the form with a plain note (LINKEDIN_PROBLEM_TEXT).

export const LINKEDIN_SETTINGS_ENTITY = 'linkedin_settings';

const USER = { select: { id: true, email: true } } as const;
const SRC = /^[a-z_]{1,40}$/;
const EXPIRED = 'The details from LinkedIn expired: sign in with LinkedIn again, or fill in the form yourself.';

/** The sign-in's state, sealed: the form's key, its ?src=, the redirect URL, the nonce, the browser's half, its end (ms). */
interface SignInState {
  f: string;
  s: string | null;
  r: string;
  n: string;
  b: string;
  e: number;
}

/** What LinkedIn gave, sealed: the form's key, the name, the email, whether LinkedIn verified it, its end (ms). */
interface SignInResult {
  f: string;
  n: string | null;
  m: string | null;
  v: boolean;
  e: number;
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** An ID token's claims, read without its signature (it came straight from LinkedIn's token address, over TLS). */
function claimsOf(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class LinkedInSignInService {
  private readonly logger = new Logger('LinkedInSignIn');
  private readonly key: Buffer;
  /** Starts and returns from one address an hour (and in all): a cap on a flood. */
  private readonly window = new HourlyWindow(LINKEDIN_LIMITS.perHour, 3000);

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly http: LinkedInHttp,
  ) {
    this.key = linkedinKeyOf(config.getOrThrow<string>('JWT_SECRET'));
  }

  // ---------- the settings (a Super Admin's) ----------

  /** A Super Admin in their own session; anyone else refused, a developer too. */
  private assertOwner(user: SessionUser, changing: boolean): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException('Only a Super Admin sets up LinkedIn sign-in.');
    if (changing && user.viewAs) throw new ForbiddenException('While viewing as someone, LinkedIn sign-in can’t be changed.');
  }

  /** GET /recruitment/settings/linkedin: never the secret, only whether one is set (and opens with this server's key). */
  async settings(user: SessionUser): Promise<LinkedInSettingsView> {
    this.assertOwner(user, false);
    return this.view();
  }

  private async view(): Promise<LinkedInSettingsView> {
    const row = await this.prisma.linkedInSettings.findUnique({ where: { id: 1 }, include: { updatedBy: USER } });
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    const secretSet = !!row?.clientSecretEnc;
    const readable = secretSet && sameLinkedInKey(row?.secretKeyId, this.key);
    return {
      enabled: row?.enabled ?? false,
      clientId: row?.clientId ?? null,
      secretSet,
      secretUnreadable: secretSet && !readable,
      ready: !!row?.enabled && !!row.clientId && readable,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: userRef(row?.updatedBy ?? null, names),
    };
  }

  /**
   * PUT /recruitment/settings/linkedin: a field left out stays; an empty secret keeps the one set (a new one replaces it,
   * sealed). Audited: on or off, the client ID, and the secret only as "changed".
   */
  async saveSettings(dto: { enabled?: boolean; clientId?: string | null; clientSecret?: string | null }, user: SessionUser): Promise<LinkedInSettingsView> {
    this.assertOwner(user, true);
    const before = await this.prisma.linkedInSettings.findUnique({ where: { id: 1 } });
    const secret = typeof dto.clientSecret === 'string' ? dto.clientSecret.trim() : '';
    if (secret.length > LINKEDIN_LIMITS.clientSecret || /\s/.test(secret)) throw new BadRequestException(['Paste the client secret as LinkedIn shows it.']);
    const next = {
      enabled: dto.enabled ?? before?.enabled ?? false,
      clientId: dto.clientId === undefined ? (before?.clientId ?? null) : dto.clientId?.trim() || null,
    };
    const secretReadable = !!before?.clientSecretEnc && sameLinkedInKey(before.secretKeyId, this.key);
    const problems = linkedinSettingsProblems({ ...next, secretSet: !!secret || secretReadable });
    if (problems.length) throw new BadRequestException(problems);
    const sealed = secret ? { clientSecretEnc: sealLinkedIn(secret, this.key, 'client_secret'), secretKeyId: linkedinKeyIdOf(this.key) } : {};
    const diff = changes({ enabled: before?.enabled ?? false, clientId: before?.clientId ?? null }, next);
    if (!Object.keys(diff).length && !secret) return this.view();
    await this.prisma.linkedInSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...next, ...sealed, updatedById: user.id },
      update: { ...next, ...sealed, updatedById: user.id, updatedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'update', entityType: LINKEDIN_SETTINGS_ENTITY, entityId: null, diff: { ...diff, ...(secret && { clientSecret: 'changed' }) } });
    return this.view();
  }

  /** The app, when sign-in is on with an ID and a secret that opens; null otherwise. */
  private async app(): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = await this.prisma.linkedInSettings.findUnique({ where: { id: 1 } });
    if (!row?.enabled || !row.clientId || !row.clientSecretEnc || !sameLinkedInKey(row.secretKeyId, this.key)) return null;
    const clientSecret = openLinkedIn(row.clientSecretEnc, this.key, 'client_secret');
    return clientSecret ? { clientId: row.clientId, clientSecret } : null;
  }

  /** Whether the careers forms show "Fill in with LinkedIn". */
  async isOn(): Promise<boolean> {
    const row = await this.prisma.linkedInSettings.findUnique({ where: { id: 1 }, select: { enabled: true, clientId: true, clientSecretEnc: true, secretKeyId: true } });
    return !!row?.enabled && !!row.clientId && !!row.clientSecretEnc && sameLinkedInKey(row.secretKeyId, this.key);
  }

  // ---------- signing in ----------

  /**
   * POST /public/linkedin/start: LinkedIn's sign-in address for a form, returning to the website's callback at the
   * careers site's address (`careersBase` when the website sends one, packages/shared careers-base.ts; else Recruitment
   * Settings' "Careers site address", the redirect URL shown there, 25 October 2026: never the request's `origin` any
   * more), and the browser's half of the state for its cookie.
   */
  async start(dto: { form?: string; src?: string | null; origin?: string; careersBase?: string }, ip: string | null): Promise<LinkedInStart> {
    const form = linkedinFormOf(dto.form);
    const sentBase = dto.careersBase?.trim().replace(/\/+$/, '');
    const careersBase = sentBase ? (isCareersBase(sentBase) ? sentBase : null) : await careersSiteIn(this.prisma);
    if (!form || !careersBase) return { ok: false, problem: 'failed' };
    if (!this.window.allow(ip)) return { ok: false, problem: 'busy' };
    const app = await this.app();
    if (!app) return { ok: false, problem: 'off' };
    const binding = randomToken();
    const state: SignInState = {
      f: dto.form!,
      s: dto.src && SRC.test(dto.src) ? dto.src : null,
      r: linkedinRedirectUri(careersBase),
      n: randomToken(),
      b: binding,
      e: Date.now() + LINKEDIN_LIMITS.stateMinutes * 60_000,
    };
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: state.r,
      state: sealLinkedIn(JSON.stringify(state), this.key, 'oauth_state'),
      scope: LINKEDIN_SCOPES,
      nonce: state.n,
    });
    return { ok: true, url: `${LINKEDIN_AUTHORIZE_URL}?${query.toString()}`, binding };
  }

  /**
   * POST /public/linkedin/finish: LinkedIn's return (the website passes its code, state or error on, with the browser's
   * half of the state from its cookie). A state that doesn't open, is late, or isn't this browser's is refused, and
   * LinkedIn is never called for it. Always answered with the form to go back to and how it went.
   */
  async finish(dto: { state?: string | null; binding?: string | null; code?: string | null; error?: string | null }, ip: string | null): Promise<LinkedInFinish> {
    const raw = openLinkedInJson(dto.state, this.key, 'oauth_state');
    const state =
      raw && typeof raw.f === 'string' && linkedinFormOf(raw.f) && typeof raw.r === 'string' && typeof raw.n === 'string' && typeof raw.b === 'string' && typeof raw.e === 'number'
        ? (raw as unknown as SignInState)
        : null;
    if (!state) return { ok: false, form: null, src: null, problem: 'expired' };
    const back = { form: state.f, src: typeof state.s === 'string' ? state.s : null };
    const refused = (problem: LinkedInProblem, reason?: string): LinkedInFinish => ({ ok: false, ...back, problem, ...(reason && { reason }) });
    if (state.e < Date.now() || typeof dto.binding !== 'string' || !sameText(dto.binding, state.b)) return refused('expired');
    if (!this.window.allow(ip)) return refused('busy');
    if (typeof dto.error === 'string' && dto.error) return refused(/^(user_cancelled_login|user_cancelled_authorize|access_denied)$/.test(dto.error) ? 'cancelled' : 'failed');
    const app = await this.app();
    if (!app) return refused('off');
    if (typeof dto.code !== 'string' || !dto.code || dto.code.length > 2000) return refused('failed');

    const token = await this.http.send({
      url: LINKEDIN_TOKEN_URL,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: dto.code, redirect_uri: state.r, client_id: app.clientId, client_secret: app.clientSecret }).toString(),
    });
    const grant = token?.body && typeof token.body === 'object' ? (token.body as Record<string, unknown>) : null;
    const accessToken = token?.status === 200 && grant && typeof grant.access_token === 'string' ? grant.access_token : null;
    if (!accessToken) {
      // the status only: never the answer, which may name the code or the app
      // LinkedIn's error code too ("invalid_client", "invalid_grant" …: a word, never the code or the secret)
      const code = grant && typeof grant.error === 'string' && /^[a-z_]{1,40}$/.test(grant.error) ? `:${grant.error}` : '';
      this.logger.warn(`LinkedIn refused the code (${token ? token.status : 'unreachable'}${code}).`);
      return refused('failed', `token:${token ? token.status : 'unreachable'}${code}`);
    }
    const claims = claimsOf(grant!.id_token);
    const audience = claims ? (Array.isArray(claims.aud) ? claims.aud : [claims.aud]) : [];
    // the ID token comes straight from LinkedIn's token endpoint for this code (the state and the browser's half checked
    // above): its nonce checked when LinkedIn sends one (it may leave it out), its issuer either of those it is seen with
    // (owner, 29 October 2026: "the button is live but not filling anything")
    const bad = !claims
      ? 'missing'
      : claims.nonce !== undefined && claims.nonce !== state.n
        ? 'nonce'
        : !audience.includes(app.clientId)
          ? 'audience'
          : typeof claims.iss !== 'string' || !LINKEDIN_ISSUERS.includes(claims.iss)
            ? 'issuer'
            : typeof claims.exp === 'number' && claims.exp * 1000 < Date.now() - 5 * 60_000
              ? 'expired'
              : null;
    if (bad || !claims) {
      this.logger.warn(`LinkedIn’s ID token didn’t match the sign-in (${bad ?? 'missing'}).`);
      return refused('failed', `id_token:${bad ?? 'missing'}`);
    }
    const info = await this.http.send({ url: LINKEDIN_USERINFO_URL, method: 'GET', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    const person = info?.status === 200 && info.body && typeof info.body === 'object' ? (info.body as Record<string, unknown>) : null;
    if (!person || (typeof claims.sub === 'string' && typeof person.sub === 'string' && claims.sub !== person.sub)) {
      this.logger.warn(`LinkedIn’s userinfo couldn’t be read (${info ? info.status : 'unreachable'}).`);
      return refused('failed', `userinfo:${info ? info.status : 'unreachable'}`);
    }
    const fullName = str(person.name, 120) ?? str([str(person.given_name), str(person.family_name)].filter(Boolean).join(' '), 120);
    const email = typeof person.email === 'string' && isEmail(normalEmail(person.email)) ? normalEmail(person.email) : null;
    if (!fullName && !email) return refused('failed', 'no_details');
    const result: SignInResult = { f: state.f, n: fullName, m: email, v: !!email && (person.email_verified === true || person.email_verified === 'true'), e: Date.now() + LINKEDIN_LIMITS.resultMinutes * 60_000 };
    return { ok: true, ...back, ticket: sealLinkedIn(JSON.stringify(result), this.key, 'result') };
  }

  /** What LinkedIn gave, opened for its form (null: it doesn't open, is late, or is another form's). */
  private result(ticket: unknown, form: string): SignInResult | null {
    const r = typeof ticket === 'string' ? openLinkedInJson(ticket, this.key, 'result') : null;
    if (!r || r.f !== form || typeof r.e !== 'number' || r.e < Date.now()) return null;
    return { f: form, n: str(r.n, 120), m: typeof r.m === 'string' ? r.m : null, v: r.v === true, e: r.e };
  }

  /** POST /public/linkedin/open: what the form fills in from the website's cookie (400 when it expired or is another form's). */
  open(dto: { ticket?: string; form?: string }): LinkedInDetails {
    const r = this.result(dto.ticket, dto.form ?? '');
    if (!r) throw new BadRequestException([EXPIRED]);
    return { fullName: r.n, email: r.m, emailConfirmed: r.v, ticket: dto.ticket! };
  }

  /** The email's mark for an application or a general CV: 'linkedin' when LinkedIn verified this very email for this form. */
  confirmedBy(ticket: unknown, form: string, email: string): EmailConfirmedBy | null {
    const r = this.result(ticket, form);
    return r?.v && r.m && r.m === normalEmail(email) ? 'linkedin' : null;
  }
}
