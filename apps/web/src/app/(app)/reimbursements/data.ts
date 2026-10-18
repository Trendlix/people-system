import 'server-only';
import { cache } from 'react';
import type { MyReimbursementType, ReimbursementClaimView } from '@/lib/types';
import { loadJson, type Loaded } from '../payroll/load';
import { claimsPath, WAITING_CLAIMS, type ClaimFilter } from './list';

// Reading reimbursement claims (owner, 18 October 2026): every claim for Requests → Reimbursements, the employee's own
// for My Requests, those waiting for a direct manager for My Team and the dashboard, one claim for its page, and the
// types the employee may claim for the new claim form. An API from before them answers 404, which here means "not
// available yet" rather than the 404 page, so the rest of the page keeps working.

export type { Loaded };

/** GET /reimbursements (HR, Finance and the CEO everyone's; a direct manager their reports'), newest first, by the filter. */
export function loadClaims(filter: ClaimFilter): Promise<Loaded<ReimbursementClaimView[]>> {
  return loadJson<ReimbursementClaimView[]>(claimsPath(filter));
}

/** GET /reimbursements?status=waiting: the claims waiting for the caller. Read once a request (My Team, the dashboard). */
export const loadWaitingClaims = cache(() => loadJson<ReimbursementClaimView[]>(WAITING_CLAIMS));

/** GET /me/reimbursements: the employee's own claims, newest first. Read once a request (My Requests, the dashboard). */
export const loadMyClaims = cache(() => loadJson<ReimbursementClaimView[]>('/me/reimbursements'));

/** GET /reimbursements/:id: one claim, for the claimant, their manager, HR, Finance and the CEO; anyone else gets 404. */
export function loadClaim(id: string): Promise<Loaded<ReimbursementClaimView>> {
  return loadJson<ReimbursementClaimView>(`/reimbursements/${encodeURIComponent(id)}`);
}

/**
 * GET /me/reimbursement-types?expenseDate=: the active types the employee may claim, each with what their claims of it
 * already take of its caps in that date's month and year (YYYY-MM-DD).
 */
export function loadMyTypes(expenseDate: string): Promise<Loaded<MyReimbursementType[]>> {
  return loadJson<MyReimbursementType[]>(`/me/reimbursement-types?expenseDate=${encodeURIComponent(expenseDate)}`);
}
