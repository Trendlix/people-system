// The API as the Claude connector's tools call it (owner, 21 October 2026: "the connection method"): every call with the
// connector's own token, so the API answers with the person's Assets access and the values rule, exactly as it answers
// the website's pages, and refuses anything outside Assets. The token is the one the API issued for this MCP address
// (checked at GET /connector/me first); it goes nowhere else. Pure code (no "@/" imports): the route gives it the
// fetch. Tested.

/** A request to the API (`path` under /api) with the connector's bearer token. */
export type ConnectorCall = (path: string, token: string, init?: RequestInit) => Promise<Response>;

/** The API's answer: its status, its JSON, and its messages in words when it refused. */
export interface ApiAnswer<T> {
  status: number;
  ok: boolean;
  body: T | null;
  messages: string[];
}

export interface AssetsApi {
  get<T>(path: string): Promise<ApiAnswer<T>>;
  send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<ApiAnswer<T>>;
  /** A multipart POST: a draft's product image (21 October 2026), fetched by this website. */
  upload<T>(path: string, form: FormData): Promise<ApiAnswer<T>>;
}

export const UNREACHABLE = 'Trendlix People can’t be reached right now. Please try again in a moment.';

function messagesOf(status: number, body: unknown): string[] {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message;
    if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string');
    if (typeof m === 'string') return [m];
  }
  return status >= 400 ? [`The request was refused (${status}).`] : [];
}

async function answer<T>(promise: Promise<Response>): Promise<ApiAnswer<T>> {
  let res: Response;
  try {
    res = await promise;
  } catch {
    return { status: 503, ok: false, body: null, messages: [UNREACHABLE] };
  }
  let body: unknown = null;
  if (res.status !== 204) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  return { status: res.status, ok: res.ok, body: res.ok ? (body as T) : null, messages: res.ok ? [] : messagesOf(res.status, body) };
}

export function assetsApi(call: ConnectorCall, token: string): AssetsApi {
  return {
    get: <T>(path: string) => answer<T>(call(path, token, { method: 'GET' })),
    send: <T>(method: 'POST' | 'PATCH', path: string, body: unknown) =>
      answer<T>(call(path, token, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
    // fetch sets the multipart content type, with its boundary
    upload: <T>(path: string, form: FormData) => answer<T>(call(path, token, { method: 'POST', body: form })),
  };
}
