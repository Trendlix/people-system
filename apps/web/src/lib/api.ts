import 'server-only';
import './api-ca';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE } from './constants';
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

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  try {
    return await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(503, ['Cannot reach the server. Please try again in a moment.']);
  }
}

/** GET for pages: signs out on 401 and shows the 404 page on 404. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await call(path);
  if (res.status === 401) redirect('/login');
  if (res.status === 404) notFound();
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return (await res.json()) as T;
}

/** POST / PATCH / DELETE for form actions: throws ApiError with the API's messages. */
export async function apiSend<T = unknown>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T | undefined> {
  const res = await call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) redirect('/login');
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

/** Multipart upload (e.g. the company logo): throws ApiError with the API's messages. */
export async function apiUpload(method: 'PUT' | 'POST', path: string, form: FormData): Promise<void> {
  const res = await call(path, { method, body: form });
  if (res.status === 401) redirect('/login');
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
}

/** Public company name and logo version, for the sidebar and the sign-in page. Never throws. */
export async function getBrand(): Promise<CompanyBrand> {
  try {
    const res = await fetch(`${API_URL}/api/company/brand`);
    if (res.ok) return (await res.json()) as CompanyBrand;
  } catch {
    // fall through to the default
  }
  return { nameEn: 'People System', nameAr: null, logoVersion: null };
}
