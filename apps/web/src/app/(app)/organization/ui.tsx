import Link from 'next/link';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';

// Small building blocks shared by the Organization pages.

export function Loading() {
  return <p className="py-8 text-sm text-muted">Loading…</p>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-6 py-10 text-center text-sm text-muted">{children}</div>;
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm">
      ← {children}
    </Link>
  );
}

/** Shows the children only to HR and Admin; others get a short explanation. */
export async function RequireEditor({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!canEditOrganisation(user)) {
    return <Empty>Only HR and Admin can change organization data.</Empty>;
  }
  return children;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Ids in URLs are UUIDs; anything else gets the 404 page without asking the API. */
export const UUID = /^[0-9a-f-]{36}$/i;
