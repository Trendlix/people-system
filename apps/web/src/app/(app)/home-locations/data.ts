import 'server-only';
import { cache } from 'react';
import type { HomeLocationCounts, HomeLocationView } from '@/lib/home-location-types';
import { loadJson, type Loaded } from '../payroll/load';
import type { HomeType } from '@trendlix/shared';
import { APPROVED_HOMES, employeeHomeApi, employeePlacesApi, HOME_COUNTS, homeApi, homesApi, MY_HOMES_API, WAITING_HOMES } from './home-locations';

// Reading home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"): the employee's own (My Requests), those waiting for the caller (Approvals, To Approve), the approved ones
// (Check-in Setup, a profile), one for its page. An API from before them answers 404: "not available yet". Managers and
// Finance are refused (403) by the API.

export type { Loaded };

/** GET /me/home-locations: the employee's own, newest first. Read once a request. */
export const loadMyHomes = cache(() => loadJson<HomeLocationView[]>(MY_HOMES_API));

/** Those waiting for the caller's decision (HR's step, the CEO's). Read once a request. */
export const loadWaitingHomes = cache(() => loadJson<HomeLocationView[]>(WAITING_HOMES));

/** The approved homes the caller sees (HR not a C-level person's), the latest approved first. */
export const loadApprovedHomes = () => loadJson<HomeLocationView[]>(APPROVED_HOMES);

/** A person's approved home (none, or a list of one); 404 for a C-level person's to HR. */
export const loadEmployeeHome = (employeeId: string) => loadJson<HomeLocationView[]>(employeeHomeApi(employeeId));

/** Every request of a person's (24 October 2026), for their profile's places; 404 for a C-level person's to HR. */
export const loadEmployeePlaces = (employeeId: string) => loadJson<HomeLocationView[]>(employeePlacesApi(employeeId));

/** HR's list of requests (Check-in Setup, 24 October 2026): of a status and a type, all unless given. */
export const loadHomeRequests = (q: { status?: string; type?: HomeType } = {}) => loadJson<HomeLocationView[]>(homesApi(q));

/** { waiting }: how many wait for the caller. */
export const loadHomeCounts = cache(() => loadJson<HomeLocationCounts>(HOME_COUNTS));

/** GET /home-locations/:id: for the employee, HR, the CEO and the Super Admin; anyone else gets 404. */
export const loadHome = (id: string): Promise<Loaded<HomeLocationView>> => loadJson(homeApi(id));
