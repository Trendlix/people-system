import 'server-only';
import { redirect } from 'next/navigation';
import { BUILT_IN_LAW_RATES, normalLawRates, type LawRates } from '@trendlix/shared';
import { ApiError, apiFetch, messagesOf } from './api';
import type { LawRatesView } from './types';

// The rates set by law, by year (owner's request, 16 October 2026): the social insurance shares and limits, the
// personal exemption, the Martyrs' Fund, health insurance and the salary tax's tiers, which the Super Admin keeps in
// Organization → Payroll. The contract and offer forms and the Salary Calculator estimate the net with them in the
// browser; the Rates Set by Law section lists them.

export type LawRatesLoaded =
  | { kind: 'ok'; views: LawRatesView[] }
  /** An API from before them (404). */
  | { kind: 'unavailable' }
  /** Not for this user (403): HR, Finance, the CEO, Admin and the Super Admin read them. */
  | { kind: 'forbidden' }
  | { kind: 'failed'; message: string };

/** GET /payroll/law-rates, oldest year first; signs out on 401. */
export async function loadLawRateViews(): Promise<LawRatesLoaded> {
  let res: Response;
  try {
    res = await apiFetch('/payroll/law-rates');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    const views = (await res.json()) as LawRatesView[];
    if (!Array.isArray(views)) return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
    return { kind: 'ok', views: [...views].sort((a, b) => a.year - b.year) };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/**
 * The years' rates for the salary estimates (the contract and offer forms, the Salary Calculator), oldest first: the
 * ones kept, else the built-in ones (Law 7/2024 and NOSI's limits of 2025 and 2026) when the API has none, is from
 * before them (404), refuses this user (403) or fails. Falling back is safe: the estimates are previews, and the API
 * works the net and the insured salary out again with its own rates when it saves.
 */
export async function loadLawRates(): Promise<LawRates[]> {
  const loaded = await loadLawRateViews();
  // only the rates go to the browser, not who changed them
  if (loaded.kind === 'ok' && loaded.views.length > 0) return loaded.views.map(normalLawRates);
  return BUILT_IN_LAW_RATES.map(normalLawRates);
}
