import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { AllowanceType, ContractSettings, OfferListItem, OfferView } from '@/lib/types';

// Reading job offers (October 2026) and what their form needs. An API from before offers answers "Cannot GET /api/…"
// with a 404, which here means "not available yet" rather than the 404 page; any other failure of the list is shown
// quietly in its place.

const UUID = /^[0-9a-f-]{36}$/i;

/** Whether a 404's messages are the server's own "Cannot GET /api/…" for an address it doesn't have. */
const isMissingRoute = (messages: readonly string[]) => messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m));

export type OfferListing = { kind: 'ok'; rows: OfferListItem[] } | { kind: 'unavailable' } | { kind: 'failed'; message: string };

/** GET /offers?status=&q= (a path from offersListPath). */
export async function loadOffers(path: string): Promise<OfferListing> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', rows: (await res.json()) as OfferListItem[] };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/**
 * The offer in the address: null when the server doesn't have offers yet; the 404 page for a bad id or one that isn't
 * there. Throws ApiError for anything else (the error page).
 */
export async function loadOffer(params: Promise<{ id: string }>): Promise<OfferView | null> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const res = await apiFetch(`/offers/${id}`);
  if (res.status === 401) redirect('/login');
  if (res.status === 404) {
    if (isMissingRoute(await messagesOf(res))) return null;
    notFound();
  }
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return (await res.json()) as OfferView;
}

/** GET that gives null on 404 (not available yet) and on any other failure: the form still works without it. */
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path);
    if (res.status === 401) redirect('/login');
    return res.ok ? ((await res.json()) as T) : null;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/** The kinds of allowance (Organization → Allowances); [] when there are none or they can't be read. */
export async function loadAllowanceTypes(): Promise<AllowanceType[]> {
  return (await getOrNull<AllowanceType[]>('/allowance-types')) ?? [];
}

/** What a new contract, and so a new offer, starts with: the probation and the length, in months. */
export function loadContractSettings(): Promise<ContractSettings | null> {
  return getOrNull<ContractSettings>('/contract-settings');
}
