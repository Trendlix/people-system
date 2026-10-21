import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CONNECTOR_TOOLS, type ConnectorMe } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { ConnectorCall } from './assets-api';
import { bearerOf, challenge, handleMcp } from './mcp';

// The MCP endpoint of the Claude connector (owner, 21 October 2026: "the connection method"), with the API mocked: what
// it refuses before the SDK runs (no token, another kind of token, a token the API no longer takes or issued for another
// address, a foreign Origin, GET), and, end to end with the SDK's own client, listing the tools and calling one.

const ORIGIN = 'https://people.trendlix.com';
const URL_MCP = `${ORIGIN}/api/mcp`;
const TOKEN = 'tlxa_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

const ME: ConnectorMe = {
  userId: 'u1',
  email: 'mona@trendlix.com',
  name: 'Mona Hassan',
  assets: { access: 'custodian', values: false },
  scope: 'assets',
  resource: URL_MCP,
  client: 'Claude',
  sessionId: 's1',
};

function fakeCall(answers: Record<string, () => { status: number; body: unknown }>) {
  const calls: { path: string; token: string; method: string }[] = [];
  const call: ConnectorCall = async (path, token, init = {}) => {
    calls.push({ path, token, method: init.method ?? 'GET' });
    const answer = answers[`${init.method ?? 'GET'} ${path}`]?.() ?? { status: 404, body: { statusCode: 404, message: 'Not found.' } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
  return { call, calls };
}

const meOk = { 'GET /connector/me': () => ({ status: 200, body: ME }) };

const post = (headers: Record<string, string> = {}, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) =>
  new Request(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

describe('the MCP endpoint, before the SDK', () => {
  it('answers a request without a token with 401 and where to sign in, which starts Claude’s sign-in', async () => {
    const { call, calls } = fakeCall(meOk);
    const res = await handleMcp(post(), { call });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="assets"`);
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
    expect(calls).toEqual([]);
  });

  it('never passes on a token that isn’t the connector’s (the website’s session token, another issuer’s)', async () => {
    const { call, calls } = fakeCall(meOk);
    const res = await handleMcp(post({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' }), { call });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(calls).toEqual([]);
  });

  it('answers 401 invalid_token when the API no longer takes the token, so Claude refreshes it', async () => {
    const { call } = fakeCall({ 'GET /connector/me': () => ({ status: 401, body: { statusCode: 401, message: 'Your session ended.' } }) });
    const res = await handleMcp(post({ authorization: `Bearer ${TOKEN}` }), { call });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="/);
  });

  it('refuses a token issued for another address (RFC 8707)', async () => {
    const { call } = fakeCall({ 'GET /connector/me': () => ({ status: 200, body: { ...ME, resource: 'https://preview.example.com/api/mcp' } }) });
    const res = await handleMcp(post({ authorization: `Bearer ${TOKEN}` }), { call });
    expect(res.status).toBe(401);
  });

  it('says the API’s words when the person has lost their Assets access since', async () => {
    const { call } = fakeCall({ 'GET /connector/me': () => ({ status: 403, body: { statusCode: 403, message: 'You do not have access to Assets.' } }) });
    const res = await handleMcp(post({ authorization: `Bearer ${TOKEN}` }), { call });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { message: 'You do not have access to Assets.' }, id: null });
  });

  it('refuses a foreign Origin (DNS rebinding) but takes Claude’s and its own, or none', async () => {
    const { call } = fakeCall(meOk);
    expect((await handleMcp(post({ origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` }), { call })).status).toBe(403);
    expect((await handleMcp(post({ origin: 'https://claude.ai', authorization: `Bearer ${TOKEN}` }), { call })).status).toBe(200);
    expect((await handleMcp(post({ origin: ORIGIN, authorization: `Bearer ${TOKEN}` }), { call })).status).toBe(200);
  });

  it('offers no stream: GET and DELETE are 405', async () => {
    const { call } = fakeCall(meOk);
    for (const method of ['GET', 'DELETE']) {
      const res = await handleMcp(new Request(URL_MCP, { method, headers: { authorization: `Bearer ${TOKEN}` } }), { call });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('reads the bearer token and writes the challenge as RFC 6750 does', () => {
    expect(bearerOf(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerOf('bearer  abc ')).toBe('abc');
    expect(bearerOf('Basic abc')).toBeNull();
    expect(bearerOf(null)).toBeNull();
    expect(challenge(ORIGIN, { code: 'invalid_token', description: 'It "ended"' })).toBe(
      `Bearer error="invalid_token", error_description="It 'ended'", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="assets"`,
    );
  });
});

describe('the MCP endpoint, with the SDK’s own client', () => {
  it('connects, lists the twelve tools, and calls search_assets with the person’s token', async () => {
    const { call, calls } = fakeCall({
      ...meOk,
      'GET /assets?q=fx3': () => ({
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              code: 'PK-CAM-0003',
              name: 'Sony FX3',
              group: 'kit',
              type: 'CAM',
              status: 'available',
              condition: null,
              brand: 'Sony',
              model: 'FX3',
              serial: null,
              room: null,
              kit: null,
              holder: null,
              quantity: null,
              unit: null,
              reorder: false,
              photo: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
          counts: {},
        },
      }),
    });
    const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
      fetch: (url, init) => handleMcp(new Request(url, init), { call }),
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'test-harness', version: '1.0.0' });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({ name: 'trendlix-people-assets' });
    expect(client.getInstructions()).toContain('A draft is not an asset');

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(CONNECTOR_TOOLS.map((t) => t.name).sort());
    const create = tools.find((t) => t.name === 'create_asset_draft')!;
    expect(create.inputSchema.required).toEqual(['name', 'group', 'type']);
    expect(create.inputSchema.additionalProperties).toBe(false);
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

    const result = await client.callTool({ name: 'search_assets', arguments: { text: 'fx3' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain('PK-CAM-0003');

    // a call outside the schema is refused by the SDK before the tool runs
    const wrong = await client.callTool({ name: 'search_assets', arguments: { group: 'spaceship' } });
    expect(wrong.isError).toBe(true);

    await client.close();
    expect(calls.filter((c) => c.path === '/assets?q=fx3')).toHaveLength(1);
    expect(calls.every((c) => c.token === TOKEN)).toBe(true);
  });
});
