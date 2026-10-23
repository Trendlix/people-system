import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { firstSetupPage, SETUP_PATHS } from './setup-pages';
import { Loading } from './ui';

// /organization: the first setup page the user sees (owner, 23 October 2026: the setup menu's groups), as the sidebar's
// Organization links to; Company Details when who it is can't be read.
async function First(): Promise<React.ReactNode> {
  let href: string = SETUP_PATHS.company;
  try {
    href = firstSetupPage(await getCurrentUser())?.href ?? href;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  redirect(href);
}

export default function OrganizationPage() {
  return (
    <Suspense fallback={<Loading />}>
      <First />
    </Suspense>
  );
}
