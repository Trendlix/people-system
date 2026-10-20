import 'server-only';
import './api-ca';
import { BACKGROUND_HEADER } from '@trendlix/shared';
import { cookies, headers as requestHeaders } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { clientIp } from './client-ip';
import { SESSION_COOKIE } from './constants';
import { signedIpHeaders } from './signed-ip';
import { reasonOf, signInPath } from './signed-out';
import type { CompanyBrand } from './types';

// All API calls go from this Next.js server to the NestJS API, never from the browser,
// so the session cookie stays on the web domain and the API can live on another host.
export const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages.join(' '));
  }
}

export async function messagesOf(res: Response): Promise<string[]> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message;
    if (body.message) return [body.message];
  } catch {
    // not JSON
  }
  return [`Request failed (${res.status}).`];
}

/**
 * How a request is sent. `background`: one the web makes by itself, not the person (the sidebar's counts, the idle
 * warning's checks): the API doesn't count it as activity (owner, 20 October 2026: HR, Admin and Super Admin are signed
 * out after 15 minutes without activity), so a page left open doesn't keep the session alive. Pages and actions count.
 */
export interface CallOptions {
  background?: boolean;
  /**
   * `signIp`: the visitor's address as this website saw it, signed with WEB_KEY for this session's token (lib/signed-ip.ts;
   * owner, 20 October 2026: check-ins locked to the office network). Only on a check-in's calls and Check-in Setup's;
   * nothing is signed without the key or an address.
   */
  signIp?: boolean;
}

async function call(path: string, init: RequestInit = {}, options: CallOptions = {}): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.background) headers.set(BACKGROUND_HEADER, '1');
  if (options.signIp) {
    for (const [name, value] of Object.entries(signedIpHeaders(process.env.WEB_KEY, token, clientIp(await requestHeaders())))) headers.set(name, value);
  }
  try {
    return await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(503, ['Cannot reach the server. Please try again in a moment.']);
  }
}

/**
 * Where a 401 sends the person: the sign-in page, saying why when the API said their session ended (15 minutes without
 * activity, a sign-in on another device, signed out, ended by an Admin: see lib/signed-out.ts).
 */
export async function signedOutPath(res: Response): Promise<string> {
  try {
    return signInPath(reasonOf(await res.clone().json()));
  } catch {
    return signInPath(null);
  }
}

/** GET for pages: signs out on 401 and shows the 404 page on 404. */
export async function apiGet<T>(path: string, options?: CallOptions): Promise<T> {
  const res = await call(path, {}, options);
  if (res.status === 401) redirect(await signedOutPath(res));
  if (res.status === 404) notFound();
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return (await res.json()) as T;
}

/** POST / PUT / PATCH / DELETE for form actions: throws ApiError with the API's messages. */
export async function apiSend<T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, options?: CallOptions): Promise<T | undefined> {
  const res = await call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, options);
  if (res.status === 401) redirect(await signedOutPath(res));
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

/** Multipart upload (e.g. the company logo, scanned paperwork): throws ApiError with the API's messages. */
export async function apiUpload<T = unknown>(method: 'PUT' | 'POST', path: string, form: FormData): Promise<T | undefined> {
  const res = await call(path, { method, body: form });
  if (res.status === 401) redirect(await signedOutPath(res));
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return res.headers.get('content-type')?.includes('json') ? ((await res.json()) as T) : undefined;
}

/**
 * A request with the caller's session (a GET unless `init` says otherwise, e.g. a POST with a JSON body), as the raw
 * response, for streaming a file on to the browser. Throws ApiError (503) when the API is unreachable.
 */
export function apiFetch(path: string, init?: Pick<RequestInit, 'method' | 'body'>, options?: CallOptions): Promise<Response> {
  return call(path, init, options);
}

/** Public company name and logo and thumbnail versions, for the sidebar, the sign-in page and the browser tab icon. Never throws. */
export async function getBrand(): Promise<CompanyBrand> {
  try {
    const res = await fetch(`${API_URL}/api/company/brand`);
    if (res.ok) return (await res.json()) as CompanyBrand;
  } catch {
    // fall through to the default
  }
  return { nameEn: 'People System', nameAr: null, logoVersion: null, thumbnailVersion: null };
}
