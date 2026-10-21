import { describe, expect, it } from 'vitest';
import { authorizeRedirect, type ConnectorAuthorizeInput } from '@trendlix/shared';
import { authorizePath, checkBody, DENIED, inputFromForm, loginPathFor } from './authorize';
import { authorizationServerMetadata, metadataResponse, protectedResourceMetadata } from './metadata';
import { basicCredentials, forwardToApi, readOAuthFields, registerRequest, revokeRequest, tokenRequest, type ApiCall } from './oauth-proxy';
import { mcpOriginAllowed, originFromHeaders, originOfRequest } from './site';

// The Claude connector's sign-in on the website (owner, 21 October 2026: "the connection method"): the site's origin, the
// discovery documents (RFC 9728, RFC 8414), the token, registration and revocation endpoints passing requests to the API
// (mocked) and its answers back uncached, and the consent page's request.

const ORIGIN = 'https://people.trendlix.com';

describe('the site’s origin', () => {
  it('is the forwarded host and scheme, else the host, never with a trailing slash', () => {
    expect(originFromHeaders(new Headers({ 'x-forwarded-host': 'people.trendlix.com', 'x-forwarded-proto': 'https', host: 'internal:3000' }))).toBe(ORIGIN);
    expect(originFromHeaders(new Headers({ host: 'People.Trendlix.com' }))).toBe(ORIGIN);
    expect(originFromHeaders(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(originFromHeaders(new Headers({ 'x-forwarded-host': 'a.example, b.example', 'x-forwarded-proto': 'https,http' }))).toBe('https://a.example');
    expect(originFromHeaders(new Headers({ host: 'evil.example/path' }))).toBeNull();
    expect(originFromHeaders(new Headers())).toBeNull();
    expect(originOfRequest(new Request('https://people.trendlix.com/api/mcp'))).toBe(ORIGIN);
  });

  it('lets the MCP endpoint be called from Claude’s servers (no Origin), Claude’s web apps and the site itself only', () => {
    expect(mcpOriginAllowed(null, ORIGIN)).toBe(true);
    expect(mcpOriginAllowed('https://claude.ai', ORIGIN)).toBe(true);
    expect(mcpOriginAllowed('https://claude.com', ORIGIN)).toBe(true);
    expect(mcpOriginAllowed(ORIGIN, ORIGIN)).toBe(true);
    expect(mcpOriginAllowed('https://evil.example', ORIGIN)).toBe(false);
    expect(mcpOriginAllowed('http://claude.ai', ORIGIN)).toBe(false);
  });
});

describe('the discovery documents', () => {
  it('name the MCP endpoint as the resource and this site as its only authorization server (RFC 9728)', () => {
    expect(protectedResourceMetadata(ORIGIN)).toEqual({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: ['assets'],
      bearer_methods_supported: ['header'],
      resource_name: 'Trendlix People · Assets',
      resource_documentation: `${ORIGIN}/assets/connect-claude`,
    });
  });

  it('name the issuer, the endpoints, the code flow with S256 PKCE only and dynamic registration (RFC 8414)', () => {
    const m = authorizationServerMetadata(ORIGIN);
    expect(m).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: ['assets'],
    });
    expect(m.token_endpoint_auth_methods_supported).toContain('none');
    // Claude's own choice stays dynamic registration: no Client ID Metadata Documents advertised
    expect('client_id_metadata_document_supported' in m).toBe(false);
  });

  it('are public JSON, kept a few minutes', async () => {
    const res = metadataResponse({ a: 1 });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.json()).toEqual({ a: 1 });
  });
});

/** The API mocked: what it was sent, and its answer. */
function fakeApi(status: number, body: unknown) {
  const sent: { path: string; body: unknown; contentType: string | null }[] = [];
  const call: ApiCall = async (path, init) => {
    sent.push({ path, body: JSON.parse(String(init.body)), contentType: new Headers(init.headers).get('content-type') });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { call, sent };
}

const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() });

