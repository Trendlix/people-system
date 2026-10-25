import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { saveInviteWords, savePositionChoices, saveRecruitmentSettings, saveSuggestionSettings } from '../../recruitment/actions';
import { loadCvPositions, loadRecruitmentSettings, recruitmentNotLoaded } from '../../recruitment/data';
import { managesRecruitment, readsRecruitment, WHO_SEES } from '../../recruitment/recruitment';
import { InviteWordsForm, PositionsForm, PositionsList, RejectionWordsForm, SuggestionSettingsForm } from './settings-form';

// Recruitment Settings (Phase 2, owner, 22 October 2026): the rejection email's words, sent when HR ticks "Email the
// candidate" on Reject, English then Arabic; empty, the standard ones. HR and a Super Admin change them; the CEO reads.
// Since 24 October 2026 (Suggested From Earlier CVs, owner: "Suggest; HR adds", "Yes, HR presses 'Invite to apply'"): how
// far back CVs count for each vacancy's suggestions, and the invitation to apply's words. Since 25 October 2026 (owner:
// "should it be the positions?"; asked, "Position, grouped by team"): the positions on "Send us your CV", each shown or
// hidden there, with an optional public name.

export const metadata: Metadata = { title: 'Recruitment Settings · People System' };

async function Settings() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const [loaded, positions] = await Promise.all([loadRecruitmentSettings(), loadCvPositions()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'settings')}</Empty>;
  const s = loaded.value;
  const manages = managesRecruitment(user);
  return (
    <div className="space-y-6">
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
        {manages ? (
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

      <section aria-labelledby="suggested-cvs" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="suggested-cvs" className="text-lg font-semibold">
            Suggested From Earlier CVs
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            Each open vacancy lists the general CVs and the earlier applicants for other jobs that match it, with the reasons. Nobody joins a vacancy until HR adds
            them. Never for a C-level vacancy.
          </p>
        </div>
        {manages ? (
          <SuggestionSettingsForm action={saveSuggestionSettings} settings={s} />
        ) : (
          <p className="text-sm">CVs and applications of the last {s.suggestions.recencyMonths} months count.</p>
        )}
      </section>

      <section aria-labelledby="invite-email" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="invite-email" className="text-lg font-semibold">
            Invitation Email
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            Sent only when HR presses “Invite to apply” on a suggested CV, never by itself. {'{name}'}, {'{job}'}, {'{company}'} and {'{link}'} (the job’s apply link)
            are filled in; the link is added at the end if you leave it out. Leave a box empty for the standard words, shown in grey.
          </p>
        </div>
        {manages ? (
          <InviteWordsForm action={saveInviteWords} settings={s} />
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">{s.invite.subject ?? s.inviteStandard.subject}</p>
            <p className="whitespace-pre-line">{s.invite.en ?? s.inviteStandard.en}</p>
            <p className="whitespace-pre-line" dir="rtl">
              {s.invite.ar ?? s.inviteStandard.ar}
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="cv-positions" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="cv-positions" className="text-lg font-semibold">
            Positions on the CV Form
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            The positions people choose from on “Send us your CV”, grouped by team: the job titles with their levels merged (“Video Editor” for Junior and Senior), never a
            C-level one. A new job title’s position is shown until you hide it. A hidden one leaves the careers page only: HR’s lists keep it, marked hidden.
          </p>
        </div>
        {positions.kind !== 'ok' ? (
          <p className="text-sm text-muted">{recruitmentNotLoaded(positions, 'positions')}</p>
        ) : positions.value.positions.length === 0 ? (
          <p className="text-sm text-muted">No positions yet: they come from the job titles.</p>
        ) : manages ? (
          <PositionsForm action={savePositionChoices} positions={positions.value.positions} />
        ) : (
          <PositionsList positions={positions.value.positions} />
        )}
      </section>
    </div>
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
