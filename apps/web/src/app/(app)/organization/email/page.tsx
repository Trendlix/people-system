import { MAIL_SETTINGS_OWN_ACCOUNT, MAIL_SETTINGS_SUPER_ADMIN_ONLY, type MailSettingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { seesEmailSettings } from '@/lib/email-setup';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { submitMailSettings } from './actions';
import { MailSettingsForm } from './email-form';
import { mailStatus } from './settings';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"; until
// then email was set up only in the server's deploy/.env, and a change needed a redeploy). A Super Admin's only, in their
// own session: where the system's emails are sent from now, the email server and the sender (a provider preset fills
// the server), the password kept encrypted and never shown again ("Set · Replace"), and Send a test email with its
// result in plain words. While these aren't filled in and switched on, the server's deploy/.env is used, as before. The
// API refuses everyone else, a developer and a Super Admin viewing as someone too.

export const metadata: Metadata = { title: 'Email Settings · People System' };

type Loaded = { kind: 'ok'; value: MailSettingsView } | { kind: 'unavailable' } | { kind: 'failed'; messages: string[] };

/** GET /mail-settings: a refusal's own words kept (the API says why), 404 an API from before the page. */
async function loadMailSettings(): Promise<Loaded> {
  let res: Response;
  try {
    res = await apiFetch('/mail-settings');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as MailSettingsView };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

const TONE = { ok: 'bg-ok-soft text-ok', neutral: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn' } as const;

/** Where the system's emails are sent from now, and what keeps the settings below from being used. */
function Status({ view }: { view: MailSettingsView }) {
  const s = mailStatus(view);
  return (
    <section aria-labelledby="email-status" className="card p-6">
      <h2 id="email-status" className="text-lg font-semibold">
        Where Emails Are Sent From
      </h2>
      <p className={`mt-3 rounded-lg px-4 py-3 text-sm font-semibold break-words ${TONE[s.tone]}`}>{s.headline}</p>
      {s.alert && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {s.alert}
        </p>
      )}
      {s.notes.map((n) => (
        <p key={n} className="mt-2 text-sm text-muted">
          {n}
        </p>
      ))}
    </section>
  );
}

async function Gate() {
  const user = await getCurrentUser();
  if (user.developer) return <Empty>The email settings hold a mailbox and its password: they aren’t open to developers.</Empty>;
  if (!seesEmailSettings(user)) return <Empty>{MAIL_SETTINGS_SUPER_ADMIN_ONLY}</Empty>;
  if (user.viewAs) return <Empty>{MAIL_SETTINGS_OWN_ACCOUNT}</Empty>;
  const loaded = await loadMailSettings();
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server does not have the email settings yet. Please try again after its next update.</Empty>;
  if (loaded.kind === 'failed') return <Empty>The email settings could not be loaded. {loaded.messages.join(' ')}</Empty>;
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        The company mailbox the system sends its emails from: set-password links and invitations, job offers, interview invitations and the emails to
        applicants. Until these are filled in and switched on, the server’s settings (deploy/.env) are used, as before.
      </p>
      <Status view={loaded.value} />
      {/* the test goes to the Super Admin's own address unless they write another */}
      <MailSettingsForm action={submitMailSettings} view={loaded.value} testTo={user.email} />
    </div>
  );
}

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
