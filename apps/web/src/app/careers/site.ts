import type { PublicVacancySummary } from '@trendlix/shared';

// The careers pages dressed as trendlix.com (owner, 22 October 2026: "i will put it in the main website, i need it to
// match the UI", giving https://www.trendlix.com/en/portfolio): the main site's addresses, its office and contact lines
// as its own pages show them, the hero's words, and the open jobs' department filter. Pure code, tested in
// careers.test.ts.

/** trendlix.com, which the careers pages' header, menu and footer lead back to. */
export const MAIN_SITE = 'https://www.trendlix.com';

/** The main site's menu, as its overlay lists it; Careers (these pages) is added as the current item. */
export const MENU_LINKS: readonly { label: string; href: string }[] = [
  { label: 'Home', href: `${MAIN_SITE}/en` },
  { label: 'Contact us', href: `${MAIN_SITE}/en/contact` },
  { label: 'Our services', href: `${MAIN_SITE}/en/services` },
  { label: 'Portfolio', href: `${MAIN_SITE}/en/portfolio` },
  { label: 'Blogs', href: `${MAIN_SITE}/en/blogs` },
  { label: 'News', href: `${MAIN_SITE}/en/news` },
];

/** The footer's navigation, in the main site's footer order. */
export const FOOTER_LINKS: readonly { label: string; href: string }[] = [
  { label: 'Home', href: `${MAIN_SITE}/en` },
  { label: 'Portfolio', href: `${MAIN_SITE}/en/portfolio` },
  { label: 'Blogs', href: `${MAIN_SITE}/en/blogs` },
  { label: 'Services', href: `${MAIN_SITE}/en/services` },
  { label: 'News', href: `${MAIN_SITE}/en/news` },
  { label: 'Contact', href: `${MAIN_SITE}/en/contact` },
];

/** The main site's Contact us page, which the header's and the contact band's buttons open. */
export const CONTACT_HREF = `${MAIN_SITE}/en/contact`;

/** The office and the ways to reach it, as trendlix.com's contact band shows them. */
export const CONTACT = {
  office: '15 El-Mahrouky St., Golf, Nasr City, Cairo',
  mapsHref: 'https://maps.app.goo.gl/yaLcRgh5HsJYYaAK8',
  phone: '(+20) 10 - 500 - 79822',
  phoneHref: 'tel:+201050079822',
  email: 'info@trendlix.com',
} as const;

/** The company's social pages, in the main site's footer order. */
export const SOCIAL_LINKS: readonly { label: string; href: string }[] = [
  { label: 'Sortlist', href: 'https://www.sortlist.com/agency/trendlix' },
  { label: 'Behance', href: 'https://www.behance.net/trendlix' },
  { label: 'Facebook', href: 'https://www.facebook.com/TrendlixAgency' },
  { label: 'Instagram', href: 'https://www.instagram.com/trendlix.eg' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/trendlix' },
];

/**
 * The careers page's hero, as trendlix.com's home hero (owner, 22 October 2026, its screenshot: "this is it"): HR or
 * the owner change its words here. The short line goes above the headline (two lines at most); the headline is a line
 * each, the faded ones first and the bright ones last. `image` is a team photo under the dark overlay (a file in
 * apps/web/public, e.g. '/careers-team.jpg'); without one, a dark gradient.
 */
export const HERO: {
  slogan: string;
  lines: readonly { text: string; faded: boolean }[];
  image: string | null;
} = {
  slogan: 'Build brands, campaigns, films and digital products with the TrendLIX team.',
  lines: [
    { text: 'Join the team.', faded: true },
    { text: 'Build.', faded: false },
    { text: 'Grow.', faded: false },
  ],
  image: null,
};

/** The open roles' place on the careers page, which the hero's button and "Scroll to explore" lead to. */
export const ROLES_ID = 'open-roles';

/** The departments of the open jobs, for the filter pills: each once, alphabetically; a job without one gives none. */
export function departmentsOf(jobs: readonly Pick<PublicVacancySummary, 'department'>[]): string[] {
  const names = new Set<string>();
  for (const j of jobs) {
    const name = j.department?.trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The jobs of a department (as departmentsOf names it); every job when none is chosen. */
export function jobsIn<J extends Pick<PublicVacancySummary, 'department'>>(jobs: readonly J[], department: string | null): J[] {
  return department === null ? [...jobs] : jobs.filter((j) => j.department?.trim() === department);
}
