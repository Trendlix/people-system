import type { Metadata } from 'next';
import { careersSiteUrl, EARLIER_OFFERS_SWITCH } from '@trendlix/shared';
import { Suspense } from 'react';
import { careersSiteFrom } from '@/lib/careers-base';
import { isSuperAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { saveCareersSite, saveInviteWords, savePositionChoices, saveRecruitmentSettings, saveSuggestionSettings } from '../../recruitment/actions';
import { loadCvPositions, loadRecruitmentSettings, recruitmentNotLoaded } from '../../recruitment/data';
import { managesRecruitment, readsRecruitment, WHO_SEES } from '../../recruitment/recruitment';
import { CareersSiteForm, InviteWordsForm, PositionsForm, PositionsList, RejectionWordsForm, SuggestionSettingsForm } from './settings-form';
import { redirectUrlFor } from '../../recruitment/linkedin-settings';
import { loadEarlierOffersSetting, loadLinkedInSettings, loadPortfolioSettings } from '../../recruitment/portfolio-data';
import { saveEarlierOffers, saveLinkedInSettings, savePortfolioSettings } from '../../recruitment/settings-actions';
import { EarlierOffersForm } from './earlier-offers-form';
import { LinkedInSettingsForm } from './linkedin-form';
import { PortfolioSettingsForm, PortfolioSettingsList } from './portfolio-form';

// Recruitment Settings (Phase 2, owner, 22 October 2026): the rejection email's words, sent when HR ticks "Email the
// candidate" on Reject, English then Arabic; empty, the standard ones. HR and a Super Admin change them; the CEO reads.
// Since 24 October 2026 (Suggested From Earlier CVs, owner: "Suggest; HR adds", "Yes, HR presses 'Invite to apply'"): how
// far back CVs count for each vacancy's suggestions, and the invitation to apply's words. Since 25 October 2026 (owner:
// "should it be the positions?"; asked, "Position, grouped by team"): the positions on "Send us your CV", each shown or
// hidden there, with an optional public name. And since then too (owner: "can i use linkedin to complete the data? and for
// creatives, they need to add their portfolios"; asked, all three): the portfolio each position asks for on both careers
// forms ("Portfolio on the Forms", HR's to change), and the LinkedIn sign-in's setup ("LinkedIn Sign-in", a Super
// Admin's only, in their own session; never a developer's). And since then too (owner: "allow the HR to add for now job
// offers with a past duedate to enter the previous data"): "Earlier Offers", the switch "Entering earlier offers", on for
// now, HR's and a Super Admin's to change, the CEO's to read. And since the careers pages moved to the main website
// (25 October 2026: www.trendlix.com/en/careers; the owner asked that the links stop relying on people.trendlix.com/
// careers' redirect): "Careers Site", the address every public careers link is built on (HR's to change, audited; the
// CEO reads), the standard when unset; LinkedIn's redirect URL below is at it.

export const metadata: Metadata = { title: 'Recruitment Settings · People System' };

async function Settings() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const [loaded, positions] = await Promise.all([loadRecruitmentSettings(), loadCvPositions()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'settings')}</Empty>;
  const s = loaded.value;
  const manages = managesRecruitment(user);
  // the address in use, as the API sends it (lib/careers-base.ts)
  const careersSite = careersSiteFrom(s.careersSite?.address);
  return (
    <div className="space-y-6">
      <section aria-labelledby="careers-site" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="careers-site" className="text-lg font-semibold">
            Careers Site
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            Where the careers pages are, on the main website. Every careers link the system makes is built on this address: the apply links of each vacancy, the
            invitation to apply’s link and LinkedIn’s redirect URL. A job’s page is the address and the job’s own name; “Send us your CV” is{' '}
            <span className="break-all">{careersSiteUrl(careersSite, { general: true })}</span>.
          </p>
        </div>
        {manages ? (
          <CareersSiteForm action={saveCareersSite} address={careersSite} />
        ) : (
          <p className="text-sm break-all">
            {careersSite}
            {s.careersSite?.set ? '' : ' (the standard)'}
          </p>
        )}
      </section>

      <section aria-labelledby="earlier-offers" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="earlier-offers" className="text-lg font-semibold">
            Earlier Offers
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            For entering the job offers made before the system. While it is on, an offer can be saved with a past last day, recorded as sent earlier (no email, no
            link) and have its answer recorded with the day it was given. Nothing is sent to the candidate, and emailing or linking an offer past its last day
            stays refused. Switch it off once the earlier offers are in: the usual rules come back.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <EarlierOffersSection manages={manages} />
        </Suspense>
      </section>

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

      <section aria-labelledby="portfolio-forms" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="portfolio-forms" className="text-lg font-semibold">
            Portfolio on the Forms
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            What both careers forms ask each position for: hidden, optional or required, a hint under the field, the kinds taken and how many links. Links are checked
            by their shape only, never opened by the system. A position you haven’t set follows the default for its name (a video editor’s showreel, a
            designer’s Behance …). A vacancy can ask otherwise on its own form.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <PortfolioSection manages={manages} />
        </Suspense>
      </section>

      {/* a Super Admin's only (never a developer's): the app's secret is set here */}
      {isSuperAdmin(user) && !user.developer && (
        <section aria-labelledby="linkedin-signin" className="card space-y-4 p-6">
          <div className="space-y-1">
            <h2 id="linkedin-signin" className="text-lg font-semibold">
              LinkedIn Sign-in
            </h2>
            <p className="max-w-3xl text-sm text-muted">
              “Fill in with LinkedIn” on both careers forms: the person signs in with LinkedIn, and their name and email are filled in where empty. LinkedIn shares
              only those (never the work history); an email LinkedIn confirmed shows “Confirmed by LinkedIn” to HR. No account is made and nothing else is kept.
            </p>
          </div>
          {user.viewAs ? (
            <p className="text-sm text-muted">Open this in your own session to set it up: not while viewing as someone.</p>
          ) : (
            <Suspense fallback={<Loading />}>
              <LinkedInSection careersSite={careersSite} />
            </Suspense>
          )}
        </section>
      )}
    </div>
  );
}

