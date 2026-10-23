import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { saveRecruitmentSettings } from '../../recruitment/actions';
import { loadRecruitmentSettings, recruitmentNotLoaded } from '../../recruitment/data';
import { managesRecruitment, readsRecruitment, WHO_SEES } from '../../recruitment/recruitment';
import { RejectionWordsForm } from './settings-form';

// Recruitment Settings (Phase 2, owner, 22 October 2026): the rejection email's words, sent when HR ticks "Email the
// candidate" on Reject, English then Arabic; empty, the standard ones. HR and a Super Admin change them; the CEO reads.

export const metadata: Metadata = { title: 'Recruitment Settings · People System' };

async function Settings() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadRecruitmentSettings();
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'settings')}</Empty>;
  const s = loaded.value;
  return (
    <section aria-labelledby="rejection-email" className="card space-y-4 p-6">
      <div className="space-y-1">
        <h2 id="rejection-email" className="text-lg font-semibold">
          Rejection Email
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Sent only when “Email the candidate” is ticked on Reject; never to someone filtered out by a must-have question on its own. {'{name}'}, {'{job}'} and{' '}
          {'{company}'} are filled in. Leave a box empty for the standard words, shown in grey.
        </p>
      </div>
      {managesRecruitment(user) ? (
        <RejectionWordsForm action={saveRecruitmentSettings} settings={s} />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-semibold">{s.rejection.subject ?? s.standard.subject}</p>
          <p className="whitespace-pre-line">{s.rejection.en ?? s.standard.en}</p>
          <p className="whitespace-pre-line" dir="rtl">
            {s.rejection.ar ?? s.standard.ar}
          </p>
        </div>
      )}
    </section>
  );
}

// Under Organization since 23 October 2026 (owner: "Check-in Setup, KPI Pillars and deadlines, Recruitment and
// checklists, Templates"), in the setup menu's Hiring & Leaving, which gives the heading.
export default function RecruitmentSettingsPage() {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </div>
  );
}
