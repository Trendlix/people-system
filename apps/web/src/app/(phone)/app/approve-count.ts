import 'server-only';
import { cache } from 'react';
import type { KpiCounts } from '@trendlix/shared';
import { KPI_API } from '@/lib/kpi-paths';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import type { CorrectionCounts } from '@/lib/correction-types';
import type { HomeLocationCounts } from '@/lib/home-location-types';
import type { LeaveCounts, ReimbursementCounts } from '@/lib/types';
import type { WfhCounts } from '@/lib/wfh-types';
import type { OdCounts } from '@/lib/od-types';
import { getOrNull } from '../../(app)/approvals/data';
import { decidesRaises, PENDING_RAISES } from '../../(app)/approvals/raises';
import { CORRECTION_COUNTS } from '../../(app)/attendance/corrections/corrections';
import { WFH_COUNTS } from '../../(app)/attendance/wfh/wfh';
import { OD_COUNTS } from '../../(app)/attendance/official-duty/od';
import { HOME_COUNTS, seesHomes } from '../../(app)/home-locations/home-locations';
import { LEAVE_COUNTS } from '../../(app)/leave/list';
import { countsRaiseRequests, waitingForYouCount, WITH_HR_REQUESTS } from '../../(app)/raise-requests/list';
import { CLAIM_COUNTS } from '../../(app)/reimbursements/list';
import { decidesSomething } from './tabs';

// How many things wait for the caller on To Approve (owner, 20 October 2026: the employee app, "managers and team leads
// approve from the phone"), beside its tab: the counts the sidebar reads (app/(app)/layout.tsx), the leave with the
// permission requests, the claims, the corrections, the raise requests at HR's step that wait for them, and the raises
// with the CEO for the CEO, and the home locations at the caller's step (owner, 20 October 2026: "then approved by the HR
// and CEO") for HR, the CEO and the Super Admin, and the KPI scorecards waiting for the caller's step on someone else's
// (owner, 21 October 2026: "Self, manager, HR, sign-off"): their people's to score or sign, and HR's to calibrate, and the
// work from home requests at the caller's step (owner, 21 October 2026: "Manager, then HR"), and the official duty
// requests the same (owner, 23 October 2026). What can't be read counts none.

// counts, as the sidebar's: they don't count as activity for the 15 minutes (lib/api.ts, 20 October 2026)
const BACKGROUND = { background: true } as const;

type Decider = Parameters<typeof decidesSomething>[0] & Parameters<typeof waitingForYouCount>[0];

/** Read once a request (the tab bar and Home both say it): `user` is getCurrentUser's, the same object all through it. */
export const approveCount = cache(async (user: Decider): Promise<number> => {
  if (!decidesSomething(user)) return 0;
  const [leave, claims, corrections, requests, raises, homes, kpis, wfh, od] = await Promise.all([
    getOrNull<LeaveCounts>(LEAVE_COUNTS, BACKGROUND),
    getOrNull<ReimbursementCounts>(CLAIM_COUNTS, BACKGROUND),
    getOrNull<CorrectionCounts>(CORRECTION_COUNTS, BACKGROUND),
    countsRaiseRequests(user) ? getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS, BACKGROUND) : null,
    decidesRaises(user) ? getOrNull<PendingRaise[]>(PENDING_RAISES, BACKGROUND) : null,
    seesHomes(user) ? getOrNull<HomeLocationCounts>(HOME_COUNTS, BACKGROUND) : null,
    getOrNull<KpiCounts>(KPI_API.counts, BACKGROUND),
    getOrNull<WfhCounts>(WFH_COUNTS, BACKGROUND),
    getOrNull<OdCounts>(OD_COUNTS, BACKGROUND),
  ]);
  return (
    (leave?.waiting ?? 0) +
    (claims?.waiting ?? 0) +
    (corrections?.waiting ?? 0) +
    (requests ? waitingForYouCount(user, requests) : 0) +
    (raises?.length ?? 0) +
    (homes?.waiting ?? 0) +
    (kpis?.team ?? 0) +
    (kpis?.hr ?? 0) +
    (wfh?.waiting ?? 0) +
    (od?.waiting ?? 0)
  );
});
