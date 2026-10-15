// The profile's tabs and their addresses. Pure code (no JSX, no @/ imports), so tested helpers can build links to a tab;
// ui.tsx passes these on to the screens.

/** The profile's tabs, as `?tab=` in its address (Basic Data has none). */
export const PROFILE_TABS = [
  { key: 'basic', label: 'Basic Data' },
  { key: 'education', label: 'Education' },
  { key: 'employment', label: 'Employment' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'documents', label: 'Documents' },
] as const;

export type ProfileTabKey = (typeof PROFILE_TABS)[number]['key'];

/** The address of a profile tab, e.g. /employees/<id>?tab=employment. */
export function profileHref(id: string, tab: ProfileTabKey = 'basic'): string {
  return tab === 'basic' ? `/employees/${id}` : `/employees/${id}?tab=${tab}`;
}

export function isProfileTab(value: string): value is ProfileTabKey {
  return PROFILE_TABS.some((t) => t.key === value);
}
