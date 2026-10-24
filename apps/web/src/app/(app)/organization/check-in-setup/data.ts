import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { CheckInLocationView, LinkablePersonView, LocationRuleView, OfficeNetworksView } from '@/lib/attendance-types';
import type { MapsSettingsView } from '@trendlix/shared';
import type { PayrollSettingsView } from '@/lib/types';
import { loadJson, type Loaded } from '../../payroll/load';

// What Attendance → Check-in Setup reads (owner, 20 October 2026: "Own page, several locations"), each once a request.
// The networks are read with the visitor's address signed (lib/api.ts, signIp), so the API can say whether the lock is
// ready from this very page. An API from before a part answers 404: that section says it isn't there yet.

/** GET /attendance/check-in-setup/locations: the main office first, then the sub-locations with their people. */
export const loadLocations = cache(() => loadJson<CheckInLocationView[]>('/attendance/check-in-setup/locations'));

/** GET /attendance/check-in-setup/people: whom a sub-location's "Link people" offers (owner, 20 October 2026: "shown with their name and linked users"). */
export const loadLinkable = cache(() => loadJson<LinkablePersonView[]>('/attendance/check-in-setup/people'));

/** GET /attendance/check-in-setup/networks, the visitor's address signed. */
export const loadNetworks = cache(async (): Promise<Loaded<OfficeNetworksView>> => {
  let res: Response;
  try {
    res = await apiFetch('/attendance/check-in-setup/networks', undefined, { signIp: true });
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as OfficeNetworksView };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
});

/** GET /attendance/check-in-setup/location-rule: whether presses without a location are refused (20 October 2026). */
export const loadLocationRule = cache(() => loadJson<LocationRuleView>('/attendance/check-in-setup/location-rule'));

/** GET /payroll/settings: Zoho People's check-in addresses are kept there. */
export const loadSettings = cache(() => loadJson<PayrollSettingsView>('/payroll/settings'));

/** GET /maps-settings: the Google Maps key's last four characters and the Map ID (owner, 24 October 2026: "Google Maps"), a Super Admin's. */
export const loadMapsSettings = cache(() => loadJson<MapsSettingsView>('/maps-settings'));
