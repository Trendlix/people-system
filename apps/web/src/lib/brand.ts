import type { CompanyBrand } from './types';

// The company's two images in the web app: the logo, a wide wordmark, and the thumbnail beside it, a square brand mark
// (owner's request, 15 October 2026). Both are served by the web app, /company-logo and /company-thumbnail (public, so
// the sign-in page and the candidate's offer page show them too), with the image's version in the address: a new upload
// changes the address, so a browser never keeps showing the old one. Pure code, tested.

/** Logo URL that changes whenever a new logo is uploaded, so browsers don't show an old one. */
export function logoUrl(version: number | string): string {
  return `/company-logo?v=${encodeURIComponent(String(version))}`;
}

/** Thumbnail URL, likewise. */
export function thumbnailUrl(version: number | string): string {
  return `/company-thumbnail?v=${encodeURIComponent(String(version))}`;
}

/** The People System's own browser tab icon (public/favicon.ico), for a company without a thumbnail. */
export const FAVICON = '/favicon.ico';

/** The cache tag of the browser tab icon (components/brand.tsx), expired when the thumbnail is uploaded or removed. */
export const TAB_ICON_TAG = 'company-tab-icon';

/**
 * The image the company's mark shows: `full` where the full logo has room (the sidebar on a computer, the sign-in page,
 * the candidate's offer page), `compact` where it hasn't (the sidebar's bar along the top of a phone). Each falls back on
 * the other image; null when there is neither, and the company's initial is shown.
 */
export function brandMark(brand: Pick<CompanyBrand, 'logoVersion' | 'thumbnailVersion'>): { full: string | null; compact: string | null } {
  const logo = brand.logoVersion === null ? null : logoUrl(brand.logoVersion);
  const thumbnail = brand.thumbnailVersion === null ? null : thumbnailUrl(brand.thumbnailVersion);
  return { full: logo ?? thumbnail, compact: thumbnail ?? logo };
}

/** The browser tab icon: the company's thumbnail when there is one, else the People System's own. */
export function tabIcons(brand: Pick<CompanyBrand, 'thumbnailVersion'>): { icon: string } {
  return { icon: brand.thumbnailVersion === null ? FAVICON : thumbnailUrl(brand.thumbnailVersion) };
}
