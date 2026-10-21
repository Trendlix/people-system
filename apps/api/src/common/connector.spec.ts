import {
  assetDraftPath,
  authorizeRedirect,
  authorizeRequestError,
  CONNECTOR_TOOLS,
  connectorAbilities,
  connectorResource,
  connectorResourceMetadataUrl,
  countDue,
  dayPlus,
  daysFromTo,
  hostOf,
  isClaudeClientDocumentUrl,
  isClaudeRedirectUri,
  isConnectorAccessToken,
  readAuthorizeInput,
  SESSION_KIND_LABELS,
  SESSION_KINDS,
} from '@trendlix/shared';

// The Claude connector's shared rules (owner, 21 October 2026: "the connection method" / "option a"; packages/shared
// connector.ts, asset-drafts.ts): the MCP address and its metadata's, Claude's return addresses and metadata documents,
// the sign-in request's checks and the address Claude is sent back to, the consent page's words by Assets access, the
// tools, the drafts' address, the counts due, and the third kind of session.

const ORIGIN = 'https://people.trendlix.com';
const RESOURCE = 'https://people.trendlix.com/api/mcp';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('the addresses', () => {
  it('builds the MCP address and its protected resource metadata’s from the origin', () => {
    expect(connectorResource(ORIGIN)).toBe(RESOURCE);
    expect(connectorResource(`${ORIGIN}/`)).toBe(RESOURCE);
    expect(connectorResourceMetadataUrl(ORIGIN)).toBe('https://people.trendlix.com/.well-known/oauth-protected-resource/api/mcp');
    expect(hostOf('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
  });

  it('knows only Claude’s documented return addresses', () => {
    expect(isClaudeRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isClaudeRedirectUri('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(isClaudeRedirectUri('http://localhost:3118/callback')).toBe(false);
    expect(isClaudeRedirectUri('https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
    expect(isClaudeRedirectUri(undefined)).toBe(false);
  });

  it('reads a metadata document only from Claude’s own hosts', () => {
    expect(isClaudeClientDocumentUrl('https://claude.ai/oauth/claude-client-metadata')).toBe(true);
    expect(isClaudeClientDocumentUrl('https://claude.com/oauth/x')).toBe(true);
    for (const url of ['https://evil.example/claude', 'http://claude.ai/oauth/x', 'https://claude.ai/', 'https://claude.ai:8443/x', 'https://claude.ai/x?y=1', 'https://user@claude.ai/x', 'https://claude.ai.evil.example/x', 'tlxcl_abc']) {
      expect(isClaudeClientDocumentUrl(url)).toBe(false);
    }
  });

  it('tells a connector’s access token by its prefix', () => {
    expect(isConnectorAccessToken('tlxa_abc')).toBe(true);
    expect(isConnectorAccessToken('eyJhbGciOiJIUzI1NiJ9.x.y')).toBe(false);
    expect(isConnectorAccessToken(undefined)).toBe(false);
  });
});

describe('the sign-in request', () => {
  const ok = { response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'assets', resource: RESOURCE };

  it('reads the first of each parameter, trimmed', () => {
    expect(readAuthorizeInput({ client_id: [' tlxcl_a ', 'tlxcl_b'], state: 'xyz' })).toMatchObject({ client_id: 'tlxcl_a', state: 'xyz', scope: '', resource: '' });
  });

  it('takes the code flow with PKCE S256, the Assets scope (and offline_access), for this MCP address', () => {
    expect(authorizeRequestError(ok, RESOURCE)).toBeNull();
    expect(authorizeRequestError({ ...ok, scope: '' }, RESOURCE)).toBeNull();
    expect(authorizeRequestError({ ...ok, scope: 'assets offline_access' }, RESOURCE)).toBeNull();
    expect(authorizeRequestError({ ...ok, resource: '' }, RESOURCE)).toBeNull();
  });

  it('sends back what is wrong otherwise', () => {
    expect(authorizeRequestError({ ...ok, response_type: 'token' }, RESOURCE)?.error).toBe('unsupported_response_type');
    expect(authorizeRequestError({ ...ok, code_challenge: '' }, RESOURCE)?.error).toBe('invalid_request');
    expect(authorizeRequestError({ ...ok, code_challenge_method: 'plain' }, RESOURCE)?.error).toBe('invalid_request');
    expect(authorizeRequestError({ ...ok, code_challenge: 'short' }, RESOURCE)?.error).toBe('invalid_request');
    expect(authorizeRequestError({ ...ok, scope: 'assets payroll' }, RESOURCE)?.error).toBe('invalid_scope');
    expect(authorizeRequestError({ ...ok, resource: 'https://evil.example/mcp' }, RESOURCE)?.error).toBe('invalid_target');
  });

  it('sends Claude back with the code (or the error), the state and the issuer (RFC 9207)', () => {
    const back = new URL(authorizeRedirect('https://claude.ai/api/mcp/auth_callback', ORIGIN, 'st&te', { code: 'tlxc_x' }));
    expect(back.origin + back.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(Object.fromEntries(back.searchParams)).toEqual({ code: 'tlxc_x', state: 'st&te', iss: ORIGIN });
    const denied = new URL(authorizeRedirect('https://claude.ai/api/mcp/auth_callback', ORIGIN, '', { error: 'access_denied', description: 'The person declined.' }));
    expect(Object.fromEntries(denied.searchParams)).toEqual({ error: 'access_denied', error_description: 'The person declined.', iss: ORIGIN });
  });
});

describe('the consent page’s words', () => {
  it('reads for a viewer, drafts for a custodian or manager, the values only for those who see them', () => {
    const viewer = connectorAbilities('viewer', false);
    expect(viewer.can.join(' ')).not.toMatch(/Draft/);
    expect(viewer.cannot[0]).toMatch(/view only/);
    expect(connectorAbilities('custodian', false).can.some((c) => c.startsWith('Draft new assets for you'))).toBe(true);
    expect(connectorAbilities('manager', true).can.some((c) => c.includes('with their values'))).toBe(true);
    expect(connectorAbilities('viewer', true).can.some((c) => c.includes('purchase cost'))).toBe(true);
    expect(connectorAbilities('custodian', false).can.join(' ')).not.toMatch(/purchase cost/);
    expect(connectorAbilities('none', false)).toEqual({ can: [], cannot: ['Use Assets: you have no Assets access.'] });
    for (const level of ['viewer', 'custodian', 'manager'] as const) {
      expect(connectorAbilities(level, false).cannot.join(' ')).toMatch(/Delete, dispose of, hand over or receive/);
      expect(connectorAbilities(level, false).cannot.join(' ')).toMatch(/outside Assets/);
    }
  });

  it('offers twelve tools: the reads for anyone with access, the drafts for a custodian or manager', () => {
    expect(CONNECTOR_TOOLS.map((t) => t.name)).toEqual([
      'search_assets',
      'get_asset',
      'who_holds',
      'overdue_returns',
      'stock_levels',
      'counts_due',
      'list_rooms',
      'list_kits',
      'asset_catalog',
      'list_asset_drafts',
      'create_asset_draft',
      'update_asset_draft',
    ]);
    expect(CONNECTOR_TOOLS.filter((t) => t.level === 'custodian').map((t) => t.name)).toEqual(['list_asset_drafts', 'create_asset_draft', 'update_asset_draft']);
    expect(CONNECTOR_TOOLS.map((t) => t.name).join(' ')).not.toMatch(/delete|dispose|handover|count_assets|settings/);
  });
});

describe('drafts and counts', () => {
  it('opens a draft on the Add form', () => {
    expect(assetDraftPath('2f0c1d7e-0000-4000-8000-000000000001')).toBe('/assets/new?draft=2f0c1d7e-0000-4000-8000-000000000001');
  });

  it('dues a group its count every so many days after the last, today when never counted', () => {
    expect(dayPlus('2026-10-01', 30)).toBe('2026-10-31');
    expect(daysFromTo('2026-10-01', '2026-10-21')).toBe(20);
    expect(daysFromTo('2026-10-21', '2026-10-01')).toBe(-20);
    const kit = countDue('kit', 12, '2026-09-01T08:00:00.000Z', '2026-09-01', '2026-10-21');
    expect(kit).toMatchObject({ group: 'kit', everyDays: 30, dueOn: '2026-10-01', overdue: true, neverCounted: false });
    expect(countDue('office', 4, '2026-09-01T08:00:00.000Z', '2026-09-01', '2026-10-21')).toMatchObject({ dueOn: '2027-09-01', overdue: false });
    expect(countDue('studio', 3, null, null, '2026-10-21')).toMatchObject({ dueOn: '2026-10-21', overdue: false, neverCounted: true });
    // nothing to count: never overdue
    expect(countDue('kit', 0, '2026-01-01T08:00:00.000Z', '2026-01-01', '2026-10-21').overdue).toBe(false);
  });
});

describe('the third kind of session', () => {
  it('is the Claude connector', () => {
    expect(SESSION_KINDS).toEqual(['web', 'app', 'connector']);
    expect(SESSION_KIND_LABELS.connector).toBe('Claude connector');
  });
});
