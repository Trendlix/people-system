// The Claude connector's OAuth rules (owner, 21 October 2026: "i might link a claude account for the assets section only
// to fetch data and help in the data entry"; then "the connection method" / "option a"; packages/shared connector.ts).
// Pure code, tested (connector-rules.spec.ts): the OAuth service (connector-oauth.service.ts), the tokens service and
// the guard decide with it. What they follow (read 21 October 2026; links in the README's Connector section): OAuth 2.1
// (draft-ietf-oauth-v2-1-13), PKCE (RFC 7636, S256 only), dynamic client registration (RFC 7591), token revocation (RFC
// 7009), resource indicators (RFC 8707), the MCP authorization spec (2026-07-28) and Anthropic's connector docs (Claude's
// return address https://claude.ai/api/mcp/auth_callback; public clients; refresh tokens rotated; invalid_grant).
//
// Every secret this server gives (a code, an access token, a refresh token, a client secret) is 32 random bytes,
// base64url, behind a prefix saying what it is; the database keeps only its SHA-256, compared in constant time.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  CLAUDE_REDIRECT_URIS,
  CONNECTOR_REFRESH_REUSE_GRACE_MS,
  CONNECTOR_SCOPE,
  CONNECTOR_TOKEN_PREFIXES,
  isClaudeRedirectUri,
  PKCE_CHALLENGE_PATTERN,
  PKCE_VERIFIER_PATTERN,
  type OAuthErrorBody,
} from '@trendlix/shared';

// ---------- secrets ----------

export type SecretKind = keyof typeof CONNECTOR_TOKEN_PREFIXES;

/** A new secret of a kind: its prefix and 32 random bytes, base64url ("tlxa_…", 48 characters). */
export const newSecret = (kind: SecretKind): string => `${CONNECTOR_TOKEN_PREFIXES[kind]}${randomBytes(32).toString('base64url')}`;

/** What the database keeps of a secret: its SHA-256, in hex. */
export const secretHash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const HASH = /^[0-9a-f]{64}$/;

/** Whether `value` is the one whose hash is kept, compared in constant time. */
export function secretMatches(value: string, storedHash: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value || !storedHash || !HASH.test(storedHash)) return false;
  const sent = Buffer.from(secretHash(value), 'hex');
  const kept = Buffer.from(storedHash, 'hex');
  return sent.length === kept.length && timingSafeEqual(sent, kept);
}

/** Whether a value has the shape of a secret of this kind (anything else is unknown without a database read). */
export const looksLike = (kind: SecretKind, value: unknown): value is string =>
  typeof value === 'string' && value.length >= 40 && value.length <= 120 && value.startsWith(CONNECTOR_TOKEN_PREFIXES[kind]) && /^[A-Za-z0-9_-]+$/.test(value);

// ---------- PKCE ----------

/** The S256 challenge of a verifier: BASE64URL(SHA256(ASCII(verifier))) (RFC 7636 §4.2). */
export const s256 = (verifier: string): string => createHash('sha256').update(verifier, 'ascii').digest('base64url');

/** Whether `verifier` is a PKCE verifier (43 to 128 unreserved characters) whose S256 challenge is `challenge`. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER_PATTERN.test(verifier) || !PKCE_CHALLENGE_PATTERN.test(challenge)) return false;
  const sent = Buffer.from(s256(verifier));
  const kept = Buffer.from(challenge);
  return sent.length === kept.length && timingSafeEqual(sent, kept);
}

// ---------- errors ----------

/** An OAuth error and the HTTP status it goes with (RFC 6749 §5.2: 401 for invalid_client, else 400). */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 | 403 | 429 = error === 'invalid_client' ? 401 : 400,
  ) {
    super(description);
  }

  get body(): OAuthErrorBody {
    return { error: this.error, error_description: this.description };
  }
}

// ---------- dynamic client registration (RFC 7591) ----------

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

/** A registration as it is kept: what the client asked for, with what this server doesn't offer refused or replaced. */
export interface ClientRegistration {
  name: string;
  redirectUris: string[];
  authMethod: ClientAuthMethod;
  grantTypes: string[];
  responseTypes: string[];
}

