'use server';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): adding, changing and removing a
// check-in location, saving the office networks with the lock (check-ins locked to the office network, the same day),
// the switch refusing presses without a location (the same day: "Company switch + exceptions"), and Zoho People's
// check-in addresses. Each forwards to the API, which checks the role (HR and Admin; a Super Admin
// removes a location) and the values again, so calling these directly can't bypass them. The networks are saved with the
// visitor's address signed, as the API switches the lock on only when the website's signature arrives.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { addressesBody, locationBody, locationRuleBody, locationRuleSaved, networksBody } from './setup';

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

async function send(fd: FormData | null, request: () => Promise<unknown>, message: string): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: fd ? submitted(fd) : undefined };
    throw err;
  }
  refresh();
  return { message };
}

/** A new location (POST /attendance/check-in-setup/locations). */
export async function createLocation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = locationBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(fd, () => apiSend('POST', '/attendance/check-in-setup/locations', body), `Added ${body.name}. Check-ins within it count as at the office from now on.`);
}

/** A location changed (PATCH /attendance/check-in-setup/locations/:id). */
export async function updateLocation(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = locationBody(fd);
  if (problems.length) return { errors: problems, values: submitted(fd) };
  return send(fd, () => apiSend('PATCH', `/attendance/check-in-setup/locations/${encodeURIComponent(id)}`, body), `Saved ${body.name}.`);
}

/** Removes a location (DELETE): a Super Admin only; anyone else is refused first. */
export async function removeLocation(id: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return send(null, () => apiSend('DELETE', `/attendance/check-in-setup/locations/${encodeURIComponent(id)}`), 'Removed.');
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
