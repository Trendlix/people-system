import 'server-only';
import '../api-ca';
import { API_URL } from '../api';
import type { ConnectorCall } from './assets-api';
import type { ApiCall } from './oauth-proxy';

// How the Claude connector's routes reach the API (owner, 21 October 2026: "the connection method"): from this server,
// with the API's own certificate trusted (lib/api-ca.ts), never cached. The OAuth endpoints call it without a session;
// the MCP endpoint with the connector's token, so every tool call has the person's own rights, as the pages do.

/** A request to the API's public OAuth endpoints (no session). */
export const oauthApiCall: ApiCall = (path, init) => fetch(`${API_URL}/api${path}`, { ...init, cache: 'no-store' });

/** A request to the API with the connector's bearer token. */
export const connectorApiCall: ConnectorCall = (path, token, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(`${API_URL}/api${path}`, { ...init, headers, cache: 'no-store' });
};
