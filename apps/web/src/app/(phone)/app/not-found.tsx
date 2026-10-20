import Link from 'next/link';
import { APP_PATHS } from '@/lib/surface';

// A page of the phone pages that isn't there, or a request that isn't the caller's to see (the API says it isn't
// there): as the site's (app/not-found.tsx), with the way back to the phone pages' Home (owner, 20 October 2026: the
// employee app).
export default function PhoneNotFound() {
  return (
    <div className="card p-5 text-center">
      <h1 className="text-lg font-semibold">Page Not Found</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
      <Link href={APP_PATHS.home} className="btn btn-secondary mt-4 min-h-12 w-full">
        Go to home
      </Link>
    </div>
  );
}
