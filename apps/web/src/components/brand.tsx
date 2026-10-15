import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Image from 'next/image';
import { getBrand } from '@/lib/api';
import { brandMark, TAB_ICON_TAG, tabIcons } from '@/lib/brand';
import type { CompanyBrand } from '@/lib/types';

/**
 * A page's browser tab icon: the company's thumbnail when there is one (owner's request, 15 October 2026), with its
 * version in the address, else the People System's own. For the signed-in pages, the sign-in page and the candidate's
 * offer page (their generateMetadata).
 *
 * Cached, not read per request: Next.js refuses a page that is otherwise prerendered (e.g. Change Password) for metadata
 * read per request. Uploading or removing the thumbnail expires it at once (updateTag in the company actions); a value
 * read while the API was out of reach (e.g. at build time) is put right within a minute or two.
 */
export async function brandMetadata(): Promise<Pick<Metadata, 'icons'>> {
  'use cache';
  cacheLife('minutes');
  cacheTag(TAB_ICON_TAG);
  return { icons: tabIcons(await getBrand()) };
}

/** `display`: the Tailwind display classes, e.g. `hidden md:block` for a computer only. */
function Picture({ src, display = 'block' }: { src: string; display?: string }) {
  return (
    <span className={`relative size-10 shrink-0 overflow-hidden rounded-lg bg-white ${display}`}>
      <Image src={src} alt="" fill unoptimized className="object-contain p-1" />
    </span>
  );
}

/**
 * The company's mark beside its name: the logo, or the thumbnail when there is no logo, or the initial without either.
 * In the sidebar (`dark`), on a phone, where it is a bar along the top and the full logo has no room, the thumbnail
 * stands in for the logo (owner's request, 15 October 2026); on a computer the logo stays.
 */
function Mark({ brand, dark }: { brand: CompanyBrand; dark: boolean }) {
  const { full, compact } = brandMark(brand);
  if (dark && full && compact && compact !== full) {
    return (
      <>
        <Picture src={compact} display="block md:hidden" />
        <Picture src={full} display="hidden md:block" />
      </>
    );
  }
  if (full) return <Picture src={full} />;
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white ${dark ? 'bg-accent' : 'bg-sidebar'}`}
    >
      {brand.nameEn.trim().charAt(0).toUpperCase() || 'P'}
    </span>
  );
}

/** Company logo (or thumbnail) and name. `dark` is for the sidebar. */
export async function Brand({ dark = false }: { dark?: boolean }) {
  const brand = await getBrand();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Mark brand={brand} dark={dark} />
      <div className="min-w-0 leading-tight">
        <p className={`truncate font-semibold ${dark ? 'text-white' : ''}`}>{brand.nameEn}</p>
        <p className={`text-xs ${dark ? 'text-sidebar-text' : 'text-muted'}`}>People System</p>
      </div>
    </div>
  );
}

/** Shown while the company name loads. */
export function BrandFallback({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-10 shrink-0 rounded-lg ${dark ? 'bg-white/10' : 'bg-line'}`} />
      <p className={`text-xs ${dark ? 'text-sidebar-text' : 'text-muted'}`}>People System</p>
    </div>
  );
}
