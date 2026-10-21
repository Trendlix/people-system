// The Claude connector's OAuth endpoints on the website (owner, 21 October 2026: "the connection method"): registration
// (RFC 7591, JSON), the token endpoint (RFC 6749 §3.2, form-encoded as Claude sends it; JSON too) and revocation (RFC
// 7009). The website only reads the request and passes it to the API, which keeps the clients, codes and tokens (only
// their hashes) and decides everything; its answer is passed back as it is, never kept in a cache. Pure code (no "@/"
// imports): the route handlers give it the call to the API. Tested.

/** A POST to the API (`path` under /api), as the route handlers make it: the API's address and certificate are theirs. */
export type ApiCall = (path: string, init: RequestInit) => Promise<Response>;

/** The longest body read (a registration or a token request is a few hundred bytes). */
export const OAUTH_BODY_MAX = 64 * 1024;

const NO_STORE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache' };

export function oauthError(status: number, error: string, description: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, error_description: description }), { status, headers: { ...NO_STORE, ...headers } });
}

async function bodyText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > OAUTH_BODY_MAX) return null;
  const text = await request.text();
  return text.length > OAUTH_BODY_MAX ? null : text;
}

const mediaType = (request: Request) => (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

/**
 * The fields of a token or revocation request: a form (application/x-www-form-urlencoded, as RFC 6749 asks and Claude
 * sends), or a JSON object; only text values are kept. Null for a body that is too long or can't be read.
 */
export async function readOAuthFields(request: Request): Promise<Record<string, string> | null> {
  const text = await bodyText(request);
  if (text === null) return null;
  if (mediaType(request) === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) if (!(key in out)) out[key] = value;
  return out;
}

/** A registration's JSON object (RFC 7591 §3.1), or null for anything else. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await bodyText(request);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The client's credentials in an Authorization: Basic header (client_secret_basic), as sent; undefined without one. */
export function basicCredentials(authorization: string | null): string | undefined {
  const m = /^Basic\s+([A-Za-z0-9+/=._~-]{1,512})\s*$/i.exec(authorization ?? '');
  return m ? m[1] : undefined;
}

export const TOKEN_FIELDS = ['grant_type', 'code', 'redirect_uri', 'code_verifier', 'client_id', 'client_secret', 'refresh_token', 'resource', 'scope'] as const;
export const REVOKE_FIELDS = ['token', 'token_type_hint', 'client_id', 'client_secret'] as const;

/** The fields named, those sent. */
export function pick(fields: Record<string, string>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => typeof fields[k] === 'string').map((k) => [k, fields[k]]));
}

/** What the person's browser or Claude's server is, kept with a connection (a hint only). */
export interface Caller {
  ip?: string;
  userAgent?: string;
}

/**
 * Sends `body` to the API and passes its answer back: its status and JSON, never cached. An answer that isn't an OAuth
 * error where one is due becomes one; the API unreachable is 503 temporarily_unavailable. `basicSent`: a 401 then says
 * how to authenticate (RFC 6749 §5.2: WWW-Authenticate when the client used the Authorization header).
 */
export async function forwardToApi(call: ApiCall, path: string, body: object, basicSent = false): Promise<Response> {
  let res: Response;
  try {
    res = await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return oauthError(503, 'temporarily_unavailable', 'Trendlix People can’t be reached right now. Please try again in a moment.');
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const headers: Record<string, string> = basicSent && res.status === 401 ? { 'www-authenticate': 'Basic realm="Trendlix People"' } : {};
  if (res.ok) return new Response(JSON.stringify(json ?? {}), { status: res.status, headers: { ...NO_STORE, ...headers } });
  const oauth = json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string' && !('statusCode' in json);
  if (oauth) return new Response(JSON.stringify(json), { status: res.status, headers: { ...NO_STORE, ...headers } });
  const message = messageOf(json);
  if (res.status >= 500) return oauthError(503, 'temporarily_unavailable', message ?? 'Trendlix People couldn’t answer. Please try again in a moment.', headers);
  if (res.status === 429) return oauthError(429, 'temporarily_unavailable', message ?? 'Too many requests. Please try again later.', headers);
  return oauthError(res.status === 401 ? 401 : 400, res.status === 401 ? 'invalid_client' : 'invalid_request', message ?? `The request was refused (${res.status}).`, headers);
}

function messageOf(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const m = (json as { message?: unknown; error_description?: unknown }).message ?? (json as { error_description?: unknown }).error_description;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(' ') || null;
  return typeof m === 'string' ? m : null;
}

// ---------- the three endpoints ----------

/** POST /oauth/register: the client's metadata as it sent it, with the address it came from. */
export async function registerRequest(request: Request, call: ApiCall, caller: Caller): Promise<Response> {
  const metadata = await readJsonObject(request);
  if (!metadata) return oauthError(400, 'invalid_client_metadata', 'Send the client’s metadata as a JSON object.');
  return forwardToApi(call, '/connector/oauth/register', { ...metadata, ...(caller.ip && { ip: caller.ip }) });
}

/** POST /oauth/token: an authorization code or a refresh token traded for tokens. */
export async function tokenRequest(request: Request, call: ApiCall, caller: Caller): Promise<Response> {
  const fields = await readOAuthFields(request);
  if (!fields) return oauthError(400, 'invalid_request', 'Send the token request as a form (application/x-www-form-urlencoded).');
  const basic = basicCredentials(request.headers.get('authorization'));
  const body = { ...pick(fields, TOKEN_FIELDS), ...(basic && { basic }), ...(caller.ip && { ip: caller.ip }), ...(caller.userAgent && { userAgent: caller.userAgent.slice(0, 300) }) };
  return forwardToApi(call, '/connector/oauth/token', body, !!basic);
}

/** POST /oauth/revoke: a token signed out (its connection ends). Always 200 for a token that isn't known (RFC 7009 §2.2). */
export async function revokeRequest(request: Request, call: ApiCall): Promise<Response> {
  const fields = await readOAuthFields(request);
  if (!fields) return oauthError(400, 'invalid_request', 'Send the revocation request as a form (application/x-www-form-urlencoded).');
  const basic = basicCredentials(request.headers.get('authorization'));
  return forwardToApi(call, '/connector/oauth/revoke', { ...pick(fields, REVOKE_FIELDS), ...(basic && { basic }) }, !!basic);
}
