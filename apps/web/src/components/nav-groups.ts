// The sidebar's headings that open and close (owner, 20 October 2026: "make the side menu subs expandable - which means
// requests with an arrow beside it to expand and collapse the side menues"): each heading with pages under it (People,
// Payroll, Requests, Attendance, Templates) is a button with an arrow beside it, no longer a link; its first page is its
// first item. The heading holding the page open is open on every page load and every move to another page; the others
// start closed, and one the user opens or closes stays so in that browser. A closed heading shows its pages' counts
// added up, so nothing waiting is hidden. Pure, for the tests and for the menu (nav-links.tsx). Relative imports: the
// tests run without the "@/" alias.
import { isActive, type NavItem, type NavSubItem } from './nav';

/** How many things wait behind a link, by its href. */
export type NavCounts = Partial<Record<string, number>>;

/** An item with pages under it: a heading that opens and closes them. */
export type NavGroup = NavItem & { items: NavSubItem[] };

export const isGroup = (item: NavItem): item is NavGroup => !!item.items?.length;

/** A heading's key, from its label ("people", "payroll", "requests"): the same whichever pages the user sees. */
export const groupKey = (item: Pick<NavItem, 'label'>): string =>
  item.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The id of a heading's list of pages, which its button names in aria-controls. */
export const groupListId = (key: string): string => `nav-group-${key}`;

/** The key of the heading holding this page; null on a page of none (Home, Organization, Approvals). */
export function groupHolding(items: readonly NavItem[], pathname: string): string | null {
  const holding = items.find((item) => isGroup(item) && isActive(item, pathname));
  return holding ? groupKey(holding) : null;
}

// ---------- what the browser remembers ----------

/** Where the browser keeps the headings the user opened or closed (localStorage: per browser, not per user). */
export const GROUPS_STORAGE_KEY = 'trendlix-people:sidebar-groups';

/** Each heading the user opened (true) or closed (false), by its key; a heading left alone isn't in it. */
export type Remembered = Readonly<Partial<Record<string, boolean>>>;

export const NOTHING_REMEMBERED: Remembered = Object.freeze({});

/** What the browser remembers, from what localStorage holds; nothing for anything but {key: true or false}. */
export function parseRemembered(raw: string | null | undefined): Remembered {
  if (!raw) return NOTHING_REMEMBERED;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NOTHING_REMEMBERED;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return NOTHING_REMEMBERED;
  const kept = Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
  return kept.length ? Object.fromEntries(kept) : NOTHING_REMEMBERED;
}

/** What is remembered once a heading is opened or closed (a new object: the old one is left as it was). */
export const remember = (remembered: Remembered, key: string, open: boolean): Remembered => ({ ...remembered, [key]: open });

/**
 * Whether a heading shows its pages: the one holding the page, unless the user closed it on this page (`closedHere`);
 * any other, when the user opened it last.
 */
export function isGroupOpen(key: string, page: { holding: string | null; remembered: Remembered; closedHere?: string | null }): boolean {
  if (key === page.holding) return page.closedHere !== key;
  return page.remembered[key] === true;
}

/**
 * Run as the page arrives, before it is drawn: opens the headings the user opened last, as the menu does once it runs
 * (isGroupOpen), so none jumps open a moment later. The server opens the one holding the page; the script only opens.
 */
export const OPEN_REMEMBERED_SCRIPT =
  `(function(){try{var r=JSON.parse(localStorage.getItem(${JSON.stringify(GROUPS_STORAGE_KEY)})||"null");` +
  `if(!r||typeof r!=="object")return;var b=document.querySelectorAll("button[data-nav-group]");` +
  `for(var i=0;i<b.length;i++){if(r[b[i].getAttribute("data-nav-group")]===true)b[i].setAttribute("aria-expanded","true")}}` +
  `catch(e){}})()`;

// ---------- counts ----------

/** What a closed heading shows: the counts of the pages under it the user sees, added up (0: none). */
export function groupCount(item: Pick<NavItem, 'items'>, counts: NavCounts | undefined): number {
  return (item.items ?? []).reduce((sum, sub) => sum + (counts?.[sub.href] ?? 0), 0);
}
