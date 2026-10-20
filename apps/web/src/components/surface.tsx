'use client';

import { createContext, useContext } from 'react';
import { SURFACE_FIELD, type AppSection } from '@/lib/surface';

// The section of the phone pages (/app, owner, 20 October 2026: "what if we tried to build a mobile app for the
// employees? to enable them to check in and out, and apply for their requests") a shared form is shown in, given by the
// section's layout; none on the site. A form puts it in a hidden field (SurfaceField), so its server action, once done,
// opens the same request's page in that section (lib/surface.ts, afterAction). Who may do what is the API's, as ever.

const AppSectionContext = createContext<AppSection | null>(null);

/** The phone pages' section around its pages (its layout). */
export function AppSectionProvider({ section, children }: { section: AppSection; children: React.ReactNode }) {
  return <AppSectionContext.Provider value={section}>{children}</AppSectionContext.Provider>;
}

/** The section of the phone pages this is shown in; null on the site. */
export const useAppSection = (): AppSection | null => useContext(AppSectionContext);

/** In a form: the section of the phone pages it is in, as a hidden field; nothing on the site. */
export function SurfaceField() {
  const section = useAppSection();
  return section ? <input type="hidden" name={SURFACE_FIELD} value={section} /> : null;
}
