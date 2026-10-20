import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logout } from '@/app/login/actions';
import { SessionList } from '@/components/session-list';
import { apiGet } from '@/lib/api';
import { signOutSession } from '@/lib/session-actions';
import type { OpenSession } from '@/lib/types';

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

export default function YourSessionsPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Your Sessions</h1>
        <p className="mt-1 text-muted">
          You can be signed in once on the website and once in the app. Signing in again on another device signs the older
          one out. Sign out of any you don’t recognise, then change your password.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Sessions />
      </Suspense>
    </div>
  );
}
