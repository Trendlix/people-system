// The Claude connector (owner, 21 October 2026: "i might link a claude account for the assets section only to fetch data
// and help in the data entry"; asked how to use Claude without paying extra, they chose "the connection method" /
// "option a"): a custom connector the owner adds to their own Claude account (Claude → Customize → Connectors → Add
// custom connector), so Claude reads the Assets section and drafts assets on the owner's own subscription, with no API
// key and no API billing. It is a remote MCP server on the website (Streamable HTTP at /api/mcp), signed in to with
// OAuth 2.1: the authorization code with PKCE (S256), dynamic client registration (RFC 7591), the protected resource and
// authorization server metadata (RFC 9728, RFC 8414), as the MCP authorization spec (2026-07-28) and Anthropic's
// connector docs say (read 21 October 2026; links in the README's Connector section). Every tool call goes to the API
// with the person's own rights, as the website's pages do; the connector's tokens reach the Assets endpoints only.
// This file holds what both apps use: the addresses, the scope, the lifetimes, Claude's return addresses, the checks of
// a sign-in request, the consent page's words, the tools and the API's answers. Pure code.

import type { AssetsAccess } from './assets.js';

// ---------- the addresses ----------

/** The one scope a connector is given: the Assets section, nothing else. */
export const CONNECTOR_SCOPE = 'assets';

/** The website's addresses, from its origin (https://people.trendlix.com). */
export const CONNECTOR_PATHS = {
  /** The MCP endpoint, the address pasted into Claude. */
  mcp: '/api/mcp',
  /** RFC 9728, at the root; the same document at /.well-known/oauth-protected-resource/api/mcp. */
  protectedResource: '/.well-known/oauth-protected-resource',
  /** RFC 8414: the issuer is the origin itself, so no path is inserted. */
  authorizationServer: '/.well-known/oauth-authorization-server',
  /** The sign-in and consent page (the system's own sign-in first, when needed). */
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  /** Dynamic client registration (RFC 7591). */
  register: '/oauth/register',
  /** Token revocation (RFC 7009). */
  revoke: '/oauth/revoke',
  /** Assets → Connect Claude: the address to copy and the steps in Claude. */
  help: '/assets/connect-claude',
} as const;

const trimmed = (origin: string) => origin.replace(/\/+$/, '');

/**
 * The MCP server's canonical address (RFC 8707's resource, RFC 9728's `resource`): the origin and /api/mcp, without a
 * trailing slash. Claude must send it as `resource`; every token is bound to it.
 */
export const connectorResource = (origin: string): string => `${trimmed(origin)}${CONNECTOR_PATHS.mcp}`;

/** Where the protected resource metadata is for the MCP endpoint (RFC 9728 §3.1: the path appended after the suffix). */
export const connectorResourceMetadataUrl = (origin: string): string => `${trimmed(origin)}${CONNECTOR_PATHS.protectedResource}${CONNECTOR_PATHS.mcp}`;

// ---------- Claude, the only client ----------

/**
 * The return addresses Claude's hosted apps (claude.ai on the web, Desktop, mobile) use, as Anthropic documents them:
 * claude.ai's, and claude.com's, which "may" replace it. Only these: a registration naming any other is refused, and so
 * is a sign-in asking to return anywhere else (Claude Code's own loopback addresses aren't accepted).
 */
export const CLAUDE_REDIRECT_URIS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'] as const;

export const isClaudeRedirectUri = (uri: unknown): uri is string => typeof uri === 'string' && (CLAUDE_REDIRECT_URIS as readonly string[]).includes(uri);

/**
 * The hosts a Client ID Metadata Document is read from: Claude's own. A client_id that is such an address (https, a path,
 * no query, no port) is read from there; any other address is not fetched at all (no request to arbitrary servers).
 */
export const CLAUDE_CLIENT_DOCUMENT_HOSTS = ['claude.ai', 'claude.com'] as const;

export function isClaudeClientDocumentUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    (CLAUDE_CLIENT_DOCUMENT_HOSTS as readonly string[]).includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.pathname.length > 1 &&
    !url.search &&
    !url.hash &&
    url.href === value
  );
}

/** The host a return address goes to, shown on the consent page ("You will go back to claude.ai"). */
export function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

// ---------- lifetimes and tokens ----------

/** An access token lasts an hour; Claude refreshes it (before it ends, or on a 401). */
export const CONNECTOR_ACCESS_TOKEN_SECONDS = 60 * 60;

/** An authorization code is redeemed within 5 minutes, once. */
export const CONNECTOR_CODE_SECONDS = 5 * 60;

/**
 * A connection is long-lived, like the app's fingerprint sign-in: it ends after 90 days without a refresh, or when the
 * person signs it out (Your Sessions), an Admin ends it (the Users page), the account is deactivated, or its password is
 * changed or reset. The 15 minutes without activity are never for it.
 */
export const CONNECTOR_UNUSED_DAYS = 90;
export const CONNECTOR_UNUSED_MS = CONNECTOR_UNUSED_DAYS * 24 * 60 * 60 * 1000;