const GRANT_TYPES = ['authorization_code', 'refresh_token'];
const NAME_MAX = 100;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * A registration request read (RFC 7591 §2, §3.1): Claude's return addresses only (`invalid_redirect_uri` otherwise:
 * no other place ever receives a code); the code flow, with refresh tokens; a public client (no secret: PKCE protects
 * the code) unless it asks for client_secret_post or client_secret_basic, when it is given a secret. Omitted, the
 * method is "none" (RFC 7591 says client_secret_basic, but a server may replace a value, and says so in its answer;
 * Anthropic's docs: Claude registers as a public client). Fields it doesn't know are ignored.
 */
export function readRegistration(body: unknown): ClientRegistration {
  if (!isObject(body)) throw new OAuthError('invalid_client_metadata', 'Send the client metadata as a JSON object.');
  const uris = body.redirect_uris;
  if (!strings(uris) || !uris.length) throw new OAuthError('invalid_redirect_uri', 'Send redirect_uris: Claude’s return address.');
  const unknown = uris.filter((u) => !isClaudeRedirectUri(u));
  if (unknown.length) {
    throw new OAuthError('invalid_redirect_uri', `Only Claude’s return addresses are accepted (${CLAUDE_REDIRECT_URIS.join(', ')}), not ${unknown.slice(0, 3).join(', ')}.`);
  }
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') {
    throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.');
  }
  const grants = body.grant_types ?? ['authorization_code'];
  if (!strings(grants) || !grants.length || grants.some((g) => !GRANT_TYPES.includes(g))) {
    throw new OAuthError('invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token.');
  }
  const responses = body.response_types ?? ['code'];
  if (!strings(responses) || responses.length !== 1 || responses[0] !== 'code') throw new OAuthError('invalid_client_metadata', 'response_types must be ["code"].');
  const rawName = typeof body.client_name === 'string' ? body.client_name.replace(/\s+/g, ' ').trim() : '';
  return {
    name: rawName ? rawName.slice(0, NAME_MAX) : 'MCP client',
    redirectUris: [...new Set(uris)],
    authMethod: method,
    grantTypes: [...new Set(grants.includes('authorization_code') ? grants : ['authorization_code', ...grants])],
    responseTypes: ['code'],
  };
}

// ---------- Client ID Metadata Documents ----------

/**
 * A client's metadata document (draft-ietf-oauth-client-id-metadata-document) read: its client_id must be its own
 * address, exactly; only Claude's return addresses are kept from it (none left: refused); a public client only.
 */
export function readClientDocument(url: string, doc: unknown): { name: string; redirectUris: string[] } {
  if (!isObject(doc)) throw new OAuthError('invalid_client', 'The client’s metadata document is not a JSON object.', 401);
  if (doc.client_id !== url) throw new OAuthError('invalid_client', 'The client’s metadata document names another client_id.', 401);
  const method = doc.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new OAuthError('invalid_client', 'Only public clients may identify with a metadata document.', 401);
  const uris = strings(doc.redirect_uris) ? doc.redirect_uris.filter((u) => isClaudeRedirectUri(u)) : [];
  if (!uris.length) throw new OAuthError('invalid_client', 'The client’s metadata document names none of Claude’s return addresses.', 401);
  const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : new URL(url).host;
  return { name, redirectUris: [...new Set(uris)] };
}

// ---------- the token and revocation endpoints ----------

/** A token or revocation request's fields, as the website passes them on (the form's fields as text). */
export interface TokenRequest {
  grant_type: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  resource: string;
  scope: string;
  token: string;
  token_type_hint: string;
  /** The Authorization header's credentials after "Basic ", when the client sent them (client_secret_basic). */
  basic: string;
  ip: string;
  userAgent: string;
}

const TOKEN_FIELDS = [
  'grant_type',
  'code',
  'redirect_uri',
  'code_verifier',
  'client_id',
  'client_secret',
  'refresh_token',
  'resource',
  'scope',
  'token',
  'token_type_hint',
  'basic',
  'ip',
  'userAgent',
] as const;

/** A request's fields as text (a field that isn't text, or is far too long, reads as empty). */
export function readTokenRequest(body: unknown): TokenRequest {
  const b = isObject(body) ? body : {};
  return Object.fromEntries(TOKEN_FIELDS.map((k) => [k, typeof b[k] === 'string' && b[k].length <= 2000 ? b[k].trim() : ''])) as unknown as TokenRequest;
}

/** The client id and secret of an HTTP Basic header's credentials (RFC 6749 §2.3.1: each form-encoded), or null. */
export function readBasic(credentials: string): { clientId: string; secret: string } | null {
  if (!credentials) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(credentials, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon < 1) return null;
  try {
    const formDecode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
    return { clientId: formDecode(decoded.slice(0, colon)), secret: formDecode(decoded.slice(colon + 1)) };
  } catch {
    return null;
  }
}

/**
 * Who the client says it is at the token or revocation endpoint: the Basic header's id (then the body's must match),
 * else the body's client_id; the secret from the header or the body. Throws invalid_request for two different ids.
 */
export function clientCredentials(req: Pick<TokenRequest, 'basic' | 'client_id' | 'client_secret'>): { clientId: string; secret: string; basic: boolean } {
  const basic = readBasic(req.basic);
  if (basic && req.client_id && basic.clientId !== req.client_id) throw new OAuthError('invalid_request', 'The client_id doesn’t match the Authorization header.');
  if (basic) return { clientId: basic.clientId, secret: basic.secret, basic: true };
  return { clientId: req.client_id, secret: req.client_secret, basic: false };
}

/**
 * Whether a client has authenticated as its registration says: a public client by its id alone; one with a secret only
 * with that secret, the way it registered (a client_secret_basic one may also send it in the body, as many do).
 */
