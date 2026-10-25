import { WHATSAPP_SETTINGS_OWN_ACCOUNT, WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY, type MyWhatsAppView, type WhatsAppSettingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { seesWhatsAppSettings } from '@/lib/whatsapp';
import { Empty, Loading } from '../ui';
import { submitWhatsAppSettings } from './actions';
import { whatsappStatus } from './settings';
import { WhatsAppSettingsForm } from './whatsapp-form';

// Organization → Company → WhatsApp (owner, 24 October 2026: "how to make whatsapp notifications?"; after the explanation
// of Meta's business verification, a dedicated number, approved templates, opt-in and per-message fees, they chose
// "Employees and candidates", "Approvals waiting, Request decisions, Check-in reminders, Interviews" and "Directly to
// Meta"). A Super Admin's only, in their own session: whether WhatsApp messages go out now, the owner's six steps in
// Meta, the connection (its token and app secret kept encrypted, never shown again), quiet hours and the switch, Send a
// test message with Meta's answer in plain words, and the templates, submitted and synced. WhatsApp is added to the
// bell, push and email, never in their place. The API refuses everyone else, a developer and a Super Admin viewing as
// someone too. Since 25 October 2026 ("Add Twilio as a choice"): sent through Meta directly or Twilio; the form shows
// the steps, connection and templates of the one chosen (whatsapp-form.tsx).

export const metadata: Metadata = { title: 'WhatsApp · People System' };

type Loaded<T> = { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'failed'; messages: string[] };

/** A GET, a refusal's own words kept (the API says why), 404 an API from before the page. */
async function load<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

const TONE = { ok: 'bg-ok-soft text-ok', neutral: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn' } as const;

/** Whether WhatsApp messages go out now, and what keeps them from going. */
function Status({ view }: { view: WhatsAppSettingsView }) {
  const s = whatsappStatus(view);
  return (
    <section aria-labelledby="whatsapp-status" className="card p-6">
      <h2 id="whatsapp-status" className="text-lg font-semibold">
        Where WhatsApp Stands
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
  if (user.developer) return <Empty>The WhatsApp settings hold the company’s number and its token: they aren’t open to developers.</Empty>;
  if (!seesWhatsAppSettings(user)) return <Empty>{WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY}</Empty>;
  if (user.viewAs) return <Empty>{WHATSAPP_SETTINGS_OWN_ACCOUNT}</Empty>;
  const [loaded, mine] = await Promise.all([load<WhatsAppSettingsView>('/whatsapp/settings'), load<MyWhatsAppView>('/me/whatsapp')]);
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server does not send WhatsApp messages yet. Please try again after its next update.</Empty>;
  if (loaded.kind === 'failed') return <Empty>The WhatsApp settings could not be loaded. {loaded.messages.join(' ')}</Empty>;
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        WhatsApp messages from the company’s own WhatsApp Business number, sent through Meta’s WhatsApp Cloud API directly or through Twilio: to employees
        who turn them on (approvals waiting, decisions on their requests, check-in reminders, interviews they sit on) and to candidates who tick it on the
        careers forms (their application received and their interviews). They are added to the bell, push and email, never in their place.
      </p>
      <Status view={loaded.value} />
      {/* the test goes to the Super Admin's own mobile unless they write another */}
      <WhatsAppSettingsForm action={submitWhatsAppSettings} view={loaded.value} testTo={mine.kind === 'ok' ? mine.value.mobile : null} />
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
