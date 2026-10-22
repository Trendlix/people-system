import { ASSETS_ACCESS_HINTS, ASSETS_ACCESS_LABELS, ROLES } from '@trendlix/shared';
import Link from 'next/link';
import { FingerprintDevices } from '@/components/fingerprint-devices';
import { SessionList } from '@/components/session-list';
import { devicesNotLoadedText } from '@/lib/fingerprint';
import { assignableRoles, canChangeAccount, isSuperAdmin } from '@/lib/roles';
import type { FingerprintDevice, OpenSession, SessionUser, UserAccount } from '@/lib/types';
import type { Loaded } from '../payroll/load';
import { accessInEffectText, ASSETS_VALUES_NOTE } from '../assets/assets';
import { endUserSession, endUserSessions, setActive, setPassword, signOutUserDevice, signOutUserDevices, updateAssetsAccess, updateRoles } from './actions';
import { ONLY_SUPER_ADMIN_CHANGES, RoleBadges } from './ui';
import { AssetsAccessForm, EndSessionsForm, PasswordForm, RolesForm, SignOutDevicesForm, StatusForm } from './user-forms';

// An account's tools, an Admin's and a Super Admin's (the Users page's): its roles, Assets access, turning it off and on,
// its sessions and its phones' fingerprint sign-in, and (accounts that aren't an employee's) a temporary password. Shown
// on the Users page's account page, and on an employee's profile's Access tab for their account (owner, 22 October
// 2026: "On the employee profile"), where a password is set by a link instead (the Access tab's buttons).

export function AccountPanel({
  me,
  user,
  sessions,
  devices,
  temporaryPassword,
}: {
  me: SessionUser;
  user: UserAccount;
  sessions: OpenSession[];
  devices: Loaded<FingerprintDevice[]>;
  /** The temporary password form: accounts that aren't an employee's (theirs is set with a link). */
  temporaryPassword: boolean;
}) {
  const id = user.id;
  const self = me.id === user.id;
  // A Super Admin's roles, active flag and password are a Super Admin's to change: an Admin sees them read-only (the
  // API refuses with 403). Only a Super Admin is offered the Super Admin role.
  const mayChange = canChangeAccount(me, user);
  const rolesHint = !self
    ? 'Changes apply straight away, even if they are signed in.'
    : isSuperAdmin(user)
      ? 'This is your own account: you cannot remove your own admin rights, and the last active Super Admin keeps that role.'
      : 'This is your own account: you cannot remove your own Admin role.';

  return (
    <>
      {mayChange ? (
        <RolesForm action={updateRoles.bind(null, id)} roles={user.roles} choices={assignableRoles(me, ROLES)} hint={rolesHint} />
      ) : (
        <section className="card max-w-xl space-y-3 p-6">
          <h3 className="font-semibold">Roles</h3>
          <RoleBadges roles={user.roles} />
          <p className="text-sm text-muted">{ONLY_SUPER_ADMIN_CHANGES}</p>
        </section>
      )}

      {/* Assets access (owner, 21 October 2026: "i want to add this module with a special permission to the system",
          "3 levels per user"): an Admin or a Super Admin sets it, audited; an API from before Assets sends none */}
      {user.assetsAccess !== undefined &&
        (mayChange ? (
          <AssetsAccessForm
            action={updateAssetsAccess.bind(null, id)}
            saved={user.assetsAccess}
            inEffectNote={accessInEffectText(user.assetsAccess, user.assetsAccessInEffect ?? user.assetsAccess, user.roles)}
          />
        ) : (
          <section className="card max-w-xl space-y-3 p-6">
            <h3 className="font-semibold">Assets Access</h3>
            <p className="text-sm">
              <span className="font-medium">{ASSETS_ACCESS_LABELS[user.assetsAccessInEffect ?? user.assetsAccess]}</span>
              <span className="block text-muted">{ASSETS_ACCESS_HINTS[user.assetsAccessInEffect ?? user.assetsAccess]}</span>
            </p>
            <p className="hint">{ASSETS_VALUES_NOTE}</p>
            <p className="text-sm text-muted">{ONLY_SUPER_ADMIN_CHANGES}</p>
          </section>
        ))}

      {mayChange && (
        <section className="card max-w-xl space-y-3 p-6">
          <h3 className="font-semibold">{user.isActive ? 'Deactivate' : 'Reactivate'}</h3>
          {self ? (
            <p className="text-sm text-muted">You cannot deactivate your own account. Another admin can do it.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {user.isActive
                  ? 'Deactivating signs them out at once and stops them signing in. Nothing else is deleted, and you can reactivate the account later.'
                  : 'This account is deactivated: they cannot sign in.'}
              </p>
              <StatusForm action={setActive.bind(null, id)} active={user.isActive} email={user.email} />
            </>
          )}
        </section>
      )}

      {/* the sessions still open, on the website and in the app (owner, 20 October 2026: one of each a user, kept on
          the server): an Admin ends them, one or all; a Super Admin's, only a Super Admin. One's own: Your Sessions. */}
      <section className="card max-w-xl space-y-4 p-6">
        <div>
          <h3 className="font-semibold">Sessions</h3>
          <p className="mt-1 text-sm text-muted">
            {self ? (
              <>
                Your own sessions are on <Link href="/account/sessions">Your Sessions</Link>.
              </>
            ) : (
              'Where they are signed in now: once on the website and once in the app at most. Ending a session signs them out there at once.'
            )}
          </p>
        </div>
        {!self && (
          <>
            <SessionList
              sessions={sessions}
              end={mayChange ? endUserSession.bind(null, id) : undefined}
              endLabel="End session"
              empty="They are not signed in anywhere."
            />
            {mayChange && sessions.length > 0 && <EndSessionsForm action={endUserSessions.bind(null, id)} email={user.email} />}
          </>
        )}
      </section>

      {/* the phones that sign in to the app with their fingerprint (owner, 20 October 2026: chose Face ID / fingerprint
          sign-in for the app): an Admin signs them out, one or all; a Super Admin's, only a Super Admin. One's own:
          Your Sessions. */}
      <section className="card max-w-xl space-y-4 p-6">
        <div>
          <h3 className="font-semibold">Fingerprint Sign-In</h3>
          <p className="mt-1 text-sm text-muted">
            {self ? (
              <>
                Your own phones are on <Link href="/account/sessions">Your Sessions</Link>.
              </>
            ) : (
              'The phones they sign in to the Trendlix People app on with a fingerprint. Signing a phone out asks for their password there next time.'
            )}
          </p>
        </div>
        {!self &&
          (devices.kind === 'ok' ? (
            <>
              <FingerprintDevices
                devices={devices.value}
                end={mayChange ? signOutUserDevice.bind(null, id) : undefined}
                empty="No phone signs in with their fingerprint."
              />
              {mayChange && devices.value.length > 0 && <SignOutDevicesForm action={signOutUserDevices.bind(null, id)} email={user.email} />}
            </>
          ) : (
            <p className="text-sm text-muted">{devicesNotLoadedText(devices)}</p>
          ))}
      </section>

      {mayChange &&
        temporaryPassword &&
        (self ? (
          <section className="card max-w-xl p-6">
            <h3 className="font-semibold">Password</h3>
            <p className="mt-1 text-sm text-muted">
              To change your own password, use <Link href="/account/password">Change password</Link>.
            </p>
          </section>
        ) : (
          <PasswordForm action={setPassword.bind(null, id)} email={user.email} />
        ))}
    </>
  );
}
