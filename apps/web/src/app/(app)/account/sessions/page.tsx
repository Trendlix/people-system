import { DEVICE_UNUSED_DAYS } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logout } from '@/app/login/actions';
import { FingerprintDevices } from '@/components/fingerprint-devices';
import { SessionList } from '@/components/session-list';
import { apiGet } from '@/lib/api';
import { forgetFingerprint } from '@/lib/device-actions';
import { devicesNotLoadedText } from '@/lib/fingerprint';
import { getCurrentUser } from '@/lib/session';
import { signOutSession } from '@/lib/session-actions';
import type { FingerprintDevice, OpenSession } from '@/lib/types';
import { loadJson } from '../../payroll/load';

export const metadata: Metadata = { title: 'Your Sessions · People System' };

// Your sessions (owner, 20 October 2026: "only 1 active session per user online and 1 active mobile session"): the ones
// still open, on the website and in the app, with Sign out beside each. Signing in again on the website (or the app)
// ends the one there was: the new one wins.
async function Sessions() {
  const sessions = await apiGet<OpenSession[]>('/auth/sessions');
  return (
    <section className="card p-6">
      <SessionList
        sessions={sessions}
        end={signOutSession}
        endLabel="Sign out"
        currentAction={
          <form action={logout}>
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        }
        empty="You have no other sessions open."
      />
    </section>
  );
}

// The phones that sign in to the app with a fingerprint (owner, 20 October 2026: chose Face ID / fingerprint sign-in for
// the app; README: "profile → Devices with Sign out"): each with Sign out. In the app, the phone this page is shown on is
// marked, and offers Turn on for this phone on an app session; not while viewing as someone (the phone is the viewer's).
// An API from before fingerprint sign-in answers 404: said in its place, the sessions above still shown.
async function Fingerprints() {
  const [user, devices] = await Promise.all([getCurrentUser(), loadJson<FingerprintDevice[]>('/auth/devices')]);
  const own = !user.viewAs;
  return (
    <section aria-labelledby="fingerprint-heading" className="card space-y-4 p-6">
      <div>
        <h2 id="fingerprint-heading" className="font-semibold">
          Fingerprint Sign-In
        </h2>
        <p className="mt-1 text-sm text-muted">
          Fingerprint sign-in is turned on in the TrendLIX People app, after signing in there with your password. A phone
          stops signing in with it after {DEVICE_UNUSED_DAYS} days without use, and every phone does when your password
          changes: the password is asked for then.
        </p>
      </div>
      {devices.kind === 'ok' ? (
        <FingerprintDevices
          devices={devices.value}
          end={forgetFingerprint}
          thisPhone={own}
          canTurnOn={own && user.session?.kind === 'app'}
          empty="No phone signs in with a fingerprint."
        />
      ) : (
        <p className="text-sm text-muted">{devicesNotLoadedText(devices)}</p>
      )}
    </section>
  );
}

export default function YourSessionsPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Your Sessions</h1>
        <p className="mt-1 text-muted">
          You can be signed in once on the website and once in the app. Signing in again on another device signs the older
          one out. Sign out of any you don’t recognise, then change your password: that signs out your other sessions and
          turns off fingerprint sign-in on your phones.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Sessions />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Fingerprints />
      </Suspense>
    </div>
  );
}
