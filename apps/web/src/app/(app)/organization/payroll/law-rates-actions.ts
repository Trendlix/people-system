'use server';

// The rates set by law (Organization → Payroll, owner's request, 16 October 2026): the Super Admin adds a year, changes
// one or deletes one. Forwards to the API, which checks the session, that it is the Super Admin, and the rates again,
// so calling these directly can't bypass them.
import { refresh } from 'next/cache';
import { lawRatesProblems, type LawRates } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import { loadLawRateViews } from '@/lib/law-rates';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { alreadyKept, lawRatesBody } from './law-rates';

/**
 * A year's rates, added or replaced (PUT /payroll/law-rates/:year). The form sends them as worked out in the browser
 * (`rates`, JSON: rates as fractions, amounts in EGP), and `adding` when it adds a year, which must not be kept already.
 */
export async function saveLawRates(_prev: FormState, fd: FormData): Promise<FormState> {
  let rates: LawRates;
  try {
    rates = JSON.parse(String(fd.get('rates') ?? '')) as LawRates;
  } catch {
    return { errors: ['The rates could not be read. Please try again.'] };
  }
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) return { errors: ['The rates could not be read. Please try again.'] };
  const problems = lawRatesProblems(rates);
  if (problems.length) return { errors: problems };
  if (fd.get('adding') === '1') {
    // e.g. added in another tab meanwhile: saving would replace it
    const kept = await loadLawRateViews();
    if (kept.kind === 'ok' && kept.views.some((v) => v.year === rates.year)) return { errors: [alreadyKept(rates.year)] };
  }
  try {
    await apiSend('PUT', `/payroll/law-rates/${rates.year}`, lawRatesBody(rates));
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: `The rates set by law for ${rates.year} are saved. Runs made from now on use them, and a draft run when it is refreshed.` };
}

/** A year's rates deleted (DELETE /payroll/law-rates/:year): not the earliest, whose rates the years before it use. */
export async function deleteLawRates(year: number): Promise<FormState> {
  const refusal = await deleteRefusal();
  if (refusal) return { errors: refusal };
  if (!Number.isInteger(year)) return { errors: ['Choose the year to delete.'] };
  try {
    await apiSend('DELETE', `/payroll/law-rates/${year}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: `The rates set by law for ${year} are deleted.` };
}