export function clientAuthenticated(client: { authMethod: string; secretHash: string | null }, credentials: { secret: string; basic: boolean }): boolean {
  if (client.authMethod === 'none') return true;
  if (client.authMethod === 'client_secret_post' && credentials.basic) return false;
  return secretMatches(credentials.secret, client.secretHash);
}

/** The scope a token is given: always Assets alone, whatever was asked (RFC 6749 §3.3: the answer says it). */
export const grantedScope = (): string => CONNECTOR_SCOPE;

// ---------- a code, a refresh token, an access token ----------

/** A code as the token endpoint finds it. */
export interface CodeState {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * What the token endpoint does with a code (RFC 6749 §4.1.3, RFC 7636 §4.6, RFC 8707): ok, or refused with
 * invalid_grant (unknown, another client's, expired, already used: `reused`, which ends the session it started), or
 * invalid_target. The return address must be the one it was given for, and the verifier its challenge's.
 */
export function codeVerdict(
  code: CodeState | null,
  req: { clientId: string; redirectUri: string; verifier: string; resource: string },
  now: Date,
): { ok: true } | { ok: false; error: OAuthError; reused?: boolean } {
  const grant = (d: string) => new OAuthError('invalid_grant', d);
  if (!code || code.clientId !== req.clientId) return { ok: false, error: grant('The code is not valid. Connect Claude again.') };
  if (code.usedAt) return { ok: false, error: grant('The code was already used. Connect Claude again.'), reused: true };
  if (code.expiresAt.getTime() <= now.getTime()) return { ok: false, error: grant('The code has expired. Connect Claude again.') };
  if (req.redirectUri !== code.redirectUri) return { ok: false, error: grant('The redirect_uri is not the one the code was given for.') };
  if (!pkceMatches(req.verifier, code.codeChallenge)) return { ok: false, error: grant('The code_verifier doesn’t match the code_challenge.') };
  if (req.resource && req.resource !== code.resource) return { ok: false, error: new OAuthError('invalid_target', `The code was given for ${code.resource}.`) };
  return { ok: true };
}

/** A connector session as the token endpoint and the guard read it. */
export interface ConnectorSessionState {
  kind: string;
  clientId: string | null;
  resource: string | null;
  expiresAt: Date;
  endedAt: Date | null;
  user: { isActive: boolean };
}

/** Whether a connector session is still on: not ended, not past its 90 days, its account active. */
export const sessionOn = (s: ConnectorSessionState, now: Date): boolean =>
  s.kind === 'connector' && !s.endedAt && s.expiresAt.getTime() > now.getTime() && s.user.isActive;

/**
 * What the token endpoint does with a refresh token (OAuth 2.1 §4.3.1: rotated on every use for a public client):
 * `rotate`; refused (invalid_grant) when unknown, another client's, past its time, or its session over; used again
 * (`reused`): within a minute of its rotation only refused (a client's own retry), after that the session ends, as a
 * stolen token's would ('end').
 */
export type RefreshVerdict = { kind: 'rotate' } | { kind: 'refuse'; error: OAuthError; end?: boolean };

export function refreshVerdict(
  token: { kind: string; expiresAt: Date; rotatedAt: Date | null; session: ConnectorSessionState } | null,
  req: { clientId: string; resource: string },
  now: Date,
): RefreshVerdict {
  const grant = (d: string) => new OAuthError('invalid_grant', d);
  if (!token || token.kind !== 'refresh' || token.session.clientId !== req.clientId) return { kind: 'refuse', error: grant('The refresh token is not valid. Connect Claude again.') };
  if (!sessionOn(token.session, now)) return { kind: 'refuse', error: grant('The connection has ended. Connect Claude again.') };
  if (token.rotatedAt) {
    const late = now.getTime() - token.rotatedAt.getTime() > CONNECTOR_REFRESH_REUSE_GRACE_MS;
    return { kind: 'refuse', error: grant('The refresh token was already used. Connect Claude again.'), end: late };
  }
  if (token.expiresAt.getTime() <= now.getTime()) return { kind: 'refuse', error: grant('The refresh token has expired. Connect Claude again.') };
  if (req.resource && req.resource !== token.session.resource) return { kind: 'refuse', error: new OAuthError('invalid_target', `The connection is for ${token.session.resource}.`) };
  return { kind: 'rotate' };
}

/** Why the guard refuses an access token, or null when it is good: unknown, expired, or its session over. */
export function accessRefusal(token: { kind: string; expiresAt: Date; session: ConnectorSessionState } | null, now: Date): string | null {
  if (!token || token.kind !== 'access') return 'The access token is not valid.';
  if (token.expiresAt.getTime() <= now.getTime()) return 'The access token has expired.';
  if (!sessionOn(token.session, now)) return 'The connection has ended. Connect Claude again.';
  return null;
}

/** A resource (RFC 8707) the sign-in may bind tokens to: an absolute https address (http for localhost), no fragment. */
export function isResource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return (url.protocol === 'https:' || (local && url.protocol === 'http:')) && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}
