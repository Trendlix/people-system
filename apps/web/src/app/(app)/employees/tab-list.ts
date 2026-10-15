// The profile's tabs and their addresses. Pure code (no JSX, no @/ imports), so tested helpers can build links to a tab;
// ui.tsx passes these on to the screens.

/**
 * The profile's tabs, as `?tab=` in its address (Basic Data has none). Social Insurance gathers the social insurance
 * work, moved out of the Contracts tab (owner's request, 16 October 2026).
 */
export const PROFILE_TABS = [
  { key: 'basic', label: 'Basic Data' },
  { key: 'education', label: 'Education' },
  { key: 'employment', label: 'Employment' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'insurance', label: 'Social Insurance' },
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
