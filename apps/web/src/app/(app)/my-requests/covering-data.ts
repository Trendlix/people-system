import 'server-only';
import { cache } from 'react';
import type { CoverAssignment } from '@trendlix/shared';
import { loadJson } from '../payroll/load';

// "I'm Covering" (owner, 25 October 2026: "Required over 2 days"): the colleagues' leave the signed-in person covers,
// current or to come, approved or being decided, with the handover notes (never the leave's type). An API from before it
// answers 404: "not available yet", and the section and the card are left out.

/** GET /me/leave/covering, read once a request (My Requests and the dashboard). */
export const loadMyCovering = cache(() => loadJson<CoverAssignment[]>('/me/leave/covering'));