/** A refresh token used again within this long of its rotation is only refused; later, the connection ends (theft). */
export const CONNECTOR_REFRESH_REUSE_GRACE_MS = 60_000;

/**
 * What starts each kind of opaque value the API gives (the rest: 32 random bytes, base64url): the API tells a connector's
 * access token from the website's session token by it, and keeps only their SHA-256.
 */
export const CONNECTOR_TOKEN_PREFIXES = {
  access: 'tlxa_',
  refresh: 'tlxr_',
  code: 'tlxc_',
  client: 'tlxcl_',
  secret: 'tlxs_',
} as const;

export const isConnectorAccessToken = (token: unknown): token is string => typeof token === 'string' && token.startsWith(CONNECTOR_TOKEN_PREFIXES.access);

/** PKCE (RFC 7636): a verifier of 43 to 128 unreserved characters, and its S256 challenge (32 bytes, base64url). */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ---------- the sign-in request ----------

/** The authorization request's parameters, as the authorize page reads them (the first of each, trimmed). */
export interface ConnectorAuthorizeInput {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  resource: string;
}

const AUTHORIZE_KEYS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'] as const;

export function readAuthorizeInput(params: Record<string, string | string[] | undefined>): ConnectorAuthorizeInput {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
  return Object.fromEntries(AUTHORIZE_KEYS.map((k) => [k, first(params[k])])) as unknown as ConnectorAuthorizeInput;
}

/** An OAuth error sent back to Claude (RFC 6749 §4.1.2.1), with words for the person. */
export interface AuthorizeError {
  error: 'invalid_request' | 'unsupported_response_type' | 'invalid_scope' | 'invalid_target' | 'access_denied';
  description: string;
}

/** The scopes Claude may ask for: assets, and offline_access (refresh tokens are given anyway). Others are refused. */
const ASKABLE_SCOPES = new Set([CONNECTOR_SCOPE, 'offline_access']);

/**
 * What is wrong with a sign-in request once its client and return address are known to be good (those are checked
 * first, and never sent back: see the API), or null: the code flow, PKCE with S256, a scope of Assets only, and the
 * resource (when given) this MCP server's address. `resource`: connectorResource of the website.
 */
export function authorizeRequestError(input: Omit<ConnectorAuthorizeInput, 'client_id' | 'redirect_uri' | 'state'>, resource: string): AuthorizeError | null {
  if (input.response_type !== 'code') return { error: 'unsupported_response_type', description: 'Only the authorization code flow is supported (response_type=code).' };
  if (!input.code_challenge) return { error: 'invalid_request', description: 'PKCE is required: send a code_challenge with code_challenge_method=S256.' };
  if (input.code_challenge_method !== 'S256') return { error: 'invalid_request', description: 'Only the S256 code challenge method is supported.' };
  if (!PKCE_CHALLENGE_PATTERN.test(input.code_challenge)) return { error: 'invalid_request', description: 'The code_challenge is not an S256 challenge.' };
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  if (scopes.some((s) => !ASKABLE_SCOPES.has(s))) return { error: 'invalid_scope', description: `Only the "${CONNECTOR_SCOPE}" scope is offered.` };
  if (input.resource && input.resource !== resource) return { error: 'invalid_target', description: `Tokens are only issued for ${resource}.` };
  return null;
}

/** The address Claude is sent back to: its return address with the code (or the error), the state and the issuer (RFC 9207). */
export function authorizeRedirect(redirectUri: string, issuer: string, state: string, result: { code: string } | AuthorizeError): string {
  const url = new URL(redirectUri);
  if ('code' in result) url.searchParams.set('code', result.code);
  else {
    url.searchParams.set('error', result.error);
    url.searchParams.set('error_description', result.description);
  }
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer);
  return url.toString();
}

// ---------- the consent page ----------

/** What Claude may and may not do with the person's access, in their words, for the consent page and the help page. */
export function connectorAbilities(access: AssetsAccess, values: boolean): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  if (access === 'none') return { can, cannot: ['Use Assets: you have no Assets access.'] };
  can.push('Search the asset register, and look up an asset by its code or serial number');
  can.push('See who holds what, overdue returns, stock levels and the counts due');
  can.push('List the rooms and kits, and the groups, types and codes it fills fields with');
  if (values) can.push('See the purchase cost, the book value and the market value, as you do');
  if (access === 'custodian' || access === 'manager') {
    can.push(
      values
        ? 'Draft new assets, with their values, for you to review: nothing joins the register until someone confirms the draft here'
        : 'Draft new assets for you to review: nothing joins the register until someone confirms the draft here',
    );
    // owner, 21 October 2026: "let the mcp connector fetch the product photo and add it / yes build it"
    can.push('Add the maker’s product image to a draft from a link it finds, marked as a product image (up to 3)');
  }
  const cannot = [
    'Delete, dispose of, hand over or receive assets',
    'Count assets, or change the rooms or the Assets settings',
    'Add photos of the item itself: you add them here when you confirm a draft',
    'See or change anything outside Assets',
  ];
  if (access === 'viewer') cannot.unshift('Draft or change assets: your access is view only');
  return { can, cannot };
}