/** "Entering earlier offers": HR's switch (HR, a Super Admin), or where it stands for the CEO. */
async function EarlierOffersSection({ manages }: { manages: boolean }) {
  const loaded = await loadEarlierOffersSetting();
  if (loaded.kind !== 'ok') return <p className="text-sm text-muted">{recruitmentNotLoaded(loaded, 'earlier offers switch')}</p>;
  if (manages) return <EarlierOffersForm action={saveEarlierOffers} setting={loaded.value} />;
  return (
    <p className="text-sm">
      {EARLIER_OFFERS_SWITCH}: <span className="font-semibold">{loaded.value.on ? 'On' : 'Off'}</span>
    </p>
  );
}

/** The portfolio per position: HR's form (HR, a Super Admin), or the list the CEO reads. */
async function PortfolioSection({ manages }: { manages: boolean }) {
  const loaded = await loadPortfolioSettings();
  if (loaded.kind !== 'ok') return <p className="text-sm text-muted">{recruitmentNotLoaded(loaded, 'portfolio settings')}</p>;
  const { positions } = loaded.value;
  if (!positions.length) return <p className="text-sm text-muted">No positions yet: they come from the job titles.</p>;
  return manages ? <PortfolioSettingsForm action={savePortfolioSettings} positions={positions} /> : <PortfolioSettingsList positions={positions} />;
}

/** The LinkedIn sign-in's setup, with the redirect URL at the careers site's address (Careers Site, above). */
async function LinkedInSection({ careersSite }: { careersSite: string }) {
  const loaded = await loadLinkedInSettings();
  if (loaded.kind !== 'ok') {
    return <p className="text-sm text-muted">{loaded.kind === 'forbidden' ? 'Only a Super Admin sets up the LinkedIn sign-in.' : recruitmentNotLoaded(loaded, 'LinkedIn sign-in')}</p>;
  }
  return <LinkedInSettingsForm action={saveLinkedInSettings} view={loaded.value} redirectUrl={redirectUrlFor(careersSite)} />;
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
