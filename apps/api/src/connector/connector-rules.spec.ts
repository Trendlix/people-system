import { createHash } from 'node:crypto';
import { CONNECTOR_REFRESH_REUSE_GRACE_MS, CONNECTOR_TOKEN_PREFIXES } from '@trendlix/shared';
import {
  accessRefusal,
  clientAuthenticated,
  clientCredentials,
  codeVerdict,
  isResource,
  looksLike,
  newSecret,
  OAuthError,
  pkceMatches,
  readBasic,
  readClientDocument,
  readRegistration,
  readTokenRequest,
  refreshVerdict,
  s256,
  secretHash,
  secretMatches,
  sessionOn,
  type CodeState,
  type ConnectorSessionState,
} from './connector-rules.js';

// The Claude connector's OAuth rules (owner, 21 October 2026: "the connection method"): the secrets kept only as their
// SHA-256, PKCE with S256 (RFC 7636's own example), registration with Claude's return addresses only, a client's
// metadata document, the client's credentials, a code redeemed once, a refresh token rotated (used again: refused, and
// after a minute the connection ends), an access token, and the MCP address a token is bound to.

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const NOW = new Date('2026-10-21T12:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

// RFC 7636, Appendix B
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const throws = (fn: () => unknown): OAuthError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof OAuthError) return err;
    throw err;
  }
  throw new Error('Expected an OAuth error');
};

describe('secrets', () => {
  it('are 32 random bytes behind their kind’s prefix, never the same twice', () => {
    const a = newSecret('access');
    expect(a.startsWith(CONNECTOR_TOKEN_PREFIXES.access)).toBe(true);
    expect(a).toHaveLength(CONNECTOR_TOKEN_PREFIXES.access.length + 43);
    expect(newSecret('access')).not.toBe(a);
    expect(newSecret('refresh').startsWith('tlxr_')).toBe(true);
    expect(newSecret('code').startsWith('tlxc_')).toBe(true);
    expect(looksLike('access', a)).toBe(true);
    expect(looksLike('refresh', a)).toBe(false);
    expect(looksLike('access', 'tlxa_short')).toBe(false);
    expect(looksLike('access', `${a}!`)).toBe(false);
    expect(looksLike('access', null)).toBe(false);
  });

  it('are kept only as their SHA-256, and compared with it in constant time', () => {
    const s = newSecret('refresh');
    const hash = secretHash(s);
    expect(hash).toBe(createHash('sha256').update(s).digest('hex'));
    expect(hash).not.toContain(s);
    expect(secretMatches(s, hash)).toBe(true);
    expect(secretMatches(`${s}x`, hash)).toBe(false);
    expect(secretMatches(s, null)).toBe(false);
    expect(secretMatches(s, 'not-a-hash')).toBe(false);
    expect(secretMatches('', hash)).toBe(false);
  });
});

