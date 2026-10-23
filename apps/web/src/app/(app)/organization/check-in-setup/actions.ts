'use server';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): adding, changing and removing a
// check-in location, saving the office networks with the lock (check-ins locked to the office network, the same day),
// the switch refusing presses without a location (the same day: "Company switch + exceptions"), and Zoho People's
// check-in addresses. Each forwards to the API, which checks the role (HR and Admin; a Super Admin
// removes a location) and the values again, so calling these directly can't bypass them. The networks are saved with the
// visitor's address signed, as the API switches the lock on only when the website's signature arrives. The main office
// and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations are like sub
// locations. shown with their name and linked users"): Make main, and linking and unlinking a sub-location's people, HR's
// and Admin's (a C-level person only by those who see them: the API answers 404 to anyone else).
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { CheckInLocationView } from '@/lib/attendance-types';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { addedText, addressesBody, locationBody, locationRuleBody, locationRuleSaved, networksBody } from './setup';

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

/** `message`: what to say once done, or worked out from the API's answer. */
async function send<T>(fd: FormData | null, request: () => Promise<T>, message: string | ((answer: T) => string)): Promise<FormState> {
  let answer: T;
  try {
    answer = await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: fd ? submitted(fd) : undefined };
    throw err;
  }
  refresh();
  return { message: typeof message === 'function' ? message(answer) : message };
}

const LOCATIONS = '/attendance/check-in-setup/locations';
const at = (id: string) => `${LOCATIONS}/${encodeURIComponent(id)}`;

/** A new location (POST /attendance/check-in-setup/locations): the first added is the main office, every later one a sub-location. */
export async function createLocation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = locationBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(
    fd,
    () => apiSend<CheckInLocationView>('POST', LOCATIONS, body),
    (made) => addedText(body.name, made?.isMain ?? false),
  );
}

/** This location made the main office, the main until now a sub-location (POST …/locations/:id/make-main). */
export async function makeMain(id: string, name: string): Promise<FormState> {
  return send(null, () => apiSend('POST', `${at(id)}/make-main`), `${name} is the main office now: check-ins within it count as Office.`);
}

/** People linked to a sub-location (POST …/locations/:id/people { employeeIds }), the ids chosen in the picker. */
export async function linkPeople(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const employeeIds = [...new Set(fd.getAll('employeeId').map(String).filter(Boolean))];
  if (!employeeIds.length) return { errors: ['Choose at least one person to link.'] };
  return send(null, () => apiSend('POST', `${at(id)}/people`, { employeeIds }), employeeIds.length === 1 ? 'Linked.' : `Linked ${employeeIds.length} people.`);
}

/** A person unlinked from a sub-location (POST …/locations/:id/people/:employeeId/unlink): not a deletion, HR's and Admin's. */
export async function unlinkPerson(id: string, employeeId: string, name: string, place: string): Promise<FormState> {
  return send(
    null,
    () => apiSend('POST', `${at(id)}/people/${encodeURIComponent(employeeId)}/unlink`),
    `Unlinked ${name} from ${place}.`,
  );
}

/** A location changed (PATCH /attendance/check-in-setup/locations/:id). */
export async function updateLocation(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = locationBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(fd, () => apiSend('PATCH', at(id), body), `Saved ${body.name}.`);
}

/** Removes a location (DELETE): a Super Admin only; anyone else is refused first. The main office only once it is the last (the API says so). */
export async function removeLocation(id: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return send(null, () => apiSend('DELETE', at(id)), 'Removed.');
}

/** The office networks and the lock (PUT /attendance/check-in-setup/networks), the visitor's address signed. */
export async function saveNetworks(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = networksBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(
    fd,
    () => apiSend('PUT', '/attendance/check-in-setup/networks', body, { signIp: true }),
    body.lock ? 'Saved. Office staff now check in and out on the office network only.' : 'Saved. Check-ins aren’t locked to the office network.',
  );
}

/** The switch refusing presses without a location (PUT /attendance/check-in-setup/location-rule). */
export async function saveLocationRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const body = locationRuleBody(fd);
  return send(fd, () => apiSend('PUT', '/attendance/check-in-setup/location-rule', body), locationRuleSaved(body.refuseWithoutLocation));
}

/** Zoho People's check-in addresses (PATCH /payroll/settings { officeAddresses }). */
export async function saveZohoAddresses(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = addressesBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(fd, () => apiSend('PATCH', '/payroll/settings', body), 'Saved. The next Zoho People import reads check-ins with these.');
}