/** The consent page's question. */
export const CONNECTOR_CONSENT_QUESTION = 'Allow Claude to use your Assets access in Trendlix People?';

/** Why the consent page can't offer Allow. */
export const CONNECTOR_REFUSALS = {
  no_access: 'You do not have access to Assets, so Claude can’t be connected to it. An Admin gives Assets access on the Users page.',
  viewing_as: 'You are viewing as someone. Go back to your own account to connect Claude.',
} as const;

export type ConnectorRefusal = keyof typeof CONNECTOR_REFUSALS;

// ---------- the tools ----------

/**
 * The connector's tools, by name, with the Assets access each needs (the API checks it again on every call). Reading
 * for anyone with access; drafting for a custodian or a manager. Not offered at all: disposal, deleting, custody
 * handover and return, counts, settings, and anything outside Assets.
 */
export const CONNECTOR_TOOLS = [
  { name: 'search_assets', level: 'viewer', summary: 'Search the register by text, group, status, room, kit or holder' },
  { name: 'get_asset', level: 'viewer', summary: 'An asset by its code or serial number' },
  { name: 'who_holds', level: 'viewer', summary: 'What an employee holds, by their name or code' },
  { name: 'overdue_returns', level: 'viewer', summary: 'Shoot custody past its return date' },
  { name: 'stock_levels', level: 'viewer', summary: 'Consumables and what needs reordering' },
  { name: 'counts_due', level: 'viewer', summary: 'Which groups are due a count' },
  { name: 'list_rooms', level: 'viewer', summary: 'The rooms assets are kept in' },
  { name: 'list_kits', level: 'viewer', summary: 'The production kits' },
  { name: 'asset_catalog', level: 'viewer', summary: 'The groups, types, codes, conditions and statuses, to fill fields correctly' },
  { name: 'list_asset_drafts', level: 'custodian', summary: 'The drafts from Claude waiting to be confirmed' },
  { name: 'create_asset_draft', level: 'custodian', summary: 'Draft a new asset for a person to review and confirm' },
  { name: 'update_asset_draft', level: 'custodian', summary: 'Change a draft that is still waiting' },
  { name: 'add_product_image', level: 'custodian', summary: 'Add the maker’s product image to a draft, from a link (up to 3)' },
] as const satisfies readonly { name: string; level: 'viewer' | 'custodian'; summary: string }[];

export type ConnectorToolName = (typeof CONNECTOR_TOOLS)[number]['name'];

// ---------- the API's answers ----------

/** An OAuth error's body (RFC 6749 §5.2, RFC 7591 §3.2.2, RFC 7009). */
export interface OAuthErrorBody {
  error: string;
  error_description?: string;
}

/** POST /connector/oauth/register (RFC 7591 §3.2.1). */
export interface ConnectorClientRegistration {
  client_id: string;
  client_id_issued_at: number;
  /** Only for a client that asked to authenticate with a secret (client_secret_post or client_secret_basic): given once. */
  client_secret?: string;
  client_secret_expires_at?: 0;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
  scope: string;
}

/** POST /connector/oauth/token (RFC 6749 §5.1). */
export interface ConnectorTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * POST /connector/oauth/authorize/check (the person signed in on the website): what the consent page shows. `show`: the
 * client or its return address isn't one this server accepts, said on the page, never sent back (an open redirect
 * otherwise); `redirect`: another problem, sent back to Claude with the error; `ok`: the consent, or why it can't be
 * given (`refusal`).
 */
export type ConnectorAuthorizeCheck =
  | { kind: 'show'; message: string }
  | { kind: 'redirect'; redirectUri: string; error: AuthorizeError }
  | {
      kind: 'ok';
      client: { id: string; name: string };
      redirectUri: string;
      /** The host Claude returns to, shown on the page (the spec: "clearly display the redirect URI hostname"). */
      redirectHost: string;
      access: AssetsAccess;
      values: boolean;
      refusal: ConnectorRefusal | null;
    };

/** POST /connector/oauth/authorize: Allow pressed; the code to send back with. */
export interface ConnectorAuthorizeGrant {
  code: string;
  redirectUri: string;
}

/** GET /connector/me, with a connector's token: whose connection it is, and their Assets access now. */
export interface ConnectorMe {
  userId: string;
  email: string;
  name: string | null;
  assets: { access: AssetsAccess; values: boolean };
  scope: string;
  /** The MCP address the token was issued for (RFC 8707): the MCP endpoint refuses a token of another address. */
  resource: string | null;
  /** The client's name, as it registered ("Claude"). */
  client: string | null;
  sessionId: string;
}

/** What the audit log marks an entry made through the connector with (audit_log.via). */
export const AUDIT_VIA_CONNECTOR = 'claude_connector';
