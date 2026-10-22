import Link from 'next/link';
import { CAREERS_PATH, GENERAL_PATH } from './careers';
import { ArrowLeft, ArrowUpRight } from './icons';

// The careers pages' pieces (owner, 22 October 2026: "where will we include the ATS?"; dressed as trendlix.com, "i need
// it to match the UI"): the room a page leaves under the fixed header, the link back to the open roles, a short notice
// in place of a page that can't be shown, the line shown while a page loads, and the dark card that offers to send a
// CV when no open job fits.

/** A careers page below the header (the careers page's own hero goes under the header instead). */
export function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="pt-28 pb-20 sm:pt-32 lg:pb-28">{children}</div>;
}

/** Back to the open roles, as trendlix.com's link buttons: small letters, a line drawn in on hover. */
export function BackLink() {
  return (
    <Link href={CAREERS_PATH} className="careers-link">
      <ArrowLeft className="careers-arrow-back size-4" />
      <span>All open roles</span>
    </Link>
  );
}

/** A page's head, as trendlix.com's page hero: a small label with a dot, the title in big letters, a line under it. */
export function PageHead({ crumb, title, children }: { crumb: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mt-8 space-y-6 border-b border-white/[0.08] pb-12 lg:pb-16">
      <p className="careers-crumb">{crumb}</p>
      <h1 className="careers-page-title max-w-6xl">{title}</h1>
      {children}
    </header>
  );
}

/** In place of a page that can't be shown; `heading` 2 where the page has its own title above it (the careers page's hero). */
export function Notice({ title, children, back = false, heading = 1 }: { title: string; children: React.ReactNode; back?: boolean; heading?: 1 | 2 }) {
  const Heading = heading === 1 ? 'h1' : 'h2';
  return (
    <div className="careers-container">
      <section className="careers-box max-w-3xl space-y-6">
        <Heading className="careers-display text-[clamp(36px,6vw,64px)] leading-[0.95] tracking-[-0.035em]">{title}</Heading>
        <div className="space-y-3 text-base leading-relaxed text-white/[0.64]">{children}</div>
        {back && (
          <Link href={CAREERS_PATH} className="careers-btn-outline">
            See the open roles
            <ArrowUpRight className="careers-arrow-out size-4" />
          </Link>
        )}
      </section>
    </div>
  );
}

export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers-container">
      <p className="py-16 text-[14.6px] leading-[22.4px] text-white/[0.64]" role="status">
        {children}
      </p>
    </div>
  );
}

/** "Don't see your role?": the dark card leading to the general CV form (22 October 2026: "Both"). */
export function SendCvBand() {
  return (
    <section aria-labelledby="careers-send-cv" className="careers-container mt-20 lg:mt-28">
      <div className="careers-card min-h-0 gap-8 lg:flex-row lg:items-end lg:justify-between lg:p-16">
        <div className="max-w-2xl space-y-4">
          <h2 id="careers-send-cv" className="careers-display text-[clamp(40px,6vw,88px)] leading-[0.95] tracking-[-0.035em]">
            Don’t See Your Role?
          </h2>
          <p className="text-base leading-7 text-white/[0.64] sm:text-lg">Send us your CV and tell us what you do. When a role opens that fits you, we will contact you.</p>
        </div>
        <Link href={GENERAL_PATH} className="careers-btn-outline shrink-0 self-start lg:self-auto">
          Send us your CV
          <ArrowUpRight className="careers-arrow-out size-4" />
        </Link>
      </div>
    </section>
  );
}
