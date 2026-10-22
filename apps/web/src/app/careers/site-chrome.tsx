import Image from 'next/image';
import { connection } from 'next/server';
import { getBrand } from '@/lib/api';
import { brandMark } from '@/lib/brand';
import { ArrowUpRight } from './icons';
import { SiteHeader } from './site-header';
import { CONTACT, CONTACT_HREF, FOOTER_LINKS, SOCIAL_LINKS } from './site';

// What frames every careers page as trendlix.com frames its own (owner, 22 October 2026: "i will put it in the main
// website, i need it to match the UI"; then its new design): the header with the company's logo; the light Get in touch
// band before the footer (the office and the ways to reach it, and the main site's Contact us); and the black footer:
// Stay connected and the main site's navigation in big letters, then the company's logo across the page beside its
// social pages, then the copyright line.

/** The header, with the company's logo from its profile (the company's name in big letters until it has one). */
export async function CareersHeader() {
  const brand = await getBrand();
  return <SiteHeader logo={brandMark(brand).full} name={brand.nameEn} />;
}

/** The header while the logo is read: the same bar, the name in place of the logo. */
export function CareersHeaderFallback() {
  return <SiteHeader logo={null} name="TrendLIX" />;
}

function ContactItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-black/10 py-5">
      <dt className="careers-display text-[19.5px] leading-7 tracking-[-0.4px]">{title}</dt>
      <dd className="text-right text-[15.1px] leading-6 text-black/[0.64]">{children}</dd>
    </div>
  );
}

/** The light Get in touch band: the second word in a black circle, as trendlix.com writes it. */
export function ContactBand() {
  return (
    <section aria-labelledby="careers-contact" className="careers-light py-16 lg:py-24">
      <div className="careers-container grid gap-12 lg:grid-cols-2 lg:items-end lg:gap-16">
        <div className="space-y-8">
          <h2 id="careers-contact" className="careers-display text-[clamp(40px,8vw,107.3px)] leading-[1.25]">
            Get{' '}
            <span className="inline-flex aspect-square items-center justify-center rounded-full bg-black px-[0.22em] leading-none text-white">in</span>{' '}
            Touch
          </h2>
          <p className="max-w-md text-base leading-7 text-black/[0.64]">A question about a role, or about working with us? Write to us or visit us; we will be glad to hear from you.</p>
          <a href={CONTACT_HREF} className="careers-btn-outline">
            Contact us
            <ArrowUpRight className="careers-arrow-out size-4" />
          </a>
        </div>
        <dl className="border-t border-black/10">
          <ContactItem title="Office">
            <a href={CONTACT.mapsHref} className="underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer">
              {CONTACT.office}
            </a>
          </ContactItem>
          <ContactItem title="Phone">
            <a href={CONTACT.phoneHref} className="underline-offset-4 hover:underline">
              {CONTACT.phone}
            </a>
          </ContactItem>
          <ContactItem title="Email">
            <a href={`mailto:${CONTACT.email}`} className="underline-offset-4 hover:underline">
              {CONTACT.email}
            </a>
          </ContactItem>
        </dl>
      </div>
    </section>
  );
}

/** The footer; the year is read when the page is asked for, and the logo from the company's profile. */
export async function CareersFooter() {
  await connection();
  const year = new Date().getFullYear();
  const logo = brandMark(await getBrand()).full;
  return (
    <footer className="bg-black pt-16 lg:pt-24">
      <div className="careers-container">
        <div className="grid border-b border-white/[0.08] lg:grid-cols-3">
          <div className="space-y-4 pb-10 lg:pe-10 lg:pb-14">
            <p className="text-[14.8px] leading-[22.4px] text-white/[0.64]">Stay connected</p>
            <p className="max-w-sm text-[18.8px] leading-7 text-white">Follow TrendLIX for new roles, our work and life at the studio.</p>
          </div>
          <nav aria-labelledby="careers-footer-nav" className="space-y-6 border-t border-white/[0.08] py-10 lg:col-span-2 lg:border-t-0 lg:border-l lg:ps-10 lg:pt-0 lg:pb-14">
            <p id="careers-footer-nav" className="text-[14.8px] leading-[22.4px] text-white/[0.64]">
              Navigation
            </p>
            <ul className="grid grid-cols-2 gap-x-8 gap-y-3">
              {FOOTER_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="careers-display careers-wipe relative inline-block text-[22px] leading-[1.25] tracking-[-1.28px] text-white sm:text-[31.9px]">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="grid border-b border-white/[0.08] lg:grid-cols-3">
          <div className="flex items-center py-10 lg:col-span-2 lg:pe-10 lg:py-14">
            {logo ? (
              <div className="aspect-[3/1] w-full max-w-4xl">
                <Image src={logo} alt="TrendLIX" width={1200} height={400} unoptimized className="size-full object-contain object-left [filter:brightness(0)_invert(1)]" />
              </div>
            ) : (
              <p className="careers-display text-[clamp(72px,16vw,240px)] leading-[0.85]">TrendLIX</p>
            )}
          </div>
          <nav aria-labelledby="careers-footer-social" className="space-y-6 border-t border-white/[0.08] py-10 lg:border-t-0 lg:border-l lg:ps-10 lg:py-14">
            <p id="careers-footer-social" className="text-[14.8px] leading-[22.4px] text-white/[0.64]">
              Social
            </p>
            <ul className="space-y-3">
              {SOCIAL_LINKS.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="careers-display group inline-flex items-center gap-2 text-[22px] leading-[1.25] tracking-[-1.28px] text-white sm:text-[26px]">
                    {s.label}
                    <ArrowUpRight className="size-5 text-white/[0.64] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="py-6 text-[14.6px] leading-[22.4px] text-white/[0.64]">© {year} TrendLIX. All rights reserved.</p>
      </div>
    </footer>
  );
}
