import 'server-only';
import { cache } from 'react';
import type { MyResignation, ResignationRequestView } from '@/lib/resignation-types';
import { loadJson, type Loaded } from '../payroll/load';
import { resignationsApiPath, type ResignationFilter } from './resignation';

// Reading resignation requests (owner, 26 October 2026): the employee's own with the form's facts (My Requests), those the
// caller sees (HR, the CEO and a Super Admin: all; a direct manager: their reports'), and one for its page. An API from
// before them answers 404: "not available yet".

export type { Loaded };

/** GET /me/resignation. Read once a request. */
export const loadMyResignation = cache(() => loadJson<MyResignation>('/me/resignation'));

/** GET /resignation-requests: by the list's filter. */
export const loadResignations = (filter: ResignationFilter): Promise<Loaded<ResignationRequestView[]>> => loadJson(resignationsApiPath(filter));

/** The requests of the caller's team, for a direct manager's My Team. Read once a request. */
export const loadTeamResignations = cache(() => loadJson<ResignationRequestView[]>('/resignation-requests?status=sent'));

/** GET /resignation-requests/:id. */
export const loadResignation = (id: string): Promise<Loaded<ResignationRequestView>> => loadJson(`/resignation-requests/${encodeURIComponent(id)}`);
