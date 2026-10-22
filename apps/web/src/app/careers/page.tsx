import Link from 'next/link';
import { Suspense } from 'react';
import type { PublicCareers } from '@trendlix/shared';
import { publicGet } from '@/lib/public-api';
import { GENERAL_PATH } from './careers';
import { ArrowDown, ArrowUpRight, ChevronDown } from './icons';
import { JobsBrowser } from './jobs-browser';
import { HERO, ROLES_ID } from './site';
import { Loading, Notice, SendCvBand } from './ui';

// The careers page's open jobs (owner, 22 October 2026: "where will we include the ATS?"): every vacancy the CEO approved
// and whose closing date hasn't passed, newest first, each linking to its page and form, and the offer to send a CV
// when none fits. Dressed as trendlix.com (owner, 22 October 2026: "i need it to match the UI"; its new home hero, "this
// is it"): a full-height hero under the header (a team photo under a dark overlay when HERO.image is set, the short
// line, the button to the open roles, the headline's faded and bright lines, Scroll to explore), then its pills and its
// cards. Made for a phone first.

async function OpenJobs() {
  const result = await publicGet<PublicCareers>('/careers');
  if (!result.ok) {
    return (
      <Notice title="Careers Can’t Be Shown Right Now" heading={2}>
        <p>Please try again in a few minutes.</p>
      </Notice>
    );
  }
  const { vacancies } = result.data;
  return (
    <>
      <div className="careers-container">
        <header className="space-y-6 border-b border-white/[0.08] pb-10 lg:pb-14">
          <p className="careers-crumb">Careers at TrendLIX</p>
          <h2 className="careers-page-title text-[clamp(48px,8vw,112px)]">
            Open Roles
            <sup className="ms-2 align-super text-[0.3em] tracking-normal text-white/[0.64]">({vacancies.length})</sup>
          </h2>
        </header>
        <div className="mt-10 lg:mt-14">
          <JobsBrowser jobs={vacancies} />
        </div>
      </div>
      {/* a CV without a posted job (owner, 22 October 2026: "what came out of the posted jobs and what cam on randomly") */}
      <SendCvBand />
    </>
  );
}

function Hero() {
  const image = HERO.image ? ({ '--careers-hero-image': `url("${HERO.image}")` } as React.CSSProperties) : undefined;
  return (
    <section className="careers-hero" style={image} aria-labelledby="careers-hero-title">
      <div className="careers-container pt-32 pb-10 sm:pb-16">
        <p className="careers-hero-slogan">{HERO.slogan}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a href={`#${ROLES_ID}`} className="careers-btn-outline">
            View open roles
            <ArrowDown className="careers-arrow-down size-4" />
          </a>
          <Link href={GENERAL_PATH} className="careers-link">
            <span>Send us your CV</span>
            <ArrowUpRight className="careers-arrow-out size-4" />
          </Link>
        </div>
        <h1 id="careers-hero-title" className="careers-hero-headline mt-12 sm:mt-[74px]">
          {HERO.lines.map((l) => (
            <span key={l.text} className={l.faded ? 'careers-faded' : undefined}>
              {l.text}{' '}
            </span>
          ))}
        </h1>
        <a href={`#${ROLES_ID}`} className="careers-scroll mt-[26px]">
          Scroll to explore
          <ChevronDown className="size-4" strokeWidth={2.25} />
        </a>
      </div>
    </section>
  );
}

export default function CareersPage() {
  return (
    <div className="pb-20 lg:pb-28">
      <Hero />
      <div id={ROLES_ID} className="scroll-mt-24 pt-16 lg:pt-24">
        <Suspense fallback={<Loading>Loading the open roles…</Loading>}>
          <OpenJobs />
        </Suspense>
      </div>
    </div>
  );
}
