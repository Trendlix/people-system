import { CONNECTOR_PATHS, connectorResource, readAuthorizeInput, type AuthorizeError, type ConnectorAuthorizeInput } from '@trendlix/shared';

// The sign-in and consent page of the Claude connector (owner, 21 October 2026: "the connection method"; the brief:
// "Allow Claude to use your Assets access in Trendlix People?"): the request as the page and its buttons pass it on, the
// way back to the sign-in page with it, and what the API is asked. The API checks the client, its return address and
// everything else, and only an address it answered is ever redirected to. Pure code (no "@/" imports): tested.

const ORDER = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'] as const;

/** The authorize page's own address for this request: its parameters as sent, in a fixed order, empty ones left out. */
export function authorizePath(input: ConnectorAuthorizeInput): string {
  const search = new URLSearchParams();
  for (const key of ORDER) if (input[key]) search.set(key, input[key]);
  const qs = search.toString();
  return `${CONNECTOR_PATHS.authorize}${qs ? `?${qs}` : ''}`;
}

/** The sign-in page, coming back to this request once signed in (the session had ended meanwhile). */
export const loginPathFor = (input: ConnectorAuthorizeInput): string => `/login?next=${encodeURIComponent(authorizePath(input))}`;

/** What POST /connector/oauth/authorize(/check) is sent: the request, and this MCP server's address to bind it to. */
export const checkBody = (input: ConnectorAuthorizeInput, origin: string) => ({ ...input, expectedResource: connectorResource(origin) });

/** Deny, or Back to Claude: sent back with access_denied (RFC 6749 §4.1.2.1). */
export const DENIED: AuthorizeError = { error: 'access_denied', description: 'The person did not allow Claude to connect.' };

/** The request carried by the consent page's buttons (a hidden field, JSON), read back as the page read it. */
export function inputFromForm(raw: FormDataEntryValue | null): ConnectorAuthorizeInput {
  let parsed: unknown = null;
  if (typeof raw === 'string' && raw.length <= 8000) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const strings = Object.fromEntries(Object.entries(record).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return readAuthorizeInput(strings);
}
