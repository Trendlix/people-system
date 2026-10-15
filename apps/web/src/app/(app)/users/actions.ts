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

export async function setActive(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const isActive = text(fd, 'isActive') === 'true';
  return change(
    () => apiSend('PATCH', `/users/${id}`, { isActive }),
    isActive ? 'User reactivated. They can sign in again.' : 'User deactivated. They have been signed out and cannot sign in.',
  );
}

export async function setPassword(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return change(
    () => apiSend('PUT', `/users/${id}/password`, { password: text(fd, 'password') }),
    'New temporary password set. Pass it on to the person; they should change it after signing in.',
  );
}
