import 'server-only';
import { cache } from 'react';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import type { CorrectionCounts } from '@/lib/correction-types';
import type { LeaveCounts, ReimbursementCounts } from '@/lib/types';
import { getOrNull } from '../../(app)/approvals/data';
import { decidesRaises, PENDING_RAISES } from '../../(app)/approvals/raises';
import { CORRECTION_COUNTS } from '../../(app)/attendance/corrections/corrections';
import { LEAVE_COUNTS } from '../../(app)/leave/list';
import { countsRaiseRequests, waitingForYouCount, WITH_HR_REQUESTS } from '../../(app)/raise-requests/list';
import { CLAIM_COUNTS } from '../../(app)/reimbursements/list';
import { decidesSomething } from './tabs';

// How many things wait for the caller on To Approve (owner, 20 October 2026: the employee app, "managers and team leads
// approve from the phone"), beside its tab: the counts the sidebar reads (app/(app)/layout.tsx), the leave with the
// permission requests, the claims, the corrections, the raise requests at HR's step that wait for them, and the raises
// with the CEO for the CEO. What can't be read counts none.

// counts, as the sidebar's: they don't count as activity for the 15 minutes (lib/api.ts, 20 October 2026)
const BACKGROUND = { background: true } as const;

type Decider = Parameters<typeof decidesSomething>[0] & Parameters<typeof waitingForYouCount>[0];

/** Read once a request (the tab bar and Home both say it): `user` is getCurrentUser's, the same object all through it. */
export const approveCount = cache(async (user: Decider): Promise<number> => {
  if (!decidesSomething(user)) return 0;
  const [leave, claims, corrections, requests, raises] = await Promise.all([
    getOrNull<LeaveCounts>(LEAVE_COUNTS, BACKGROUND),
    getOrNull<ReimbursementCounts>(CLAIM_COUNTS, BACKGROUND),
    getOrNull<CorrectionCounts>(CORRECTION_COUNTS, BACKGROUND),
    countsRaiseRequests(user) ? getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS, BACKGROUND) : null,
    decidesRaises(user) ? getOrNull<PendingRaise[]>(PENDING_RAISES, BACKGROUND) : null,
  ]);
  return (leave?.waiting ?? 0) + (claims?.waiting ?? 0) + (corrections?.waiting ?? 0) + (requests ? waitingForYouCount(user, requests) : 0) + (raises?.length ?? 0);
});
