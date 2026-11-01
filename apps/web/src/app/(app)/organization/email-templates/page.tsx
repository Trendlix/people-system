import { EMAIL_TEMPLATE_GROUP_LABELS, EMAIL_TEMPLATE_GROUPS, type EmailTemplateView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { editsEmailTemplates, seesEmailTemplates } from '@/lib/email-templates';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { resetEmailTemplate, saveEmailTemplate, testEmailTemplate } from './actions';
import { TemplateCard } from './template-card';

// Organization → Email Templates (owner, 1 November 2026: "is there a templete screen for email and whatsapp templetes";
// "build the mail templetes"): each email the system sends, grouped by who gets it, with its words. HR writes the
// subject and text with {{fields}} filled in when it goes, sees a preview with sample values, sends themself a test and
// can go back to the standard words. HR, the CEO and a Super Admin see it; HR and a Super Admin change it. WhatsApp
// messages aren't here: Meta approves their words. The rejection and invitation emails stay in Recruitment Settings.

export const metadata: Metadata = { title: 'Email Templates · People System' };

type Loaded = { kind: 'ok'; value: EmailTemplateView[] } | { kind: 'unavailable' } | { kind: 'failed'; messages: string[] };

async function loadTemplates(): Promise<Loaded> {
  let res: Response;
  try {
    res = await apiFetch('/email-templates');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as EmailTemplateView[] };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

async function Gate() {
  const user = await getCurrentUser();
  if (!seesEmailTemplates(user)) return <Empty>The email templates are for HR, the CEO and a Super Admin.</Empty>;
  const loaded = await loadTemplates();
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server does not have the email templates yet.</Empty>;
  if (loaded.kind === 'failed') return <Empty>The email templates could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const edits = editsEmailTemplates(user);
  const customised = loaded.value.filter((t) => t.custom).length;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {customised ? `${customised} of ${loaded.value.length} emails have your words.` : `All ${loaded.value.length} emails go with the standard words.`}
      </p>
      {EMAIL_TEMPLATE_GROUPS.map((g) => {
        const list = loaded.value.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-labelledby={`email-group-${g}`} className="space-y-3">
            <h2 id={`email-group-${g}`} className="text-lg font-semibold">
              {EMAIL_TEMPLATE_GROUP_LABELS[g]}
            </h2>
            {list.map((t) => (
              <TemplateCard key={t.key} template={t} edits={edits} testTo={user.email} actions={{ save: saveEmailTemplate, reset: resetEmailTemplate, test: testEmailTemplate }} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

export default function EmailTemplatesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
