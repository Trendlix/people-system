import { DEVELOPER_BANNER } from '@trendlix/shared';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';

/**
 * At the top of every page of a developer's (owner, 22 October 2026: "i want to create a role for develoeprs, not
 * showing the real numbers"): they see what a Super Admin sees, every amount and personal ID hidden, and nothing they
 * press changes anything (the API refuses it).
 */
export async function DeveloperBanner() {
  let developer = false;
  try {
    developer = (await getCurrentUser()).developer === true;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!developer) return null;
  return (
    <section aria-label="Developer view" className="sticky top-0 z-40 border-b border-accent/20 bg-accent-soft px-4 py-2 text-ink sm:px-8">
      <p className="text-sm font-semibold">{DEVELOPER_BANNER}</p>
    </section>
  );
}