describe('the token endpoint', () => {
  it('reads Claude’s form, passes it to the API as JSON with the client’s address, and answers uncached', async () => {
    const tokens = { access_token: 'tlxa_x', token_type: 'Bearer', expires_in: 3600, refresh_token: 'tlxr_y', scope: 'assets' };
    const { call, sent } = fakeApi(200, tokens);
    const res = await tokenRequest(
      form({ grant_type: 'authorization_code', code: 'tlxc_c', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'v'.repeat(43), client_id: 'tlxcl_1', resource: `${ORIGIN}/api/mcp`, extra: 'x' }),
      call,
      { ip: '41.1.2.3', userAgent: 'Claude-User' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(await res.json()).toEqual(tokens);
    expect(sent).toEqual([
      {
        path: '/connector/oauth/token',
        contentType: 'application/json',
        body: {
          grant_type: 'authorization_code',
          code: 'tlxc_c',
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: 'v'.repeat(43),
          client_id: 'tlxcl_1',
          resource: `${ORIGIN}/api/mcp`,
          ip: '41.1.2.3',
          userAgent: 'Claude-User',
        },
      },
    ]);
  });

  it('passes the client’s Basic credentials on, and says how to authenticate on a 401 (RFC 6749 §5.2)', async () => {
    const { call, sent } = fakeApi(401, { error: 'invalid_client', error_description: 'The client could not be authenticated.' });
    const res = await tokenRequest(form({ grant_type: 'refresh_token', refresh_token: 'tlxr_y' }, { authorization: 'Basic dGx4Y2xfMTpzZWNyZXQ=' }), call, {});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="Trendlix People"');
    expect(await res.json()).toEqual({ error: 'invalid_client', error_description: 'The client could not be authenticated.' });
    expect((sent[0].body as { basic: string }).basic).toBe('dGx4Y2xfMTpzZWNyZXQ=');
  });

  it('passes an OAuth error back as it is, and turns any other refusal into one', async () => {
    const grant = fakeApi(400, { error: 'invalid_grant', error_description: 'The code has expired.' });
    expect(await (await tokenRequest(form({ grant_type: 'authorization_code' }), grant.call, {})).json()).toEqual({ error: 'invalid_grant', error_description: 'The code has expired.' });
    const nest = fakeApi(400, { statusCode: 400, message: ['grant_type must be a string'], error: 'Bad Request' });
    const res = await tokenRequest(form({}), nest.call, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request', error_description: 'grant_type must be a string' });
    const down = fakeApi(502, { statusCode: 502 });
    expect((await tokenRequest(form({ grant_type: 'refresh_token' }), down.call, {})).status).toBe(503);
  });

  it('answers 503 temporarily_unavailable when the API can’t be reached', async () => {
    const call: ApiCall = async () => {
      throw new TypeError('fetch failed');
    };
    const res = await forwardToApi(call, '/connector/oauth/token', {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'temporarily_unavailable' });
  });

  it('reads a JSON body too, and only its text values; a body too long is refused', async () => {
    const json = new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', n: 1 }) });
    expect(await readOAuthFields(json)).toEqual({ grant_type: 'refresh_token' });
    const long = new Request(`${ORIGIN}/oauth/token`, { method: 'POST', body: 'a='.padEnd(70_000, 'x') });
    expect(await readOAuthFields(long)).toBeNull();
    expect(basicCredentials('Basic abc=')).toBe('abc=');
    expect(basicCredentials('Bearer abc')).toBeUndefined();
    expect(basicCredentials(null)).toBeUndefined();
  });
});

describe('registration and revocation', () => {
  it('registers with the client’s metadata and its address; anything but a JSON object is refused here', async () => {
    const registered = { client_id: 'tlxcl_1', client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };
    const { call, sent } = fakeApi(201, registered);
    const metadata = { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' };
    const res = await registerRequest(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata) }), call, { ip: '41.1.2.3' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(registered);
    expect(sent[0]).toMatchObject({ path: '/connector/oauth/register', body: { ...metadata, ip: '41.1.2.3' } });

    const refused = fakeApi(201, {});
    const bad = await registerRequest(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', body: '["no"]' }), refused.call, {});
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_client_metadata' });
    expect(refused.sent).toEqual([]);

    const wrong = fakeApi(400, { error: 'invalid_redirect_uri', error_description: 'Only Claude’s return addresses are accepted.' });
    const res2 = await registerRequest(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) }), wrong.call, {});
    expect(await res2.json()).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('revokes with the token and the client’s credentials only', async () => {
    const { call, sent } = fakeApi(200, {});
    const res = await revokeRequest(form({ token: 'tlxr_y', token_type_hint: 'refresh_token', client_id: 'tlxcl_1', other: 'x' }), call);
    expect(res.status).toBe(200);
    expect(sent[0]).toEqual({ path: '/connector/oauth/revoke', contentType: 'application/json', body: { token: 'tlxr_y', token_type_hint: 'refresh_token', client_id: 'tlxcl_1' } });
  });
});

describe('the consent page’s request', () => {
  const input: ConnectorAuthorizeInput = {
    response_type: 'code',
    client_id: 'tlxcl_1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    scope: 'assets',
    state: 'xyz 1',
    resource: `${ORIGIN}/api/mcp`,
  };

  it('comes back to the same request after signing in', () => {
    expect(authorizePath(input)).toBe(
      '/oauth/authorize?response_type=code&client_id=tlxcl_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&scope=assets&state=xyz+1&resource=https%3A%2F%2Fpeople.trendlix.com%2Fapi%2Fmcp',
    );
    expect(loginPathFor(input)).toBe(`/login?next=${encodeURIComponent(authorizePath(input))}`);
    expect(authorizePath({ ...input, state: '', scope: '' })).not.toContain('state=');
  });

  it('is carried by the buttons as the page read it, and asked of the API with this MCP address', () => {
    expect(inputFromForm(JSON.stringify(input))).toEqual(input);
    expect(inputFromForm('not json').client_id).toBe('');
    expect(inputFromForm(JSON.stringify({ client_id: 5, redirect_uri: ' https://claude.ai/api/mcp/auth_callback ' }))).toMatchObject({ client_id: '', redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
    expect(checkBody(input, ORIGIN)).toEqual({ ...input, expectedResource: `${ORIGIN}/api/mcp` });
  });

  it('sends Claude back with the code, the state and the issuer, or access_denied', () => {
    expect(authorizeRedirect(input.redirect_uri, ORIGIN, input.state, { code: 'tlxc_c' })).toBe(
      'https://claude.ai/api/mcp/auth_callback?code=tlxc_c&state=xyz+1&iss=https%3A%2F%2Fpeople.trendlix.com',
    );
    expect(authorizeRedirect(input.redirect_uri, ORIGIN, '', DENIED)).toContain('error=access_denied');
  });
});
