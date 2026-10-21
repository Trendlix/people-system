'use server';

// Form actions for the Users pages. Each one forwards to the API, which only lets Admins and Super Admins manage users,
// and only a Super Admin grant or remove the Super Admin role or change a Super Admin's account, so calling these
// directly can't bypass permissions. Its refusals (403, and 409 for the last active Super Admin) show on the forms.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');
const roles = (fd: FormData) => fd.getAll('roles').map(String);

/** Sends the change; on success shows `message` and reloads the page's data, else the API's reasons. */
async function change(request: () => Promise<unknown>, message: string, values?: FormState['values']): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  return { message };
}

export async function createUser(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await apiSend('POST', '/users', { email: text(fd, 'email'), password: text(fd, 'password'), roles: roles(fd) });
  } catch (err) {
    // The password is not sent back to refill the form: it has to be typed again.
    if (err instanceof ApiError) return { errors: err.messages, values: { email: text(fd, 'email'), roles: roles(fd) } };
    throw err;
  }
  redirect('/users');
}

export async function updateRoles(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return change(() => apiSend('PATCH', `/users/${id}`, { roles: roles(fd) }), 'Roles saved. They apply straight away.', {
    roles: roles(fd),
  });
}

/**
 * The user's Assets access (owner, 21 October 2026: "3 levels per user"): none, viewer, custodian or manager. Audited by
 * the API; a Super Admin's account is a Super Admin's to change (403 for an Admin).
 */
export async function updateAssetsAccess(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const assetsAccess = text(fd, 'assetsAccess');
  return change(() => apiSend('PATCH', `/users/${id}`, { assetsAccess }), 'Assets access saved. It applies straight away.', { assetsAccess });
}

export async function setActive(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const isActive = text(fd, 'isActive') === 'true';
  return change(
    () => apiSend('PATCH', `/users/${id}`, { isActive }),
    isActive ? 'User reactivated. They can sign in again.' : 'User deactivated. They have been signed out and cannot sign in.',
  );
}

/** A reset also turns off fingerprint sign-in on their phones (20 October 2026): the API revokes the credentials. */
export async function setPassword(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return change(
    () => apiSend('PUT', `/users/${id}/password`, { password: text(fd, 'password') }),
    'New temporary password set, and fingerprint sign-in turned off on their phones. Pass it on to the person; they should change it after signing in.',
  );
}

/**
 * Ends every session the user has open, on the website and in the app (owner, 20 October 2026: sessions kept on the
 * server): they are signed out at once. The API refuses an Admin on a Super Admin's account (403).
 */
export async function endUserSessions(id: string): Promise<FormState> {
  let ended = 0;
  try {
    ended = (await apiSend<{ ended: number }>('POST', `/users/${id}/sessions/end`))?.ended ?? 0;
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: ended === 1 ? 'Session ended. They have been signed out.' : ended ? `${ended} sessions ended. They have been signed out.` : 'They had no sessions open.' };
}

/** Ends one of the user's sessions, as listed on their page. */
export async function endUserSession(id: string, sessionId: string): Promise<{ error?: string }> {
  try {
    await apiSend('POST', `/users/${id}/sessions/${encodeURIComponent(sessionId)}/end`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  refresh();
  return {};
}

/**
 * Turns off fingerprint sign-in on every phone of the user's (owner, 20 October 2026: chose Face ID / fingerprint sign-in
 * for the app): each asks for the password next time. The API refuses an Admin on a Super Admin's account (403).
 */
export async function signOutUserDevices(id: string): Promise<FormState> {
  let revoked = 0;
  try {
    revoked = (await apiSend<{ revoked: number }>('POST', `/users/${id}/devices/revoke`))?.revoked ?? 0;
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return {
    message:
      revoked === 1
        ? 'Fingerprint sign-in turned off on 1 phone.'
        : revoked
          ? `Fingerprint sign-in turned off on ${revoked} phones.`
          : 'They had no phones with fingerprint sign-in.',
  };
}

/** Turns off fingerprint sign-in on one of the user's phones, as listed on their page. */
export async function signOutUserDevice(id: string, deviceId: string): Promise<{ error?: string }> {
  try {
    await apiSend('POST', `/users/${id}/devices/${encodeURIComponent(deviceId)}/revoke`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  refresh();
  return {};
}