describe('PKCE (S256 only)', () => {
  it('matches RFC 7636’s own example', () => {
    expect(s256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(pkceMatches(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it('refuses another verifier, a plain one, or one too short or with other characters', () => {
    expect(pkceMatches(`${RFC_VERIFIER.slice(0, -1)}Y`, RFC_CHALLENGE)).toBe(false);
    // "plain": the verifier sent as the challenge
    expect(pkceMatches(RFC_CHALLENGE, RFC_CHALLENGE)).toBe(false);
    expect(pkceMatches('short', s256('short'))).toBe(false);
    const spaced = `${'a'.repeat(42)} b`;
    expect(pkceMatches(spaced, s256(spaced))).toBe(false);
    expect(pkceMatches(undefined, RFC_CHALLENGE)).toBe(false);
    expect(pkceMatches(RFC_VERIFIER, 'not-a-challenge')).toBe(false);
  });
});

describe('registration (RFC 7591)', () => {
  it('takes Claude’s return address and makes a public client by default', () => {
    expect(readRegistration({ client_name: '  Claude  ', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' })).toEqual({
      name: 'Claude',
      redirectUris: [CALLBACK],
      authMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
    });
    const plain = readRegistration({ redirect_uris: [CALLBACK, 'https://claude.com/api/mcp/auth_callback', CALLBACK], logo_uri: 'https://x', scope: 'assets' });
    expect(plain.authMethod).toBe('none');
    expect(plain.name).toBe('MCP client');
    expect(plain.redirectUris).toEqual([CALLBACK, 'https://claude.com/api/mcp/auth_callback']);
    expect(plain.grantTypes).toEqual(['authorization_code']);
  });

  it('gives a secret only to a client that asks for one', () => {
    expect(readRegistration({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post' }).authMethod).toBe('client_secret_post');
    expect(readRegistration({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }).authMethod).toBe('client_secret_basic');
    expect(throws(() => readRegistration({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'private_key_jwt' })).error).toBe('invalid_client_metadata');
  });

  it('refuses any other return address: another site, Claude Code’s loopback, http, a look-alike', () => {
    for (const uri of [
      'https://evil.example/callback',
      'http://localhost:3118/callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
    ]) {
      const err = throws(() => readRegistration({ redirect_uris: [CALLBACK, uri] }));
      expect(err.error).toBe('invalid_redirect_uri');
      expect(err.status).toBe(400);
    }
    expect(throws(() => readRegistration({ redirect_uris: [] })).error).toBe('invalid_redirect_uri');
    expect(throws(() => readRegistration({})).error).toBe('invalid_redirect_uri');
  });

  it('refuses what it doesn’t offer: implicit flow, client credentials, a body that isn’t an object', () => {
    expect(throws(() => readRegistration({ redirect_uris: [CALLBACK], response_types: ['token'] })).error).toBe('invalid_client_metadata');
    expect(throws(() => readRegistration({ redirect_uris: [CALLBACK], grant_types: ['client_credentials'] })).error).toBe('invalid_client_metadata');
    expect(throws(() => readRegistration([CALLBACK])).error).toBe('invalid_client_metadata');
    expect(throws(() => readRegistration(null)).error).toBe('invalid_client_metadata');
  });
});

describe('a client’s metadata document', () => {
  const URL_ = 'https://claude.ai/oauth/claude-client-metadata';

  it('is its own address’s, public, and only Claude’s return addresses are kept from it', () => {
    expect(readClientDocument(URL_, { client_id: URL_, client_name: 'Claude', redirect_uris: [CALLBACK, 'http://localhost/callback'], token_endpoint_auth_method: 'none' })).toEqual({
      name: 'Claude',
      redirectUris: [CALLBACK],
    });
    expect(readClientDocument(URL_, { client_id: URL_, redirect_uris: [CALLBACK] }).name).toBe('claude.ai');
  });

  it('is refused for another client_id, a secret, or none of Claude’s return addresses', () => {
    expect(throws(() => readClientDocument(URL_, { client_id: 'https://claude.ai/other', redirect_uris: [CALLBACK] })).error).toBe('invalid_client');
    expect(throws(() => readClientDocument(URL_, { client_id: URL_, redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' })).error).toBe('invalid_client');
    expect(throws(() => readClientDocument(URL_, { client_id: URL_, redirect_uris: ['http://127.0.0.1/callback'] })).error).toBe('invalid_client');
    expect(throws(() => readClientDocument(URL_, 'text')).status).toBe(401);
  });
});

describe('the client’s credentials', () => {
  const basic = (id: string, secret: string) => Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');

  it('reads the Basic header (form-encoded parts) or the body', () => {
    expect(readBasic(basic('tlxcl_abc', 's:e c'))).toEqual({ clientId: 'tlxcl_abc', secret: 's:e c' });
    expect(readBasic('')).toBeNull();
    expect(readBasic(Buffer.from('no-colon').toString('base64'))).toBeNull();
    expect(clientCredentials({ basic: basic('tlxcl_a', 'x'), client_id: '', client_secret: '' })).toEqual({ clientId: 'tlxcl_a', secret: 'x', basic: true });
    expect(clientCredentials({ basic: '', client_id: 'tlxcl_b', client_secret: 'y' })).toEqual({ clientId: 'tlxcl_b', secret: 'y', basic: false });
    expect(throws(() => clientCredentials({ basic: basic('tlxcl_a', 'x'), client_id: 'tlxcl_b', client_secret: '' })).error).toBe('invalid_request');
  });

  it('a public client needs no secret; one with a secret, its own, the way it registered', () => {
    const secret = newSecret('secret');
    expect(clientAuthenticated({ authMethod: 'none', secretHash: null }, { secret: '', basic: false })).toBe(true);
    const post = { authMethod: 'client_secret_post', secretHash: secretHash(secret) };
    expect(clientAuthenticated(post, { secret, basic: false })).toBe(true);
    expect(clientAuthenticated(post, { secret, basic: true })).toBe(false);
    expect(clientAuthenticated(post, { secret: 'wrong', basic: false })).toBe(false);
    const byBasic = { authMethod: 'client_secret_basic', secretHash: secretHash(secret) };
    expect(clientAuthenticated(byBasic, { secret, basic: true })).toBe(true);
    expect(clientAuthenticated(byBasic, { secret, basic: false })).toBe(true);
    expect(clientAuthenticated(byBasic, { secret: '', basic: true })).toBe(false);
  });

  it('reads a request’s fields as text only', () => {
    const req = readTokenRequest({ grant_type: ' authorization_code ', code: 5, scope: ['assets'], client_id: 'tlxcl_x', huge: 'x'.repeat(3000) });
    expect(req.grant_type).toBe('authorization_code');
    expect(req.code).toBe('');
    expect(req.scope).toBe('');
    expect(req.client_id).toBe('tlxcl_x');
    expect(readTokenRequest(null).grant_type).toBe('');
  });
});

describe('a code', () => {
  const code = (c: Partial<CodeState> = {}): CodeState => ({
    clientId: 'tlxcl_claude',
    redirectUri: CALLBACK,
    codeChallenge: RFC_CHALLENGE,
    resource: 'https://people.trendlix.com/api/mcp',
    expiresAt: later(60_000),
    usedAt: null,
    ...c,
  });
  const req = { clientId: 'tlxcl_claude', redirectUri: CALLBACK, verifier: RFC_VERIFIER, resource: 'https://people.trendlix.com/api/mcp' };

  it('is redeemed by its client, at its return address, with its verifier, for its MCP address', () => {
    expect(codeVerdict(code(), req, NOW)).toEqual({ ok: true });
    expect(codeVerdict(code(), { ...req, resource: '' }, NOW)).toEqual({ ok: true });
  });

  it('is refused otherwise, with invalid_grant (or invalid_target), and a second use is marked to end its session', () => {
    const refused = (c: CodeState | null, r = req) => {
      const v = codeVerdict(c, r, NOW);
      if (v.ok) throw new Error('Expected a refusal');
      return v;
    };
    expect(refused(null).error.error).toBe('invalid_grant');
    expect(refused(code({ clientId: 'tlxcl_other' })).error.error).toBe('invalid_grant');
    expect(refused(code({ expiresAt: NOW })).error.error).toBe('invalid_grant');
    expect(refused(code(), { ...req, redirectUri: 'https://claude.com/api/mcp/auth_callback' }).error.error).toBe('invalid_grant');
    expect(refused(code(), { ...req, verifier: `${RFC_VERIFIER.slice(0, -1)}Z` }).error.error).toBe('invalid_grant');
    expect(refused(code(), { ...req, verifier: '' }).error.error).toBe('invalid_grant');
    expect(refused(code(), { ...req, resource: 'https://evil.example/mcp' }).error.error).toBe('invalid_target');
    const again = refused(code({ usedAt: later(-1000) }));
    expect(again.error.error).toBe('invalid_grant');
    expect(again.reused).toBe(true);
  });
});

describe('a refresh token: rotated on every use', () => {
  const session = (s: Partial<ConnectorSessionState> = {}): ConnectorSessionState => ({
    kind: 'connector',
    clientId: 'tlxcl_claude',
    resource: 'https://people.trendlix.com/api/mcp',
    expiresAt: later(86_400_000),
    endedAt: null,
    user: { isActive: true },
    ...s,
  });
  const token = (t: Partial<{ kind: string; expiresAt: Date; rotatedAt: Date | null; session: ConnectorSessionState }> = {}) => ({
    kind: 'refresh',
    expiresAt: later(86_400_000),
    rotatedAt: null,
    session: session(),
    ...t,
  });
  const req = { clientId: 'tlxcl_claude', resource: '' };

  it('rotates a good one', () => {
    expect(refreshVerdict(token(), req, NOW)).toEqual({ kind: 'rotate' });
  });

  it('refuses one unknown, another client’s, an access token, or one whose connection has ended', () => {
    for (const t of [null, token({ kind: 'access' }), token({ session: session({ clientId: 'tlxcl_other' }) }), token({ session: session({ endedAt: NOW }) }), token({ session: session({ user: { isActive: false } }) }), token({ session: session({ expiresAt: NOW }) }), token({ expiresAt: NOW })]) {
      const v = refreshVerdict(t, req, NOW);
      expect(v.kind).toBe('refuse');
      if (v.kind === 'refuse') {
        expect(v.error.error).toBe('invalid_grant');
        expect(v.end).toBeFalsy();
      }
    }
    const v = refreshVerdict(token(), { ...req, resource: 'https://evil.example/mcp' }, NOW);
    expect(v.kind === 'refuse' && v.error.error).toBe('invalid_target');
  });

  it('used again: refused within a minute (a retry), and after that the connection ends (theft)', () => {
    const soon = refreshVerdict(token({ rotatedAt: later(-(CONNECTOR_REFRESH_REUSE_GRACE_MS - 1000)) }), req, NOW);
    expect(soon).toMatchObject({ kind: 'refuse', end: false });
    const late = refreshVerdict(token({ rotatedAt: later(-(CONNECTOR_REFRESH_REUSE_GRACE_MS + 1000)) }), req, NOW);
    expect(late).toMatchObject({ kind: 'refuse', end: true });
    if (late.kind === 'refuse') expect(late.error.error).toBe('invalid_grant');
  });
});

describe('an access token', () => {
  const session: ConnectorSessionState = { kind: 'connector', clientId: 'tlxcl_c', resource: 'https://people.trendlix.com/api/mcp', expiresAt: later(1000), endedAt: null, user: { isActive: true } };

  it('is good until its hour is over and while its connection is on', () => {
    expect(accessRefusal({ kind: 'access', expiresAt: later(1000), session }, NOW)).toBeNull();
    expect(accessRefusal(null, NOW)).toMatch(/not valid/);
    expect(accessRefusal({ kind: 'refresh', expiresAt: later(1000), session }, NOW)).toMatch(/not valid/);
    expect(accessRefusal({ kind: 'access', expiresAt: NOW, session }, NOW)).toMatch(/expired/);
    expect(accessRefusal({ kind: 'access', expiresAt: later(1000), session: { ...session, endedAt: NOW } }, NOW)).toMatch(/ended/);
    expect(accessRefusal({ kind: 'access', expiresAt: later(1000), session: { ...session, user: { isActive: false } } }, NOW)).toMatch(/ended/);
    // only a connector's session: a website's never carries these tokens
    expect(sessionOn({ ...session, kind: 'web' }, NOW)).toBe(false);
  });
});

describe('the MCP address a token is bound to', () => {
  it('is an absolute https address (http only on this computer), without a fragment', () => {
    expect(isResource('https://people.trendlix.com/api/mcp')).toBe(true);
    expect(isResource('http://localhost:3000/api/mcp')).toBe(true);
    expect(isResource('http://people.trendlix.com/api/mcp')).toBe(false);
    expect(isResource('https://people.trendlix.com/api/mcp#x')).toBe(false);
    expect(isResource('people.trendlix.com/api/mcp')).toBe(false);
    expect(isResource('')).toBe(false);
    expect(isResource(undefined)).toBe(false);
  });
});
